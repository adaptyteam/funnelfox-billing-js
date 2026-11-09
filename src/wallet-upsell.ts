/**
 * @fileoverview One-click upsell confirmed in the Apple Pay / Google Pay sheet (FFB-829).
 *
 * Primer (PRMSUP-10609): a saved wallet token must not be charged as a customer-initiated
 * payment, so the customer confirms the upsell in the wallet sheet again and the backend charges
 * that fresh, single-use token. The button is rendered from a client session the backend prepares
 * for the upsell (`one_click_wallet_session`). Apple Pay opens its sheet only from the tap itself,
 * with no request in between, so the session is prepared when the screen loads and kept alive
 * until the tap.
 */

import type {
  HeadlessUniversalCheckoutOptions,
  IHeadlessPaymentMethodButton,
  OnResumeSuccessHandler,
  OnTokenizeSuccessHandler,
  PaymentMethodInfo,
  PaymentMethodToken,
  PrimerClientError,
  PrimerHeadlessCheckout,
  ResumeToken,
} from '@primer-io/checkout-web';
import APIClient, { getResponseErrorCodes } from './api-client';
import {
  DOUBLE_PURCHASE,
  callHook,
  createIdempotencyKey,
  defaultBaseUrl,
  isRetryableOneClickError,
  mapOneClickResponse,
  mapResumeResponse,
  oneClickInFlight,
  oneClickInFlightKey,
  postOneClick,
} from './api';
import { DEFAULTS, PRIMER_DEFAULTS } from './constants';
import {
  APIError,
  FunnefoxSDKError,
  PrimerError,
  ValidationError,
} from './errors';
import {
  DEFAULT_THREE_DS_TIMEOUT_MS,
  PRIMER_3DS_INTENTS,
  THREE_DS_OVERLAY_REVEAL_DELAY_MS,
  dismissPrimerOverlay,
  getPrimerTokenIntent,
  hidePrimerOverlay,
  isThreeDSCloseError,
  warnIfOverlayNotFound,
} from './one-click-3ds';
import PrimerWrapper from './primer-wrapper';
import type {
  CreatePaymentResponse,
  MountWalletUpsellOptions,
  OneClickRequest,
  OneClickResult,
  OneClickWalletSessionData,
  ThreeDSResult,
  WalletKind,
  WalletUpsellMount,
  WalletUpsellResult,
} from './types';
import { overlayNativeApplePayButton } from './utils/apple-pay-native-button';
import { getErrorImage } from './utils/error-image';
import { generateId } from './utils/helpers';

const WALLET_SESSION_INVALID = 'wallet_session_invalid';
const WALLETS: readonly string[] = ['APPLE_PAY', 'GOOGLE_PAY'];

const SESSION_REQUEST_TIMEOUT_MS = 15000;
/** How long Primer may take to report the payment methods the device can show. */
const METHODS_TIMEOUT_MS = 10000;
/**
 * The session is prepared again this long before it expires. The backend hands back an unused
 * session only while it has at least 10 minutes to live, so 15 always yields a fresh one.
 */
export const REFRESH_BEFORE_EXPIRY_MS = 15 * 60 * 1000;
/** A tap on a session with less left than this is refused and the session is replaced. */
export const TAP_MIN_REMAINING_MS = 60 * 1000;
/** Bounds the refresh timer for a session shorter than the refresh margin; a tap still checks it. */
const MIN_REFRESH_DELAY_MS = 60 * 1000;

const DEFAULT_BUTTON_HEIGHT = 54;
const DEFAULT_BUTTON_RADIUS = 28;

interface WalletSession {
  wallet: WalletKind;
  clientToken: string;
  sessionId: string;
  orderId: string;
  amount: number | null;
  currency: string | null;
  expiresAt: number;
}

interface RenderedButton {
  generation: number;
  button: IHeadlessPaymentMethodButton;
  wrapper: HTMLElement;
  styleEl: HTMLStyleElement;
  nativeOverlay: HTMLElement | null;
}

type WalletButtonStyle = NonNullable<MountWalletUpsellOptions['style']>;

/** The backend sends naive UTC timestamps; without a zone `Date.parse` would read local time. */
function parseUtc(value: string): number {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

function parseWalletSession(data: OneClickWalletSessionData): WalletSession {
  const expiresAt = data.expires_at ? parseUtc(data.expires_at) : NaN;
  if (
    !WALLETS.includes(data.wallet as string) ||
    !data.client_token ||
    !data.session_id ||
    !data.order_id ||
    !Number.isFinite(expiresAt)
  ) {
    throw new APIError('Invalid one_click_wallet_session response', null, {
      response: data,
    });
  }
  return {
    wallet: data.wallet as WalletKind,
    clientToken: data.client_token,
    sessionId: data.session_id,
    orderId: data.order_id,
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    expiresAt,
  };
}

/** `null` = the customer's saved method is not a Primer wallet. */
async function prepareSession(
  apiClient: APIClient,
  options: MountWalletUpsellOptions
): Promise<WalletSession | null> {
  const response = await apiClient.oneClickWalletSession(
    {
      pp_ident: options.priceId,
      external_id: options.externalId,
      client_metadata: options.clientMetadata || {},
    },
    SESSION_REQUEST_TIMEOUT_MS
  );
  if (response?.status !== 'success' || !response.data) {
    throw new APIError('one_click_wallet_session failed', null, { response });
  }
  if (response.data.wallet === null) {
    return null;
  }
  return parseWalletSession(response.data);
}

/** Primer's wallet options for the requested style; a type the wallet lacks becomes `plain`. */
function primerWalletOptions(
  wallet: WalletKind,
  style: WalletButtonStyle
): Pick<HeadlessUniversalCheckoutOptions, 'applePay' | 'googlePay'> {
  const buttonType = style.buttonType || 'plain';
  const buttonColor = style.buttonColor || 'black';
  if (wallet === 'APPLE_PAY') {
    return {
      applePay: {
        buttonType: buttonType === 'buy' ? 'buy' : 'plain',
        buttonStyle: buttonColor,
      },
    };
  }
  return {
    googlePay: {
      buttonType: buttonType === 'continue' ? 'plain' : buttonType,
      buttonColor: buttonColor === 'black' ? 'black' : 'white',
      buttonSizeMode: 'fill',
    },
  };
}

function toError(message: string, error: unknown): Error {
  if (error instanceof FunnefoxSDKError) {
    return error;
  }
  return new PrimerError(message, error);
}

function callSafely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Primer handler calls are best effort once the outcome is decided.
  }
}

function isApiErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof APIError &&
    (error.errorCode === code ||
      getResponseErrorCodes(error.response).includes(code))
  );
}

/** One mounted wallet button and the attempts made with it. */
class WalletUpsell {
  private readonly apiClient: APIClient;
  private readonly inFlightKey: string;
  private session: WalletSession;
  private rendered: RenderedButton | null = null;
  private generation = 0;

  private destroyed = false;
  /** An outcome other than `cancelled` was reported: the button stays disabled. */
  private finished = false;
  private disabledByCaller = false;
  private refreshing: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private attemptRunning = false;
  private tokenizeStarted = false;
  /** The wallet token reached us: from here the attempt ends only with the charge's answer. */
  private charging = false;
  private threeDS: {
    orderId: string;
    challenged: boolean;
    revealTimer: ReturnType<typeof setTimeout> | null;
    timer: ReturnType<typeof setTimeout> | null;
    showOverlay: () => void;
  } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: MountWalletUpsellOptions,
    session: WalletSession
  ) {
    this.session = session;
    this.apiClient = WalletUpsell.apiClientFor(options);
    this.inFlightKey = oneClickInFlightKey(options.orgId, options.externalId);
  }

  static apiClientFor(options: MountWalletUpsellOptions): APIClient {
    return new APIClient({
      baseUrl: options.baseUrl || defaultBaseUrl(),
      orgId: options.orgId,
      timeout: DEFAULTS.REQUEST_TIMEOUT,
      retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
    });
  }

  /** Renders the button for the current session: `false` when the device cannot show the wallet. */
  async render(): Promise<boolean> {
    const generation = ++this.generation;
    const session = this.session;
    const style = this.options.style || {};
    await new PrimerWrapper().ensurePrimerLoaded();

    let reportMethods: (types: string[]) => void = () => {};
    let methodsTimer: ReturnType<typeof setTimeout> | null = null;
    const methods = new Promise<string[]>((resolve, reject) => {
      reportMethods = resolve;
      methodsTimer = setTimeout(
        () =>
          reject(
            new PrimerError(
              'Primer did not report the available payment methods'
            )
          ),
        METHODS_TIMEOUT_MS
      );
    }).finally(() => clearTimeout(methodsTimer));

    // A dedicated instance: the checkouts' HeadlessManager caches by client token, and a
    // remounted upsell gets the same token back, so the cache would hand out a headless whose
    // callbacks belong to a destroyed mount.
    const headless: PrimerHeadlessCheckout = await window.Primer.createHeadless(
      session.clientToken,
      {
        paymentHandling: PRIMER_DEFAULTS.PAYMENT_HANDLING,
        apiVersion: PRIMER_DEFAULTS.API_VERSION,
        ...primerWalletOptions(session.wallet, style),
        onAvailablePaymentMethodsLoad: (items: PaymentMethodInfo[]) =>
          reportMethods(items.map(item => item.type)),
        onTokenizeShouldStart: () => this.onTap(generation),
        onTokenizeStart: () => {
          if (generation === this.generation) {
            this.tokenizeStarted = true;
          }
        },
        onPaymentMethodAction: action => {
          if (action === 'PAYMENT_METHOD_UNSELECTED') {
            this.onSheetClosed(generation);
          }
        },
        onTokenizeSuccess: (
          data: PaymentMethodToken,
          handler: OnTokenizeSuccessHandler
        ) => this.onTokenized(generation, data, handler),
        onTokenizeError: (error: PrimerClientError) =>
          this.onPrimerFailure(generation, 'Wallet tokenization failed', error),
        onResumeSuccess: (data: ResumeToken, handler: OnResumeSuccessHandler) =>
          this.onResumed(generation, data, handler),
        onResumeError: (error: PrimerClientError) =>
          this.onResumeError(generation, error),
        onCheckoutFail: (error: PrimerClientError) =>
          this.onPrimerFailure(generation, 'Primer checkout failed', error),
      } as unknown as HeadlessUniversalCheckoutOptions
    );
    await headless.start();
    const available = await methods;
    if (!available.includes(session.wallet)) {
      return false;
    }

    const manager = await headless.createPaymentMethodManager(session.wallet);
    if (!manager || typeof manager.createButton !== 'function') {
      throw new PrimerError(`No ${session.wallet} button manager`);
    }
    const rendered = this.mountButton(
      generation,
      manager.createButton(),
      session.wallet,
      style
    );
    try {
      await rendered.button.render(rendered.wrapper, {});
      if (session.wallet === 'APPLE_PAY' && rendered.nativeOverlay === null) {
        rendered.nativeOverlay = await this.overlayAppleType(rendered, style);
      }
    } catch (error) {
      this.removeButton(rendered);
      throw error;
    }
    if (this.destroyed || generation !== this.generation) {
      this.removeButton(rendered);
      return true;
    }
    const previous = this.rendered;
    this.rendered = rendered;
    if (previous) {
      this.removeButton(previous);
    }
    this.applyDisabled();
    this.scheduleRefresh();
    return true;
  }

  private mountButton(
    generation: number,
    button: IHeadlessPaymentMethodButton,
    wallet: WalletKind,
    style: WalletButtonStyle
  ): RenderedButton {
    // Primer does not size its wallet buttons (FFB-169), so the wrapper's rules do.
    const wrapper = document.createElement('div');
    wrapper.className = generateId('funnelfox-wallet-upsell');
    const height = style.height ?? DEFAULT_BUTTON_HEIGHT;
    const radius = style.borderRadius ?? DEFAULT_BUTTON_RADIUS;
    const styleEl = document.createElement('style');
    styleEl.textContent = [
      `.${wrapper.className}{width:100%!important}`,
      `.${wrapper.className} button{height:${height}px!important;border-radius:${radius}px!important}`,
      wallet === 'APPLE_PAY' && style.buttonType === 'continue'
        ? `.${wrapper.className} > button{opacity:0!important}`
        : '',
    ].join('\n');
    document.head.appendChild(styleEl);
    this.container.appendChild(wrapper);
    return { generation, button, wrapper, styleEl, nativeOverlay: null };
  }

  /** PRD-1426: WebKit draws only the legacy Apple Pay types, so `continue` uses Apple's element. */
  private async overlayAppleType(
    rendered: RenderedButton,
    style: WalletButtonStyle
  ): Promise<HTMLElement | null> {
    if (style.buttonType !== 'continue') {
      return null;
    }
    const overlay = await overlayNativeApplePayButton(rendered.wrapper, {
      buttonType: style.buttonType as string,
      buttonStyle: style.buttonColor || 'black',
      borderRadius: style.borderRadius ?? DEFAULT_BUTTON_RADIUS,
    });
    if (!overlay) {
      // Apple's element could not load: show Primer's own (plain) button.
      rendered.styleEl.textContent = rendered.styleEl.textContent.replace(
        `.${rendered.wrapper.className} > button{opacity:0!important}`,
        ''
      );
    }
    return overlay;
  }

  private removeButton(rendered: RenderedButton): void {
    callSafely(() => rendered.button.clean());
    rendered.nativeOverlay?.remove();
    rendered.wrapper.remove();
    rendered.styleEl.remove();
  }

  private applyDisabled(): void {
    const rendered = this.rendered;
    if (!rendered) {
      return;
    }
    const disabled = this.finished || this.disabledByCaller;
    void Promise.resolve(rendered.button.setDisabled(disabled)).catch(() => {});
    if (rendered.nativeOverlay) {
      rendered.nativeOverlay.style.pointerEvents = disabled ? 'none' : '';
      rendered.nativeOverlay.style.opacity = disabled ? '0.5' : '';
    }
  }

  setDisabled(disabled: boolean): void {
    this.disabledByCaller = disabled;
    this.applyDisabled();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.generation += 1;
    if (this.attemptRunning && !this.charging) {
      // Primer's callbacks for this mount are ignored from now on, so nothing else ends it.
      this.attemptRunning = false;
      oneClickInFlight.delete(this.inFlightKey);
    }
    this.clearRefresh();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.rendered) {
      this.removeButton(this.rendered);
      this.rendered = null;
    }
  }

  // ---------- session life ----------

  watchVisibility(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.expiresSoon()) {
      this.refresh();
    }
  };

  private expiresSoon(minRemainingMs = REFRESH_BEFORE_EXPIRY_MS): boolean {
    return this.session.expiresAt - Date.now() < minRemainingMs;
  }

  private clearRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleRefresh(): void {
    this.clearRefresh();
    if (this.destroyed || this.finished) {
      return;
    }
    const delay = Math.max(
      this.session.expiresAt - REFRESH_BEFORE_EXPIRY_MS - Date.now(),
      MIN_REFRESH_DELAY_MS
    );
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, delay);
  }

  /** Replaces the session and the button before the session expires; never during an attempt. */
  private refresh(): void {
    // An attempt ends either for good or as `cancelled`, which checks the session again.
    if (
      this.refreshing ||
      this.destroyed ||
      this.finished ||
      this.attemptRunning
    ) {
      return;
    }
    this.refreshing = this.replaceSession().finally(() => {
      this.refreshing = null;
    });
  }

  private async replaceSession(): Promise<void> {
    let failure: Error | null = null;
    try {
      const next = await prepareSession(this.apiClient, this.options);
      if (this.destroyed || this.finished) {
        return;
      }
      if (!next || next.wallet !== this.session.wallet) {
        failure = new FunnefoxSDKError(
          'The wallet upsell is no longer available for this customer',
          'wallet_upsell_unavailable'
        );
      } else {
        this.session = next;
        if (!(await this.render())) {
          failure = new FunnefoxSDKError(
            'This device can no longer show the wallet',
            'wallet_upsell_unavailable'
          );
        }
      }
    } catch (error) {
      failure = toError('Failed to prepare the wallet upsell again', error);
    }
    if (failure && !this.destroyed && !this.finished && !this.attemptRunning) {
      // The button can no longer charge: the caller takes its own path.
      this.report({
        outcome: 'error',
        orderId: null,
        threeDSChallenged: false,
        error: failure,
      });
    }
  }

  // ---------- attempt ----------

  private onTap(generation: number): boolean {
    if (
      generation !== this.generation ||
      this.destroyed ||
      this.finished ||
      this.disabledByCaller ||
      this.refreshing ||
      // Double tap, either wallet.
      this.attemptRunning ||
      oneClickInFlight.has(this.inFlightKey)
    ) {
      return false;
    }
    if (this.expiresSoon(TAP_MIN_REMAINING_MS)) {
      // Apple Pay needs the tap itself to open the sheet: the customer taps the new button.
      this.refresh();
      return false;
    }
    this.attemptRunning = true;
    this.tokenizeStarted = false;
    oneClickInFlight.add(this.inFlightKey);
    callHook('onStart', this.options.onStart, undefined);
    return true;
  }

  private onSheetClosed(generation: number): void {
    if (
      generation !== this.generation ||
      !this.attemptRunning ||
      this.tokenizeStarted
    ) {
      return;
    }
    this.finish({
      outcome: 'cancelled',
      orderId: null,
      threeDSChallenged: false,
    });
  }

  private onPrimerFailure(
    generation: number,
    message: string,
    error: PrimerClientError
  ): void {
    if (generation !== this.generation || !this.attemptRunning) {
      return;
    }
    if (this.threeDS) {
      this.endThreeDS('failed');
      this.finish({
        outcome: '3ds_failed',
        orderId: this.session.orderId,
        threeDSChallenged: this.threeDSChallenged(),
        error: toError('3DS authentication failed', error),
      });
      return;
    }
    this.finish({
      outcome: 'error',
      orderId: null,
      threeDSChallenged: false,
      error: toError(message, error),
    });
  }

  private onTokenized(
    generation: number,
    data: PaymentMethodToken,
    handler: OnTokenizeSuccessHandler
  ): void {
    if (
      generation !== this.generation ||
      !this.attemptRunning ||
      this.threeDS
    ) {
      callSafely(() => handler.handleFailure());
      return;
    }
    this.tokenizeStarted = true;
    this.charging = true;
    void this.charge(data.token, handler, false).catch(error => {
      callSafely(() => handler.handleFailure());
      this.finish({
        outcome: 'error',
        orderId: this.session.orderId,
        threeDSChallenged: false,
        error: toError('Wallet upsell charge failed', error),
      });
    });
  }

  private async charge(
    paymentMethodToken: string,
    handler: OnTokenizeSuccessHandler,
    retried: boolean
  ): Promise<void> {
    const session = this.session;
    const payload: OneClickRequest = {
      pp_ident: this.options.priceId,
      external_id: this.options.externalId,
      client_metadata: (this.options.clientMetadata ||
        {}) as OneClickRequest['client_metadata'],
      payment_method_token: paymentMethodToken,
      session_id: session.sessionId,
    };
    if (this.options.displayCurrency) {
      payload.display_currency_code = this.options.displayCurrency;
    }
    const idempotencyKey = createIdempotencyKey();
    if (idempotencyKey) {
      payload.idempotency_key = idempotencyKey;
    }

    let response: CreatePaymentResponse;
    try {
      response = await postOneClick(this.apiClient, payload);
    } catch (error) {
      if (
        !retried &&
        isApiErrorWithCode(error, WALLET_SESSION_INVALID) &&
        (await this.sameAmountSession())
      ) {
        // Nothing was charged and the customer approved this very amount: one more try.
        return this.charge(paymentMethodToken, handler, true);
      }
      callSafely(() => handler.handleFailure());
      this.finish(this.chargeFailure(error, Boolean(idempotencyKey)));
      return;
    }

    const step = mapOneClickResponse(response);
    if (step.kind === 'result') {
      const result = step.result;
      if (result.outcome === 'succeeded' || result.outcome === 'processing') {
        callSafely(() => handler.handleSuccess());
      } else {
        callSafely(() =>
          handler.handleFailure(result.failedMessageForUser || undefined)
        );
      }
      this.finish(result);
      return;
    }
    this.startThreeDS(
      step.orderId || session.orderId,
      step.actionToken,
      handler
    );
  }

  /** A new session for the same amount the customer approved in the sheet. */
  private async sameAmountSession(): Promise<boolean> {
    try {
      const next = await prepareSession(this.apiClient, this.options);
      if (
        !next ||
        next.wallet !== this.session.wallet ||
        next.amount !== this.session.amount ||
        next.currency !== this.session.currency
      ) {
        return false;
      }
      this.session = next;
      return true;
    } catch {
      return false;
    }
  }

  private chargeFailure(error: unknown, keyed: boolean): OneClickResult {
    if (isApiErrorWithCode(error, DOUBLE_PURCHASE)) {
      return {
        outcome: 'already_purchased',
        orderId: null,
        threeDSChallenged: false,
      };
    }
    if (keyed && isRetryableOneClickError(error)) {
      // The charge may have gone through: the caller must not start a new payment.
      return {
        outcome: 'processing',
        orderId: this.session.orderId,
        threeDSChallenged: false,
        error: error as Error,
        failedRequest: 'one_click',
      };
    }
    return {
      outcome: 'error',
      orderId: null,
      threeDSChallenged: false,
      error:
        error instanceof Error ? error : toError('one_click failed', error),
      failedRequest: 'one_click',
    };
  }

  // ---------- 3DS ----------

  private threeDSChallenged(): boolean {
    return Boolean(this.threeDS?.challenged);
  }

  private startThreeDS(
    orderId: string,
    actionToken: string,
    handler: OnTokenizeSuccessHandler
  ): void {
    const intent = getPrimerTokenIntent(actionToken);
    if (!intent || !PRIMER_3DS_INTENTS.includes(intent)) {
      callSafely(() => handler.handleFailure());
      this.finish({
        outcome: 'error',
        orderId,
        threeDSChallenged: false,
        error: new PrimerError(
          'Unsupported one-click action: the action token is not a Primer 3DS client token',
          { intent }
        ),
      });
      return;
    }
    const timeoutMs = DEFAULT_THREE_DS_TIMEOUT_MS;
    const threeDS = {
      orderId,
      challenged: false,
      revealTimer: null as ReturnType<typeof setTimeout> | null,
      timer: null as ReturnType<typeof setTimeout> | null,
      showOverlay: hidePrimerOverlay(),
    };
    this.threeDS = threeDS;
    const onTimeout = () => {
      threeDS.timer = null;
      if (!threeDS.challenged) {
        // The overlay is about to be shown: the reveal restarts the timer.
        return;
      }
      this.endThreeDS('abandoned');
      this.finish({
        outcome: '3ds_abandoned',
        orderId,
        threeDSChallenged: true,
      });
      dismissPrimerOverlay();
    };
    threeDS.timer = setTimeout(onTimeout, timeoutMs);
    threeDS.revealTimer = setTimeout(() => {
      threeDS.revealTimer = null;
      threeDS.challenged = true;
      threeDS.showOverlay();
      warnIfOverlayNotFound();
      callHook('onThreeDSStart', this.options.onThreeDSStart, { orderId });
      if (threeDS.timer) {
        clearTimeout(threeDS.timer);
      }
      threeDS.timer = setTimeout(onTimeout, timeoutMs);
    }, THREE_DS_OVERLAY_REVEAL_DELAY_MS);
    handler.continueWithNewClientToken(actionToken);
  }

  /** Stops the 3DS timers; reports `onThreeDSEnd` once, and only after `onThreeDSStart`. */
  private endThreeDS(result: ThreeDSResult): void {
    const threeDS = this.threeDS;
    if (!threeDS) {
      return;
    }
    if (threeDS.timer) {
      clearTimeout(threeDS.timer);
      threeDS.timer = null;
    }
    if (threeDS.revealTimer) {
      clearTimeout(threeDS.revealTimer);
      threeDS.revealTimer = null;
    }
    threeDS.showOverlay();
    if (threeDS.challenged) {
      callHook('onThreeDSEnd', this.options.onThreeDSEnd, { result });
    }
  }

  private async onResumed(
    generation: number,
    data: ResumeToken,
    handler: OnResumeSuccessHandler
  ): Promise<void> {
    const threeDS = this.threeDS;
    if (generation !== this.generation || !this.attemptRunning || !threeDS) {
      callSafely(() => handler.handleFailure());
      return;
    }
    // The challenge is over: the timeout bounds only the challenge, never the POST.
    if (threeDS.timer) {
      clearTimeout(threeDS.timer);
      threeDS.timer = null;
    }
    if (threeDS.revealTimer) {
      clearTimeout(threeDS.revealTimer);
      threeDS.revealTimer = null;
    }
    let response: CreatePaymentResponse;
    try {
      response = await this.apiClient.resumePaymentOnce({
        orderId: threeDS.orderId,
        resumeToken: data.resumeToken,
      });
    } catch (error) {
      callSafely(() => handler.handleFailure());
      this.endThreeDS('error');
      this.finish({
        outcome: 'error',
        orderId: threeDS.orderId,
        threeDSChallenged: threeDS.challenged,
        error: error as Error,
        failedRequest: 'resume_payment',
      });
      return;
    }
    const mapped = mapResumeResponse(
      response,
      threeDS.orderId,
      threeDS.challenged
    );
    if (
      mapped.result.outcome === 'succeeded' ||
      mapped.result.outcome === 'processing'
    ) {
      callSafely(() => handler.handleSuccess());
    } else {
      callSafely(() =>
        handler.handleFailure(mapped.result.failedMessageForUser || undefined)
      );
    }
    this.endThreeDS(mapped.threeDS);
    this.finish(mapped.result);
  }

  private onResumeError(generation: number, error: PrimerClientError): void {
    const threeDS = this.threeDS;
    if (generation !== this.generation || !this.attemptRunning || !threeDS) {
      return;
    }
    if (isThreeDSCloseError(error)) {
      this.endThreeDS('abandoned');
      this.finish({
        outcome: '3ds_abandoned',
        orderId: threeDS.orderId,
        threeDSChallenged: threeDS.challenged,
      });
      return;
    }
    this.endThreeDS('failed');
    this.finish({
      outcome: '3ds_failed',
      orderId: threeDS.orderId,
      threeDSChallenged: threeDS.challenged,
      error: toError('3DS authentication failed', error),
    });
  }

  // ---------- result ----------

  /** Ends the running attempt with its one result; later calls for it are ignored. */
  private finish(result: WalletUpsellResult): void {
    if (!this.attemptRunning) {
      return;
    }
    this.attemptRunning = false;
    this.tokenizeStarted = false;
    this.charging = false;
    this.threeDS = null;
    oneClickInFlight.delete(this.inFlightKey);
    this.report(result);
  }

  private report(result: WalletUpsellResult): void {
    if (result.outcome !== 'cancelled') {
      this.finished = true;
      this.clearRefresh();
      this.applyDisabled();
    } else if (this.expiresSoon()) {
      this.refresh();
    }
    if (result.outcome === 'error' && result.error) {
      const error = result.error as Error & {
        code?: string;
        response?: { req_id?: string };
      };
      getErrorImage(this.options.orgId, {
        baseUrl: this.options.baseUrl || defaultBaseUrl(),
        message: error.message,
        code: error.code,
        req_id: error.response?.req_id,
      });
    }
    if (!this.destroyed) {
      callHook('onResult', this.options.onResult, result);
    }
  }
}

function validate(
  container: HTMLElement,
  options: MountWalletUpsellOptions
): void {
  if (
    typeof HTMLElement === 'undefined' ||
    !(container instanceof HTMLElement)
  ) {
    throw new ValidationError('container', 'must be an HTMLElement', container);
  }
  for (const field of ['orgId', 'priceId', 'externalId'] as const) {
    if (!options?.[field]) {
      throw new ValidationError(field, 'is required', options?.[field]);
    }
  }
  if (typeof options.onResult !== 'function') {
    throw new ValidationError(
      'onResult',
      'must be a function',
      options.onResult
    );
  }
}

/**
 * Mounts Primer's native Apple Pay / Google Pay button for a one-click upsell. Rejects only with
 * `ValidationError`; any `mounted: false` leaves nothing in `container`.
 */
export async function mountWalletUpsell(
  container: HTMLElement,
  options: MountWalletUpsellOptions
): Promise<WalletUpsellMount> {
  validate(container, options);

  let session: WalletSession | null;
  try {
    session = await prepareSession(WalletUpsell.apiClientFor(options), options);
  } catch (error) {
    return {
      mounted: false,
      reason: 'error',
      error:
        error instanceof Error
          ? error
          : toError('one_click_wallet_session failed', error),
    };
  }
  if (!session) {
    return { mounted: false, reason: 'not_wallet' };
  }

  const upsell = new WalletUpsell(container, options, session);
  try {
    if (!(await upsell.render())) {
      upsell.destroy();
      return {
        mounted: false,
        reason: 'wallet_unavailable',
        wallet: session.wallet,
      };
    }
  } catch (error) {
    upsell.destroy();
    return {
      mounted: false,
      reason: 'error',
      error: toError('Failed to mount the wallet button', error),
    };
  }
  upsell.watchVisibility();
  return {
    mounted: true,
    wallet: session.wallet,
    setDisabled: (disabled: boolean) => upsell.setDisabled(disabled),
    destroy: () => upsell.destroy(),
  };
}
