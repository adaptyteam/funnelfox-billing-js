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
  CheckoutInstance as ICheckoutInstance,
  APIConfig,
} from './types';

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
    checkoutConfig,
  });

  await checkout.initialize();
  return checkout;
}

export async function createClientSession(params: {
  priceId: string;
  externalId: string;
  email: string;
  orgId?: string;
  apiConfig?: APIConfig;
  clientMetadata?: Record<string, any>;
  countryCode?: string;
}): Promise<{ clientToken: string; orderId: string; type: string }> {
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
