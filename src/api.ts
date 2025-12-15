/**
 * @fileoverview Public API with configuration and orchestration logic
 */

import CheckoutInstance from './checkout';
import APIClient from './api-client';
import PrimerWrapper from './primer-wrapper';
import { DEFAULTS } from './constants';
import type {
  SDKConfig,
  CreateCheckoutOptions,
  APIConfig,
  CreateClientSessionOptions,
} from './types';
import { APIError } from './errors';

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

  const primerWrapper = new PrimerWrapper();
  primerWrapper.ensurePrimerAvailable();

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
