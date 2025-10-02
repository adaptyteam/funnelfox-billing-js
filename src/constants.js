/**
 * @fileoverview Constants for Funnefox SDK
 */

/**
 * SDK version
 */
export const SDK_VERSION = '0.1.1';

/**
 * Default configuration values
 */
export const DEFAULTS = {
  BASE_URL: 'https://billing.funnelfox.com',
  REGION: 'default',
  SANDBOX: false,
  REQUEST_TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_DELAY: 1000,
};

/**
 * Checkout states
 */
export const CHECKOUT_STATES = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  PROCESSING: 'processing',
  ACTION_REQUIRED: 'action_required',
  UPDATING: 'updating',
  COMPLETED: 'completed',
  ERROR: 'error',
  DESTROYED: 'destroyed',
};

/**
 * Event names
 */
export const EVENTS = {
  SUCCESS: 'success',
  ERROR: 'error',
  STATUS_CHANGE: 'status-change',
  DESTROY: 'destroy',
};

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  CREATE_CLIENT_SESSION: '/v1/checkout/create_client_session',
  UPDATE_CLIENT_SESSION: '/v1/checkout/update_client_session',
  CREATE_PAYMENT: '/v1/checkout/create_payment',
  RESUME_PAYMENT: '/v1/checkout/resume_payment',
};

/**
 * Error codes
 */
export const ERROR_CODES = {
  SDK_ERROR: 'SDK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  API_ERROR: 'API_ERROR',
  PRIMER_ERROR: 'PRIMER_ERROR',
  CHECKOUT_ERROR: 'CHECKOUT_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
};

/**
 * Primer default options
 */
export const PRIMER_DEFAULTS = {
  PAYMENT_HANDLING: 'MANUAL',
  API_VERSION: '2.4',
  PAYPAL_BUTTON_COLOR: 'blue',
  PAYPAL_PAYMENT_FLOW: 'PREFER_VAULT',
};
