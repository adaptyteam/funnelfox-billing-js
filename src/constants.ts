/**
 * @fileoverview Constants for Funnefox SDK
 */

import type { CheckoutStyle } from '@primer-io/checkout-web';
import { PaymentMethod } from './enums';

export const SDK_VERSION = '0.4.0';

export const DEFAULTS = {
  BASE_URL: 'https://billing.funnelfox.com',
  REGION: 'default',
  SANDBOX: false,
  REQUEST_TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_DELAY: 1000,
} as const;

export const CHECKOUT_STATES = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  PROCESSING: 'processing',
  ACTION_REQUIRED: 'action_required',
  UPDATING: 'updating',
  COMPLETED: 'completed',
  ERROR: 'error',
  DESTROYED: 'destroyed',
} as const;

export const EVENTS = {
  SUCCESS: 'success',
  ERROR: 'error',
  STATUS_CHANGE: 'status-change',
  DESTROY: 'destroy',
  INPUT_ERROR: 'input-error',
  LOADER_CHANGE: 'loader-change',
  METHOD_RENDER: 'method-render',
  START_PURCHASE: 'start-purchase',
  PURCHASE_FAILURE: 'purchase-failure',
  PURCHASE_COMPLETED: 'purchase-completed',
} as const;

export const API_ENDPOINTS = {
  CREATE_CLIENT_SESSION: '/v1/checkout/create_client_session',
  UPDATE_CLIENT_SESSION: '/v1/checkout/update_client_session',
  CREATE_PAYMENT: '/v1/checkout/create_payment',
  RESUME_PAYMENT: '/v1/checkout/resume_payment',
} as const;

export const ERROR_CODES = {
  SDK_ERROR: 'SDK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  API_ERROR: 'API_ERROR',
  PRIMER_ERROR: 'PRIMER_ERROR',
  CHECKOUT_ERROR: 'CHECKOUT_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export const PRIMER_DEFAULTS = {
  PAYMENT_HANDLING: 'MANUAL',
  API_VERSION: '2.4',
  PAYPAL_BUTTON_COLOR: 'blue',
  PAYPAL_PAYMENT_FLOW: 'PREFER_VAULT',
} as const;

export const ALLOWED_BUTTON_PAYMENT_METHODS = [
  PaymentMethod.GOOGLE_PAY,
  PaymentMethod.APPLE_PAY,
  PaymentMethod.PAYPAL,
] as const;
export const ALLOWED_CARD_PAYMENT_METHODS = [
  PaymentMethod.PAYMENT_CARD,
] as const;
export const ALLOWED_PAYMENT_METHODS = [
  ...ALLOWED_BUTTON_PAYMENT_METHODS,
  ...ALLOWED_CARD_PAYMENT_METHODS,
] as const;

export const inputStyle: CheckoutStyle = {
  input: {
    error: {
      borderColor: 'rgb(227, 47, 65)',
    },
    base: {
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'rgb(0 0 0 / 10%)',
      height: '36px',
      paddingHorizontal: 10,
      borderRadius: '6px',
    },
  },
};
export const labelStyles = {
  display: 'block',
  fontSize: '16px',
  marginBottom: '5px',
};

export const errorStyles = {
  color: 'red',
  fontSize: '14px',
  marginBottom: '4px',
};

export const cardHolderInputStyles = {
  paddingLeft: inputStyle.input.base.paddingHorizontal + 'px',
  paddingRight: inputStyle.input.base.paddingHorizontal + 'px',
  boxSizing: 'border-box',
  height: '36px',
  width: '100%',
  fontSize: '1rem',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: '6px',
  borderColor: 'rgb(0 0 0 / 10%)',
  borderWidth: '1px',
  borderStyle: 'solid',
  boxShadow: 'none',
  transition: 'all 0.3s ease',
};
export const buttonStyles = {
  backgroundColor: 'black',
  color: 'white',
  width: '100%',
  padding: '12px 0',
  border: 'none',
  borderRadius: '16px',
  textAlign: 'center',
  fontSize: '18px',
  boxSizing: 'border-box',
  marginTop: '16px',
};

export const loaderStyles = {
  display: 'inline-block',
  width: '32px',
  height: '32px',
  verticalAlign: 'text-bottom',
  border: ' 4px solid #cecfd3',
  borderRightColor: 'transparent',
  borderRadius: '50%',
};
