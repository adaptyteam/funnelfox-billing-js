/**
 * @fileoverview Main entry point for @funnelfox/billing
 */
import * as api from './api';

export {
  FunnefoxSDKError,
  ValidationError,
  APIError,
  PrimerError,
  CheckoutError,
  ConfigurationError,
  NetworkError,
} from './errors';

export {
  SDK_VERSION,
  DEFAULTS,
  CHECKOUT_STATES,
  EVENTS,
  ERROR_CODES,
} from './constants';

export {
  configure,
  createCheckout,
  createClientSession,
  getAvailablePaymentMethods,
} from './api';

export const Billing = {
  configure: api.configure,
  createCheckout: api.createCheckout,
  createClientSession: api.createClientSession,
  initMethod: api.initMethod,
  silentPurchase: api.silentPurchase,
  getAvailablePaymentMethods: api.getAvailablePaymentMethods,
  stripe: {
    createCardForm: api.createStripeCardForm,
    purchaseWallet: api.purchaseStripeWallet,
  },
};

export default Billing;

export { PaymentMethod } from './enums';

declare global {
  interface Window {
    Billing?: typeof Billing;
  }
}

if (typeof window !== 'undefined') {
  window.Billing = Billing;
}

console.debug('Billing SDK inited');
