/**
 * @fileoverview Main entry point for @funnelfox/billing
 *
 * Modern functional SDK for subscription payments with Primer integration
 *
 * @example
 * // Functional style (simple)
 * import { configure, createCheckout } from '@funnelfox/billing';
 *
 * configure({
 *   orgId: 'your-org-id'
 * });
 *
 * const checkout = await createCheckout({
 *   priceId: 'price_123',
 *   customer: {
 *     externalId: 'user_456',
 *     email: 'user@example.com'
 *   },
 *   container: '#checkout-container'
 * });
 *
 * @example
 * // Namespace style
 * import { Billing } from '@funnelfox/billing';
 *
 * Billing.configure({ orgId: 'your-org-id' });
 * const checkout = await Billing.createCheckout({ ... });
 *
 * // Handle events
 * checkout.on('success', (result) => {
 *   console.log('Payment completed:', result.orderId);
 * });
 */

// TypeScript types are available for TypeScript users:
// import type { SDKConfig, CheckoutInstance } from '@funnelfox/billing';

export {
  FunnefoxSDKError,
  ValidationError,
  APIError,
  PrimerError,
  CheckoutError,
  ConfigurationError,
  NetworkError,
} from './errors.js';

export {
  SDK_VERSION,
  DEFAULTS,
  CHECKOUT_STATES,
  EVENTS,
  ERROR_CODES,
} from './constants.js';

export {
  configure,
  createCheckout,
  showUniversalCheckout,
  createClientSession,
} from './api.js';

import * as api from './api.js';

export const Billing = {
  configure: api.configure,
  createCheckout: api.createCheckout,
  showUniversalCheckout: api.showUniversalCheckout,
  createClientSession: api.createClientSession,
};

export default Billing;

if (typeof window !== 'undefined') {
  window.Billing = Billing;
}
