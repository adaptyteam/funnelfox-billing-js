/**
 * @fileoverview Type definitions for Funnefox SDK
 */

/**
 * @typedef {Object} SDKConfig
 * @property {string} baseUrl - Base URL for your backend API
 * @property {string} orgId - Organization identifier
 * @property {string} [region='default'] - Checkout region
 * @property {boolean} [sandbox=false] - Enable sandbox mode
 */

/**
 * @typedef {Object} CheckoutConfig
 * @property {string} priceId - Price point identifier
 * @property {string} externalId - External user identifier
 * @property {string} email - Customer email address
 * @property {string} container - DOM selector for checkout container
 * @property {Object} [clientMetadata] - Additional checkout metadata
 * @property {PrimerCheckoutOptions} [primerOptions] - Primer-specific options
 */

/**
 * @typedef {Object} PrimerCheckoutOptions
 * @property {string} [paymentHandling='MANUAL'] - Payment handling mode
 * @property {string} [apiVersion='2.4'] - Primer API version
 * @property {Object} [paypal] - PayPal specific options
 * @property {string} [paypal.buttonColor='blue'] - PayPal button color
 * @property {string} [paypal.paymentFlow='PREFER_VAULT'] - PayPal payment flow
 */

/**
 * @typedef {Object} PaymentResult
 * @property {string} orderId - Completed order identifier
 * @property {'succeeded'|'failed'|'cancelled'|'processing'} status - Payment status
 * @property {string} [transactionId] - Transaction reference
 * @property {string} [failureReason] - Error details if failed
 * @property {Object} [metadata] - Additional result data
 */

/**
 * @typedef {Object} CheckoutInstance
 * @property {function(string): Promise<void>} updatePrice - Update checkout price
 * @property {function(): Promise<void>} destroy - Clean up checkout instance
 * @property {function(string, function): void} on - Add event listener
 * @property {function(string, function): void} off - Remove event listener
 */

/**
 * @typedef {Object} ClientSessionResponse
 * @property {'success'|'error'} status - Response status
 * @property {Object} data - Response data
 * @property {string} data.client_token - Client token for Primer
 * @property {string} data.order_id - Order identifier
 * @property {string} [data.action_required_token] - Token for 3DS flows
 * @property {'succeeded'|'failed'|'cancelled'|'processing'} [data.checkout_status] - Checkout status
 * @property {string} [data.failed_message_for_user] - User-friendly error message
 */

/**
 * @typedef {Object} PaymentMethodTokenData
 * @property {string} token - Payment method token
 * @property {Object} [metadata] - Additional token metadata
 */

/**
 * @typedef {Object} ResumeTokenData
 * @property {string} resumeToken - Resume token for 3DS flows
 * @property {Object} [metadata] - Additional resume metadata
 */

/**
 * @typedef {Object} PrimerHandler
 * @property {function(): void} handleSuccess - Handle successful payment
 * @property {function(string): void} handleFailure - Handle payment failure
 * @property {function(string): void} continueWithNewClientToken - Continue with new token
 */

/**
 * Event names for checkout instance
 * @typedef {'success'|'error'|'status-change'|'destroy'} CheckoutEventName
 */

/**
 * @typedef {function(PaymentResult): void} SuccessHandler - Success event handler
 * @typedef {function(Error): void} ErrorHandler - Error event handler
 * @typedef {function(string): void} StatusChangeHandler - Status change event handler
 * @typedef {function(): void} DestroyHandler - Destroy event handler
 */

export {};
