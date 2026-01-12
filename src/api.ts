/**
 * @fileoverview Public API with configuration and orchestration logic
 */

import CheckoutInstance from './checkout';
import APIClient from './api-client';
import PrimerWrapper from './primer-wrapper';
import { DEFAULTS, EVENTS } from './constants';
import type {
  SDKConfig,
  CreateCheckoutOptions,
  APIConfig,
  CreateClientSessionOptions,
  InitMethodOptions,
} from './types';
import { APIError } from './errors';
import { PaymentMethod } from './enums';

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
}

export async function initMethod(
  method: PaymentMethod,
  element: HTMLElement,
  options: InitMethodOptions
) {
  // Ensure Primer SDK is loaded before initializing payment method
  const primerWrapper = new PrimerWrapper();
  await primerWrapper.ensurePrimerLoaded();

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
      applePay: options.applePay,
      paypal: options.paypal,
      googlePay: options.googlePay,
    },
  });
  checkoutInstance._ensureNotDestroyed();
  if (!checkoutInstance.isReady()) {
    await checkoutInstance['createSession']();
  }

  checkoutInstance.on(EVENTS.METHOD_RENDER, options.onRenderSuccess);
  checkoutInstance.on(EVENTS.METHOD_RENDER_ERROR, options.onRenderError);
  checkoutInstance.on(EVENTS.LOADER_CHANGE, options.onLoaderChange);
  checkoutInstance.on(EVENTS.SUCCESS, options.onPaymentSuccess);
  checkoutInstance.on(EVENTS.PURCHASE_FAILURE, options.onPaymentFail);
  checkoutInstance.on(EVENTS.PURCHASE_CANCELLED, options.onPaymentCancel);
  checkoutInstance.on(EVENTS.ERROR, options.onErrorMessageChange);
  if (method === PaymentMethod.PAYMENT_CARD) {
    const cardDefaultOptions =
      await checkoutInstance['getCardDefaultSkinCheckoutOptions'](element);
    const checkoutOptions = checkoutInstance['getCheckoutOptions']({
      ...cardDefaultOptions,
    });
    await checkoutInstance.primerWrapper.initializeHeadlessCheckout(
      checkoutInstance.clientToken as string,
      checkoutOptions
    );
    return checkoutInstance.primerWrapper.initMethod(method, element, {
      cardElements: cardDefaultOptions.cardElements,
      onSubmit: checkoutInstance['handleSubmit'],
      onInputChange: checkoutInstance['handleInputChange'],
      onMethodRender: checkoutInstance['handleMethodRender'],
      onMethodRenderError: checkoutInstance['handleMethodRenderError'],
    });
  }
  await checkoutInstance.primerWrapper.initializeHeadlessCheckout(
    checkoutInstance.clientToken as string,
    checkoutInstance['getCheckoutOptions']({})
  );
  return checkoutInstance.primerWrapper.initMethod(method, element, {
    onMethodRender: checkoutInstance['handleMethodRender'],
    onMethodRenderError: checkoutInstance['handleMethodRenderError'],
  });
}
