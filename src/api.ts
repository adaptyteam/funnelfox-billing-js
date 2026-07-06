/**
 * @fileoverview Public API with configuration and orchestration logic
 */

import CheckoutInstance from './checkout';
import APIClient from './api-client';
import PrimerWrapper from './primer-wrapper';
import { DEFAULT_BUTTONS_OPTIONS, DEFAULTS } from './constants';
import type {
  SDKConfig,
  CreateCheckoutOptions,
  APIConfig,
  CreateClientSessionOptions,
  InitMethodOptions,
  StripeCardFormOptions,
  StripeCardForm,
  StripeWalletOptions,
  AdyenCardFormOptions,
  AdyenWalletOptions,
} from './types';
import { APIError } from './errors';
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

    // Ensure Primer SDK is loaded before creating checkout
    const primerWrapper = new PrimerWrapper();
    await primerWrapper.ensurePrimerLoaded();

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

export async function silentPurchase(options: {
  priceId: string;
  externalId: string;
  clientMetadata: Record<string, string | number | boolean>;
  orgId: string;
  baseUrl: string;
}) {
  const { priceId, externalId, clientMetadata, orgId, baseUrl } = options;
  const apiClient = new APIClient({
    baseUrl: baseUrl,
    orgId: orgId,
    timeout: DEFAULTS.REQUEST_TIMEOUT,
    retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
  });

  try {
    const response = await apiClient.oneClick({
      pp_ident: priceId,
      external_id: externalId,
      client_metadata: clientMetadata,
    });
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

export async function createAdyenCardForm(
  element: HTMLElement,
  params: AdyenCardFormOptions
): Promise<void> {
  const config = resolveConfig(params, 'createAdyenCardForm');

  const [session, { mountAdyenCardForm }] = await Promise.all([
    sessionService.createSession({
      orgId: config.orgId,
      baseUrl: config.baseUrl,
      region: config.region,
      priceId: params.priceId,
      externalId: params.externalId,
      email: params.email,
      clientMetadata: params.clientMetadata,
      countryCode: params.countryCode,
      integration: 'adyen',
    }),
    import('./adyen/adyen-card-form'),
  ]);

  const apiClient = new APIClient({
    orgId: config.orgId,
    baseUrl: config.baseUrl || DEFAULTS.BASE_URL,
  });

  return mountAdyenCardForm(element, session, { ...params, apiClient });
}

export async function purchaseAdyenWallet(
  params: AdyenWalletOptions
): Promise<void> {
  const config = resolveConfig(params, 'purchaseAdyenWallet');

  const [session, { purchaseWallet }] = await Promise.all([
    sessionService.createSession({
      orgId: config.orgId,
      baseUrl: config.baseUrl,
      region: config.region,
      priceId: params.priceId,
      externalId: params.externalId,
      email: params.email,
      clientMetadata: params.clientMetadata,
      countryCode: params.countryCode,
      integration: 'adyen',
    }),
    import('./adyen/adyen-wallet'),
  ]);

  const apiClient = new APIClient({
    orgId: config.orgId,
    baseUrl: config.baseUrl || DEFAULTS.BASE_URL,
  });

  return purchaseWallet(session, { ...params, apiClient });
}

export async function getAvailableAdyenWallet(
  params: CreateClientSessionOptions
): Promise<PaymentMethod.APPLE_PAY | PaymentMethod.GOOGLE_PAY | null> {
  const config = resolveConfig(params, 'getAvailableAdyenWallet');

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
      integration: 'adyen',
    }),
    import('./adyen/adyen-wallet'),
  ]);

  const result = await getAvailableWallet(session);
  if (result === 'APPLE_PAY') return PaymentMethod.APPLE_PAY;
  if (result === 'GOOGLE_PAY') return PaymentMethod.GOOGLE_PAY;
  return null;
}

export async function getAvailableAdyenPaymentMethods(
  params: CreateClientSessionOptions
): Promise<PaymentMethod[]> {
  const wallet = await getAvailableAdyenWallet(params);
  return wallet
    ? [PaymentMethod.PAYMENT_CARD, wallet]
    : [PaymentMethod.PAYMENT_CARD];
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
