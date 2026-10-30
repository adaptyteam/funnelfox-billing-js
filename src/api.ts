/**
 * @fileoverview Public API with configuration and orchestration logic
 */

import CheckoutInstance from './checkout';
import APIClient, { getResponseErrorCodes } from './api-client';
import PrimerWrapper from './primer-wrapper';
import { DEFAULT_BUTTONS_OPTIONS, DEFAULTS } from './constants';
import * as constants from './constants';
import type {
  SDKConfig,
  CreateCheckoutOptions,
  APIConfig,
  CreateClientSessionOptions,
  InitMethodOptions,
  StripeCardFormOptions,
  StripeCardForm,
  StripeWalletOptions,
  SilentPurchaseOptions,
  SilentPurchaseDetailedOptions,
  OneClickRequest,
  OneClickResult,
  ThreeDSResult,
  CreatePaymentResponse,
  PaymentResponseData,
} from './types';
import { APIError, FunnefoxSDKError, ValidationError } from './errors';
import {
  DEFAULT_THREE_DS_TIMEOUT_MS,
  runOneClickThreeDS,
  type ThreeDSRunResult,
} from './one-click-3ds';
import { PaymentMethod } from './enums';
import { getErrorImage } from './utils/error-image';
import sessionService from './shared/services/session-service';

let defaultConfig: SDKConfig | null = null;

export function configure(config: SDKConfig): void {
  defaultConfig = config;
}

function resolveConfig(
  options: { orgId?: string; apiConfig?: APIConfig },
  functionName: string
): { orgId: string; baseUrl: string; region: string } {
  const { orgId, apiConfig } = options || {};

  const finalOrgId = orgId || defaultConfig?.orgId;
  if (!finalOrgId) {
    throw new Error(
      `orgId is required. Pass it to ${functionName}() or call configure() first.`
    );
  }

  const finalBaseUrl =
    apiConfig?.baseUrl || defaultConfig?.baseUrl || DEFAULTS.BASE_URL;
  const finalRegion =
    apiConfig?.region || defaultConfig?.region || DEFAULTS.REGION;

  return {
    orgId: finalOrgId,
    baseUrl: finalBaseUrl,
    region: finalRegion,
  };
}

export async function createCheckout(
  options: CreateCheckoutOptions
): Promise<CheckoutInstance> {
  try {
    const { ...checkoutConfig } = options;
    // Which Primer SDK to load is known only from the session; each wrapper loads its own when it starts.
    const config = resolveConfig(options, 'createCheckout');

    const checkout = new CheckoutInstance({
      ...config,
      checkoutConfig: {
        ...checkoutConfig,
      },
    });
    await checkout.initialize();
    return checkout;
  } catch (error) {
    getErrorImage(options.orgId, {
      baseUrl: options.apiConfig?.baseUrl,
      message: error.message,
      code: error.code,
      req_id: error?.response?.req_id,
    });
    throw error;
  }
}

export async function createClientSession(
  params: CreateClientSessionOptions
): Promise<{ clientToken: string; orderId: string; type: string }> {
  const { priceId, externalId, email, clientMetadata, countryCode } = params;

  const config = resolveConfig(params, 'createClientSession');

  const apiClient = new APIClient({
    baseUrl: config.baseUrl,
    orgId: config.orgId,
    timeout: DEFAULTS.REQUEST_TIMEOUT,
    retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
  });

  const sessionResponse = await apiClient.createClientSession({
    priceId,
    externalId,
    email,
    region: config.region,
    clientMetadata,
    countryCode,
  });

  return apiClient.processSessionResponse(sessionResponse);
}

/**
 * Builds the `one_click` body. The CIT fields are added only when the caller set them.
 */
export function buildOneClickRequest(
  options: SilentPurchaseOptions
): OneClickRequest {
  const payload: OneClickRequest = {
    pp_ident: options.priceId,
    external_id: options.externalId,
    client_metadata: options.clientMetadata,
  };
  if (options.initiationType !== undefined) {
    payload.initiation_type = options.initiationType;
  }
  if (options.citCardNetworks !== undefined) {
    payload.cit_card_networks = options.citCardNetworks;
  }
  if (options.citGooglePayPanOnly !== undefined) {
    payload.cit_google_pay_pan_only = options.citGooglePayPanOnly;
  }
  return payload;
}

export function silentPurchase(
  options: SilentPurchaseOptions & { handle3DS?: false }
): Promise<boolean>;
export function silentPurchase(
  options: SilentPurchaseDetailedOptions
): Promise<OneClickResult>;
export function silentPurchase(
  options: SilentPurchaseOptions | SilentPurchaseDetailedOptions
): Promise<boolean | OneClickResult> {
  if ((options as SilentPurchaseDetailedOptions)?.handle3DS === true) {
    return silentPurchaseDetailed(options as SilentPurchaseDetailedOptions);
  }
  return silentPurchaseLegacy(options);
}

async function silentPurchaseLegacy(options: SilentPurchaseOptions) {
  const { orgId, baseUrl } = options;
  const apiClient = new APIClient({
    baseUrl: baseUrl,
    orgId: orgId,
    timeout: DEFAULTS.REQUEST_TIMEOUT,
    retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
  });

  if (options.initiationType === 'cit') {
    // eslint-disable-next-line no-console
    console.warn(
      '[FunnelfoxSDK] silentPurchase: initiationType "cit" can trigger a 3DS challenge, which only silentPurchase({ handle3DS: true }) handles.'
    );
  }

  try {
    const response = await apiClient.oneClick(buildOneClickRequest(options));
    if (
      response.status !== 'success' &&
      response.error.some(({ code }) => code === 'double_purchase')
    ) {
      throw new APIError('This product was already purchased');
    } else if (response.status !== 'success') {
      return false;
    }

    return true;
  } catch (error) {
    getErrorImage(orgId, {
      baseUrl,
      message: error.message,
      code: error.code,
      req_id: error?.response?.req_id,
    });
    throw error;
  }
}

const ONE_CLICK_IN_PROGRESS = 'one_click_in_progress';
const DOUBLE_PURCHASE = 'double_purchase';
const oneClickInFlight = new Set<string>();

type OneClickStep =
  | { kind: 'result'; result: OneClickResult }
  | { kind: 'action'; orderId: string; actionToken: string };

function declineFields(
  data: PaymentResponseData
): Pick<
  OneClickResult,
  'failedMessageForUser' | 'declineCode' | 'declineCodeSource'
> {
  return {
    failedMessageForUser: data.failed_message_for_user ?? null,
    declineCode: data.decline_code ?? null,
    declineCodeSource: data.decline_code_source ?? null,
  };
}

function envelopeError(
  response: CreatePaymentResponse,
  fallbackMessage: string
): APIError {
  const firstError = response?.error?.[0];
  return new APIError(firstError?.msg || fallbackMessage, null, {
    errorCode: firstError?.code,
    errorType: firstError?.type,
    response,
  });
}

/** Maps a 2xx `one_click` response (rows 1-4, plus "needs action"). */
export function mapOneClickResponse(
  response: CreatePaymentResponse
): OneClickStep {
  const data = response?.data;
  if (response?.status !== 'success' || !data) {
    if (getResponseErrorCodes(response).includes(DOUBLE_PURCHASE)) {
      return {
        kind: 'result',
        result: {
          outcome: 'already_purchased',
          orderId: null,
          threeDSChallenged: false,
        },
      };
    }
    return {
      kind: 'result',
      result: {
        outcome: 'error',
        orderId: data?.order_id ?? null,
        threeDSChallenged: false,
        error: envelopeError(response, 'One-click purchase failed'),
        failedRequest: 'one_click',
      },
    };
  }
  const orderId = data.order_id ?? null;
  if (data.action_required_token) {
    return { kind: 'action', orderId, actionToken: data.action_required_token };
  }
  switch (data.checkout_status) {
    case 'succeeded':
      return {
        kind: 'result',
        result: { outcome: 'succeeded', orderId, threeDSChallenged: false },
      };
    case 'failed':
      return {
        kind: 'result',
        result: {
          outcome: 'declined',
          orderId,
          threeDSChallenged: false,
          ...declineFields(data),
        },
      };
    case 'processing':
      return {
        kind: 'result',
        result: { outcome: 'processing', orderId, threeDSChallenged: false },
      };
    case 'cancelled':
      return {
        kind: 'result',
        result: {
          outcome: 'error',
          orderId,
          threeDSChallenged: false,
          error: new APIError('Payment was cancelled', null, { response }),
        },
      };
    default:
      return {
        kind: 'result',
        result: {
          outcome: 'error',
          orderId,
          threeDSChallenged: false,
          error: new APIError(
            `Unhandled checkout status: ${data.checkout_status}`,
            null,
            { response }
          ),
        },
      };
  }
}

/** Maps a `resume_payment` response after a challenge (rows 5, 6, 6b, 6c, 7, 8). */
export function mapResumeResponse(
  response: CreatePaymentResponse,
  orderId: string,
  threeDSAuthDeclineCodes:
    | string[]
    | null = constants.THREE_DS_AUTH_DECLINE_CODES
): { result: OneClickResult; threeDS: ThreeDSResult } {
  const data = response?.data;
  if (response?.status !== 'success' || !data) {
    return {
      threeDS: 'error',
      result: {
        outcome: 'error',
        orderId,
        threeDSChallenged: true,
        error: envelopeError(response, 'Resume payment failed'),
        failedRequest: 'resume_payment',
      },
    };
  }
  if (data.action_required_token) {
    // Chained action: not supported, no second challenge (human decision F3).
    return {
      threeDS: 'error',
      result: {
        outcome: 'error',
        orderId,
        threeDSChallenged: true,
        error: new FunnefoxSDKError(
          'resume_payment returned another action token; chained 3DS is not supported',
          'one_click_chained_action'
        ),
      },
    };
  }
  switch (data.checkout_status) {
    case 'succeeded':
      return {
        threeDS: 'passed',
        result: { outcome: 'succeeded', orderId, threeDSChallenged: true },
      };
    case 'processing':
      return {
        threeDS: 'passed',
        result: { outcome: 'processing', orderId, threeDSChallenged: true },
      };
    case 'failed': {
      const authFailed =
        threeDSAuthDeclineCodes === null ||
        threeDSAuthDeclineCodes.includes(data.decline_code ?? '');
      return {
        threeDS: authFailed ? 'failed' : 'passed',
        result: {
          outcome: authFailed ? '3ds_failed' : 'declined',
          orderId,
          threeDSChallenged: true,
          ...declineFields(data),
        },
      };
    }
    default:
      return {
        threeDS: 'error',
        result: {
          outcome: 'error',
          orderId,
          threeDSChallenged: true,
          error: new APIError(
            data.checkout_status === 'cancelled'
              ? 'Payment was cancelled'
              : `Unhandled checkout status: ${data.checkout_status}`,
            null,
            { response }
          ),
        },
      };
  }
}

function mapThreeDSRun(
  run: ThreeDSRunResult,
  orderId: string
): { result: OneClickResult; threeDS: ThreeDSResult } {
  switch (run.kind) {
    case 'resumed':
      return mapResumeResponse(run.response, orderId);
    case 'failed':
      return {
        threeDS: 'failed',
        result: {
          outcome: '3ds_failed',
          orderId,
          threeDSChallenged: true,
          error: run.error,
        },
      };
    case 'abandoned':
      return {
        threeDS: 'abandoned',
        result: { outcome: '3ds_abandoned', orderId, threeDSChallenged: true },
      };
    default: {
      const result: OneClickResult = {
        outcome: 'error',
        orderId,
        threeDSChallenged: true,
        error: run.error,
      };
      if (run.failedRequest) {
        result.failedRequest = run.failedRequest;
      }
      return { threeDS: 'error', result };
    }
  }
}

function callHook<T>(
  name: string,
  hook: ((info: T) => void) | undefined,
  info: T
) {
  if (typeof hook !== 'function') {
    return;
  }
  try {
    hook(info);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[FunnelfoxSDK] silentPurchase ${name} hook threw`, error);
  }
}

async function silentPurchaseDetailed(
  options: SilentPurchaseDetailedOptions
): Promise<OneClickResult> {
  for (const field of ['orgId', 'baseUrl', 'priceId', 'externalId'] as const) {
    if (!options?.[field]) {
      throw new ValidationError(field, 'is required', options?.[field]);
    }
  }
  const { orgId, baseUrl, externalId } = options;

  const inFlightKey = `${orgId}\u0000${externalId}`;
  if (oneClickInFlight.has(inFlightKey)) {
    return {
      outcome: 'error',
      orderId: null,
      threeDSChallenged: false,
      error: new FunnefoxSDKError(
        'A one-click purchase is already in progress for this customer',
        ONE_CLICK_IN_PROGRESS
      ),
    };
  }

  oneClickInFlight.add(inFlightKey);
  try {
    const result = await runSilentPurchaseDetailed(options);
    if (result.outcome === 'error' && result.error) {
      const error = result.error as Error & {
        code?: string;
        response?: { req_id?: string };
      };
      getErrorImage(orgId, {
        baseUrl,
        message: error.message,
        code: error.code,
        req_id: error.response?.req_id,
      });
    }
    return result;
  } finally {
    oneClickInFlight.delete(inFlightKey);
  }
}

async function runSilentPurchaseDetailed(
  options: SilentPurchaseDetailedOptions
): Promise<OneClickResult> {
  const apiClient = new APIClient({
    baseUrl: options.baseUrl,
    orgId: options.orgId,
    timeout: DEFAULTS.REQUEST_TIMEOUT,
    retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
  });

  let response: CreatePaymentResponse;
  try {
    response = await apiClient.oneClickOnce(buildOneClickRequest(options));
  } catch (error) {
    if (
      error instanceof APIError &&
      getResponseErrorCodes(error.response).includes(DOUBLE_PURCHASE)
    ) {
      return {
        outcome: 'already_purchased',
        orderId: null,
        threeDSChallenged: false,
      };
    }
    return {
      outcome: 'error',
      orderId: null,
      threeDSChallenged: false,
      error: error as Error,
      failedRequest: 'one_click',
    };
  }

  const step = mapOneClickResponse(response);
  if (step.kind === 'result') {
    return step.result;
  }

  const { orderId, actionToken } = step;
  let ended = false;
  const end = (result: ThreeDSResult) => {
    if (ended) {
      return;
    }
    ended = true;
    callHook('onThreeDSEnd', options.onThreeDSEnd, { result });
  };

  callHook('onThreeDSStart', options.onThreeDSStart, { orderId });
  try {
    const run = await runOneClickThreeDS({
      apiClient,
      region: defaultConfig?.region || DEFAULTS.REGION,
      priceId: options.priceId,
      externalId: options.externalId,
      orderId,
      actionToken,
      timeoutMs: options.threeDSTimeoutMs ?? DEFAULT_THREE_DS_TIMEOUT_MS,
    });
    const mapped = mapThreeDSRun(run, orderId);
    end(mapped.threeDS);
    return mapped.result;
  } catch (error) {
    end('error');
    return {
      outcome: 'error',
      orderId,
      threeDSChallenged: true,
      error:
        error instanceof Error
          ? error
          : new FunnefoxSDKError('One-click 3DS step failed', undefined, error),
    };
  }
}

export async function initMethod(
  method: PaymentMethod,
  element: HTMLElement,
  options: InitMethodOptions
) {
  try {
    const checkoutInstance = new CheckoutInstance({
      orgId: options.orgId,
      baseUrl: options.baseUrl,
      checkoutConfig: {
        priceId: options.priceId,
        customer: {
          externalId: options.externalId,
          email: options.email,
        },
        container: '',
        clientMetadata: options.meta,
        card: options.card,
        style: options.style,
        applePay: {
          ...DEFAULT_BUTTONS_OPTIONS[PaymentMethod.APPLE_PAY],
          ...(options.applePay || {}),
        },
        paypal: {
          ...DEFAULT_BUTTONS_OPTIONS[PaymentMethod.PAYPAL],
          ...(options.paypal || {}),
        },
        googlePay: {
          ...DEFAULT_BUTTONS_OPTIONS[PaymentMethod.GOOGLE_PAY],
          ...(options.googlePay || {}),
        },
        onTaxChange: options.onTaxChange,
        onTaxError: options.onTaxError,
        onTaxPending: options.onTaxPending,
      },
    });

    return await checkoutInstance.initMethod(method, element, {
      onRenderSuccess: options.onRenderSuccess,
      onRenderError: options.onRenderError,
      onLoaderChange: options.onLoaderChange,
      onPaymentSuccess: options.onPaymentSuccess,
      onPaymentFail: options.onPaymentFail,
      onPaymentCancel: options.onPaymentCancel,
      onErrorMessageChange: options.onErrorMessageChange,
      onPaymentStarted: options.onPaymentStarted,
      onMethodsAvailable: options.onMethodsAvailable,
    });
  } catch (error) {
    getErrorImage(options.orgId, {
      baseUrl: options.baseUrl,
      message: error.message,
      code: error.code,
      req_id: error?.response?.req_id,
    });
    throw error;
  }
}

export async function getAvailablePaymentMethods(params: {
  countryCode?: string;
  orgId: string;
  baseUrl: string;
}) {
  try {
    const apiClient = new APIClient({
      baseUrl: params.baseUrl,
      orgId: params.orgId,
    });
    const response = await apiClient.createSimpleClientSession({
      countryCode: params.countryCode,
    });
    const clientToken = response?.data?.client_token;
    if (!clientToken) {
      throw new Error('Error creating simple client session');
    }

    return await new Promise<PaymentMethod[]>((resolve, reject) => {
      const primerWrapper = new PrimerWrapper();
      primerWrapper
        .initializeHeadlessCheckout(clientToken, {
          onTokenizeSuccess: () => {},
          onResumeSuccess: () => {},
          onAvailablePaymentMethodsLoad: methods => {
            resolve(methods);
            primerWrapper.destroy();
          },
          //fix of lose prefer_vault option
          paypal: DEFAULT_BUTTONS_OPTIONS[PaymentMethod.PAYPAL],
        })
        .catch(reject);
    });
  } catch (error) {
    getErrorImage(params.orgId, {
      baseUrl: params.baseUrl,
      message: error.message,
      code: error.code,
      req_id: error?.response?.req_id,
    });
    throw error;
  }
}

export async function createStripeCardForm(
  element: HTMLElement,
  params: StripeCardFormOptions
): Promise<StripeCardForm> {
  const config = resolveConfig(params, 'createStripeCardForm');
  const sessionParams = {
    orgId: config.orgId,
    baseUrl: config.baseUrl,
    region: config.region,
    priceId: params.priceId,
    externalId: params.externalId,
    email: params.email,
    clientMetadata: params.clientMetadata,
    countryCode: params.countryCode,
    integration: 'stripe' as const,
  };

  const [session, { mountStripeCardForm }] = await Promise.all([
    sessionService.createSession(sessionParams),
    import('./stripe/stripe-card-form'),
  ]);

  const apiClient = new APIClient({
    orgId: config.orgId,
    baseUrl: config.baseUrl || DEFAULTS.BASE_URL,
  });
  apiClient.processSessionResponse(session);

  return mountStripeCardForm(element, session, {
    ...params,
    apiClient,
    invalidateSession: () => sessionService.invalidate(sessionParams),
  });
}

export async function purchaseStripeWallet(
  params: StripeWalletOptions
): Promise<void> {
  const config = resolveConfig(params, 'purchaseStripeWallet');
  const sessionParams = {
    orgId: config.orgId,
    baseUrl: config.baseUrl,
    region: config.region,
    priceId: params.priceId,
    externalId: params.externalId,
    email: params.email,
    clientMetadata: params.clientMetadata,
    countryCode: params.countryCode,
    integration: 'stripe' as const,
  };

  const [session, { purchaseWallet }] = await Promise.all([
    sessionService.createSession(sessionParams),
    import('./stripe/stripe-wallet'),
  ]);

  const apiClient = new APIClient({
    orgId: config.orgId,
    baseUrl: config.baseUrl || DEFAULTS.BASE_URL,
  });
  apiClient.processSessionResponse(session);

  return purchaseWallet(session, {
    ...params,
    apiClient,
    invalidateSession: () => sessionService.invalidate(sessionParams),
  });
}

export async function getAvailableStripeWallet(
  params: CreateClientSessionOptions
): Promise<PaymentMethod.APPLE_PAY | PaymentMethod.GOOGLE_PAY | null> {
  const config = resolveConfig(params, 'getAvailableStripeWallet');

  const [session, { getAvailableWallet }] = await Promise.all([
    sessionService.createSession({
      orgId: config.orgId,
      baseUrl: config.baseUrl,
      region: config.region,
      priceId: params.priceId,
      externalId: params.externalId,
      email: params.email,
      clientMetadata: params.clientMetadata,
      countryCode: params.countryCode,
      integration: 'stripe',
    }),
    import('./stripe/stripe-wallet'),
  ]);

  const apiClient = new APIClient({
    orgId: config.orgId,
    baseUrl: config.baseUrl || DEFAULTS.BASE_URL,
  });
  apiClient.processSessionResponse(session);

  const result = await getAvailableWallet(session);
  if (result === 'APPLE_PAY') return PaymentMethod.APPLE_PAY;
  if (result === 'GOOGLE_PAY') return PaymentMethod.GOOGLE_PAY;
  return null;
}

export async function getAvailableStripePaymentMethods(
  params: CreateClientSessionOptions
): Promise<PaymentMethod[]> {
  const wallet = await getAvailableStripeWallet(params);
  return wallet
    ? [PaymentMethod.PAYMENT_CARD, wallet]
    : [PaymentMethod.PAYMENT_CARD];
}
