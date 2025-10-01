/**
 * @fileoverview Public API with configuration and orchestration logic
 */

import CheckoutInstance from './checkout.js';
import APIClient from './api-client.js';
import PrimerWrapper from './primer-wrapper.js';
import { DEFAULTS } from './constants.js';

let defaultConfig = null;

/**
 * Configure global SDK settings
 * @param {import('./types').SDKConfig} config - SDK configuration
 */
export function configure(config) {
  defaultConfig = config;
}

/**
 * Resolve configuration with fallback chain
 * @private
 * @param {Object} options - Options with optional orgId and apiConfig
 * @param {string} functionName - Name of calling function for error messages
 * @returns {{orgId: string, baseUrl: string, region: string}} Resolved configuration
 */
function resolveConfig(options, functionName) {
  const { orgId, apiConfig } = options;

  // Fallback chain: params > configure() > error
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

/**
 * Create a checkout instance - supports both events and callbacks
 * @param {import('./types').CreateCheckoutOptions} options - Checkout options with optional SDK config
 * @returns {Promise<import('./types').CheckoutInstance>} Checkout instance
 */
export async function createCheckout(options) {
  const { ...checkoutConfig } = options;

  // Verify Primer SDK is available
  const primerWrapper = new PrimerWrapper();
  primerWrapper.ensurePrimerAvailable();

  // Resolve configuration with fallback chain
  const config = resolveConfig(options, 'createCheckout');

  const checkout = new CheckoutInstance({
    ...config,
    checkoutConfig,
  });

  await checkout.initialize();
  return checkout;
}

/**
 * Direct checkout creation with Primer (legacy compatible)
 * @param {string} clientToken - Pre-created client token
 * @param {Object} options - Primer options
 * @returns {Promise<Object>} Primer checkout instance
 */
export async function showUniversalCheckout(clientToken, options) {
  // Import dynamically to avoid circular dependencies
  const { default: PrimerWrapper } = await import('./primer-wrapper.js');
  const primerWrapper = new PrimerWrapper();
  return await primerWrapper.showUniversalCheckout(clientToken, options);
}

/**
 * Create client session for manual checkout integration
 * @param {Object} params - Session creation parameters
 * @param {string} params.priceId - Price identifier
 * @param {string} params.externalId - Customer external ID
 * @param {string} params.email - Customer email
 * @param {string} [params.orgId] - Organization ID (optional if configured)
 * @param {import('./types').APIConfig} [params.apiConfig] - Optional API config override
 * @param {Object} [params.clientMetadata] - Optional client metadata
 * @param {string} [params.countryCode] - Optional country code
 * @returns {Promise<{clientToken: string, orderId: string, type: string}>} Session data
 */
export async function createClientSession(params) {
  const { priceId, externalId, email, clientMetadata, countryCode } = params;

  // Resolve configuration with fallback chain
  const config = resolveConfig(params, 'createClientSession');

  // Create API client and session
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
