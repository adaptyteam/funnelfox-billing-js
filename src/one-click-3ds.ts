/**
 * @fileoverview 3DS challenge for one-click purchases (FFB-704). Internal module.
 *
 * Primer can run a 3DS challenge only from a tokenization handler
 * (`handler.continueWithNewClientToken`), and a one-click purchase has no tokenization in the
 * browser: the backend charges the vaulted instrument. Mechanism M1 (proven by the FFB-704 spike
 * on the Primer sandbox): open a customer-bound CHECKOUT client session, start a headless
 * checkout, tokenize a vaulted instrument through the vault manager as a stand-in, and in
 * `onTokenizeSuccess` continue with the one-click `action_required_token` instead. Primer then
 * shows its 3DS overlay; `onResumeSuccess` yields the resume token for `resume_payment`.
 *
 * With processor 3DS (`PROCESSOR_3DS`) Primer frames the processor's hosted 3DS page and cannot
 * tell a frictionless check from a challenge, and nothing reaches the page from the cross-origin
 * frame (FFB-758 spike). A frictionless check finishes within ~5 s, so the overlay stays
 * invisible for `THREE_DS_OVERLAY_REVEAL_DELAY_MS` and only then counts as a shown challenge.
 */

import type {
  OnResumeSuccessHandler,
  OnTokenizeSuccessHandler,
  PrimerClientError,
  PrimerHeadlessCheckout,
  ResumeToken,
  VaultedPaymentMethod,
} from '@primer-io/checkout-web';
import type APIClient from './api-client';
import { NetworkError, PrimerError } from './errors';
import PrimerWrapper from './primer-wrapper';
import type { CreatePaymentResponse, OneClickFailedRequest } from './types';
import { PRIMER_DEFAULTS } from './constants';

/** Primer client-token intents that carry a 3DS step. */
export const PRIMER_3DS_INTENTS = ['3DS_AUTHENTICATION', 'PROCESSOR_3DS'];

/** Default `threeDSTimeoutMs`. */
export const DEFAULT_THREE_DS_TIMEOUT_MS = 600000;

/**
 * How long Primer's 3DS overlay stays invisible. Frictionless checks on billing-dev took
 * 4.2-5.0 s from overlay to resume; a real challenge is shown this much later.
 */
export const THREE_DS_OVERLAY_REVEAL_DELAY_MS = 6000;

/** Primer's 3DS overlay (Primer Web SDK 2.57.3, verified in the FFB-758 spike). */
const PRIMER_OVERLAY_SELECTOR = '#primer-overlay';

/** Close button of Primer's 3DS overlay (Primer Web SDK 2.57.3, verified in the spike). */
const PRIMER_OVERLAY_CLOSE_SELECTOR =
  '[data-testid="OverlayContent.closeButton"]';

export type ThreeDSRunResult =
  | { kind: 'resumed'; response: CreatePaymentResponse }
  | { kind: 'failed'; error: Error }
  | { kind: 'abandoned' }
  | { kind: 'error'; error: Error; failedRequest?: OneClickFailedRequest };

export interface RunOneClickThreeDSParams {
  apiClient: APIClient;
  region: string;
  priceId: string;
  externalId: string;
  orderId: string;
  actionToken: string;
  timeoutMs: number;
  /** How long the overlay stays invisible (`THREE_DS_OVERLAY_REVEAL_DELAY_MS`). */
  revealDelayMs: number;
  /** Called once when the overlay becomes visible, i.e. the customer may see a challenge. */
  onChallengeShown: () => void;
}

/** Decodes the `intent` of a Primer client token (a JWT); `null` if it is not one. */
export function getPrimerTokenIntent(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { intent?: unknown };
    return typeof payload?.intent === 'string' ? payload.intent : null;
  } catch {
    return null;
  }
}

/** The error Primer reports when the user closes the 3DS overlay (same check as checkout.ts). */
export function isThreeDSCloseError(
  error: { code?: string; message?: string; stack?: string } | null
): boolean {
  return Boolean(
    error?.stack?.includes('PROCESSOR_3DS') &&
    error.code === 'RESUME_ERROR' &&
    error.message?.includes('fetch resume key')
  );
}

/**
 * Picks the vaulted instrument used as the stand-in tokenization. Primer returns the vault
 * oldest-first and has no "default" flag; the 3DS check runs on the action token, not on this
 * instrument. Cards are preferred because their vault tokenization is silent (no CVV prompt).
 */
export function pickVaultedMethod(
  methods: VaultedPaymentMethod[] | null | undefined
): VaultedPaymentMethod | null {
  if (!methods || methods.length === 0) {
    return null;
  }
  return (
    methods.find(method => method.paymentInstrumentType === 'PAYMENT_CARD') ||
    methods[0]
  );
}

function dismissPrimerOverlay(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const button = document.querySelector<HTMLElement>(
    PRIMER_OVERLAY_CLOSE_SELECTOR
  );
  button?.click();
}

/** Hides Primer's overlay until the returned function is called. */
function hidePrimerOverlay(): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  const style = document.createElement('style');
  style.textContent = `${PRIMER_OVERLAY_SELECTOR}{opacity:0!important;pointer-events:none!important}`;
  document.head.appendChild(style);
  return () => style.remove();
}

/**
 * A Primer update that renames the overlay would leave it visible during the hidden phase, while
 * `threeDSChallenged` stays false for a check that finishes in that time.
 */
function warnIfOverlayNotFound(): void {
  if (
    typeof document !== 'undefined' &&
    !document.querySelector(PRIMER_OVERLAY_SELECTOR)
  ) {
    console.warn(
      `[FunnelfoxSDK] Primer 3DS overlay ${PRIMER_OVERLAY_SELECTOR} not found`
    );
  }
}

function toPrimerError(message: string, error: unknown): PrimerError {
  return error instanceof PrimerError ? error : new PrimerError(message, error);
}

function callSafely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Primer handler calls are best effort once the result is decided.
  }
}

/**
 * Runs the 3DS challenge for a one-click order and, when Primer hands back a resume token,
 * calls `resume_payment` once. Never rejects; the caller maps the result to an outcome.
 */
export async function runOneClickThreeDS(
  params: RunOneClickThreeDSParams
): Promise<ThreeDSRunResult> {
  const { apiClient, region, priceId, externalId, orderId, actionToken } =
    params;

  const intent = getPrimerTokenIntent(actionToken);
  if (!intent || !PRIMER_3DS_INTENTS.includes(intent)) {
    return {
      kind: 'error',
      error: new PrimerError(
        'Unsupported one-click action: the action token is not a Primer 3DS client token',
        { intent }
      ),
    };
  }

  const timeoutMs =
    Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
      ? params.timeoutMs
      : DEFAULT_THREE_DS_TIMEOUT_MS;

  return new Promise<ThreeDSRunResult>(resolve => {
    let settled = false;
    let tokenized = false;
    let revealed = false;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let showOverlay: () => void = () => {};
    // True only while create_client_session is in flight.
    let sessionInFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let headless: PrimerHeadlessCheckout | null = null;

    const settle = (result: ThreeDSRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      showOverlay();
      headless = null;
      resolve(result);
    };

    const onTimeout = () => {
      timer = null;
      if (revealed) {
        // The challenge was shown and the customer did not finish it.
        settle({ kind: 'abandoned' });
        // Close Primer's overlay; the close error it raises is ignored (already settled).
        dismissPrimerOverlay();
        return;
      }
      // No challenge was shown yet: this is a setup failure, not an abandoned challenge.
      if (sessionInFlight) {
        settle({
          kind: 'error',
          error: new NetworkError(
            'create_client_session did not respond within threeDSTimeoutMs'
          ),
          failedRequest: 'create_client_session',
        });
        return;
      }
      if (tokenized) {
        // The overlay is about to be shown: the reveal restarts the timer.
        return;
      }
      settle({
        kind: 'error',
        error: new PrimerError(
          'Timed out before the 3DS challenge was shown (threeDSTimeoutMs)'
        ),
      });
    };
    timer = setTimeout(onTimeout, timeoutMs);

    const onTokenizeSuccess = (
      _data: unknown,
      handler: OnTokenizeSuccessHandler
    ) => {
      // A repeated tokenization would start a second reveal timer, so the challenge
      // (and the caller's onThreeDSStart) would be reported twice: refuse it.
      if (settled || tokenized) {
        callSafely(() => handler.handleFailure());
        return;
      }
      tokenized = true;
      showOverlay = hidePrimerOverlay();
      revealTimer = setTimeout(() => {
        revealTimer = null;
        revealed = true;
        showOverlay();
        warnIfOverlayNotFound();
        callSafely(params.onChallengeShown);
        // The whole timeout belongs to the challenge the customer can see.
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(onTimeout, timeoutMs);
      }, params.revealDelayMs);
      // Ignore the stand-in vaulted token: run the one-click 3DS action instead.
      handler.continueWithNewClientToken(actionToken);
    };

    const onResumeSuccess = async (
      data: ResumeToken,
      handler: OnResumeSuccessHandler
    ) => {
      if (settled) {
        callSafely(() => handler.handleFailure());
        return;
      }
      // The challenge is over: the timeout bounds only the challenge, never the POST.
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      let response: CreatePaymentResponse;
      try {
        response = await apiClient.resumePaymentOnce({
          orderId,
          resumeToken: data.resumeToken,
        });
      } catch (error) {
        callSafely(() => handler.handleFailure());
        settle({
          kind: 'error',
          error: error as Error,
          failedRequest: 'resume_payment',
        });
        return;
      }
      const resumeData = response?.data;
      if (
        response?.status === 'success' &&
        resumeData?.checkout_status === 'succeeded' &&
        !resumeData.action_required_token
      ) {
        callSafely(() => handler.handleSuccess());
      } else {
        // A chained action token is never continued (no second challenge).
        callSafely(() =>
          handler.handleFailure(
            resumeData?.failed_message_for_user || undefined
          )
        );
      }
      settle({ kind: 'resumed', response });
    };

    const onResumeError = (error: PrimerClientError) => {
      if (isThreeDSCloseError(error)) {
        settle({ kind: 'abandoned' });
        return;
      }
      settle({
        kind: 'failed',
        error: toPrimerError('3DS authentication failed', error),
      });
    };

    const onCheckoutFail = (error: PrimerClientError) => {
      if (tokenized) {
        settle({
          kind: 'failed',
          error: toPrimerError('3DS authentication failed', error),
        });
      } else {
        settle({
          kind: 'error',
          error: toPrimerError(
            'Primer checkout failed before the 3DS challenge',
            error
          ),
        });
      }
    };

    const onTokenizeError = (error: PrimerClientError) => {
      settle({
        kind: 'error',
        error: toPrimerError(
          'Failed to tokenize the saved payment method',
          error
        ),
      });
    };

    (async () => {
      await new PrimerWrapper().ensurePrimerLoaded();
      if (settled) {
        return;
      }

      let clientToken: string;
      sessionInFlight = true;
      try {
        const session = await apiClient.createClientSession({
          priceId,
          externalId,
          region,
          clientMetadata: {},
        });
        clientToken = apiClient.processSessionResponse(session).clientToken;
        sessionInFlight = false;
      } catch (error) {
        sessionInFlight = false;
        settle({
          kind: 'error',
          error: error as Error,
          failedRequest: 'create_client_session',
        });
        return;
      }
      if (settled) {
        return;
      }

      // A dedicated instance, not the HeadlessManager cache used by checkouts.
      const instance = await window.Primer.createHeadless(clientToken, {
        paymentHandling: PRIMER_DEFAULTS.PAYMENT_HANDLING,
        apiVersion: PRIMER_DEFAULTS.API_VERSION,
        onAvailablePaymentMethodsLoad: () => {},
        onTokenizeSuccess,
        onTokenizeError,
        onResumeSuccess,
        onResumeError,
        onCheckoutFail,
      });
      headless = await instance;
      await headless.start();
      if (settled) {
        return;
      }

      const vaultManager = headless.createVaultManager();
      const methods = await vaultManager.fetchVaultedPaymentMethods();
      const method = pickVaultedMethod(methods);
      if (!method) {
        settle({
          kind: 'error',
          error: new PrimerError(
            'No saved payment method found for the one-click 3DS challenge'
          ),
        });
        return;
      }
      if (settled) {
        return;
      }
      await vaultManager.startPaymentFlow(method.id);
    })().catch(error => {
      settle({
        kind: 'error',
        error: toPrimerError(
          'Failed to start the one-click 3DS challenge',
          error
        ),
      });
    });
  });
}
