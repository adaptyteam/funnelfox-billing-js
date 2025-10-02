/**
 * @fileoverview Checkout instance manager for Funnefox SDK
 */

import EventEmitter from './utils/event-emitter.js';
import PrimerWrapper from './primer-wrapper.js';
import { CheckoutError } from './errors.js';
import { validateContainer, requireString } from './utils/validation.js';
import { generateId } from './utils/helpers.js';
import APIClient from './api-client.js';
import { DEFAULTS } from './constants.js';

/**
 * Checkout instance that manages the complete checkout lifecycle
 * @typedef {import('./types').CheckoutInstance} CheckoutInstance
 * @typedef {import('./types').CheckoutConfig} CheckoutConfig
 * @typedef {import('./types').CheckoutConfigWithCallbacks} CheckoutConfigWithCallbacks
 * @typedef {import('./types').PaymentResult} PaymentResult
 * @typedef {import('./types').CheckoutState} CheckoutState
 * @typedef {import('@primer-io/checkout-web').PaymentMethodTokenData} PaymentMethodTokenData
 * @typedef {import('@primer-io/checkout-web').ResumeTokenData} ResumeTokenData
 * @typedef {import('@primer-io/checkout-web').ITokenizationHandler} PrimerHandler
 * @typedef {import('@primer-io/checkout-web').UniversalCheckoutOptions} UniversalCheckoutOptions
 */
class CheckoutInstance extends EventEmitter {
  /**
   * @param {Object} config - Checkout configuration
   * @param {string} config.orgId - Organization ID
   * @param {string} [config.baseUrl] - API base URL
   * @param {string} [config.region] - Region
   * @param {CheckoutConfig | CheckoutConfigWithCallbacks} config.checkoutConfig - Checkout configuration
   */
  constructor(config) {
    super();

    this.id = generateId('checkout_');
    this.orgId = config.orgId;
    this.baseUrl = config.baseUrl;
    this.region = config.region;
    this.checkoutConfig = { ...config.checkoutConfig };

    // Extract callbacks from config
    this.callbacks = {
      onSuccess: this.checkoutConfig.onSuccess,
      onError: this.checkoutConfig.onError,
      onStatusChange: this.checkoutConfig.onStatusChange,
      onDestroy: this.checkoutConfig.onDestroy,
    };

    // Clean callbacks from config to avoid sending to API
    delete this.checkoutConfig.onSuccess;
    delete this.checkoutConfig.onError;
    delete this.checkoutConfig.onStatusChange;
    delete this.checkoutConfig.onDestroy;

    // Internal state
    this.state = 'initializing';
    this.orderId = null;
    this.clientToken = null;
    this.primerWrapper = new PrimerWrapper();
    this.isDestroyed = false;

    // Set up callback bridges if provided
    this._setupCallbackBridges();

    // Bind methods to preserve context
    this._handleTokenizeSuccess = this._handleTokenizeSuccess.bind(this);
    this._handleResumeSuccess = this._handleResumeSuccess.bind(this);
  }

  /**
   * Set up bridges between events and callbacks
   * @private
   */
  _setupCallbackBridges() {
    if (this.callbacks.onSuccess) {
      this.on('success', this.callbacks.onSuccess);
    }

    if (this.callbacks.onError) {
      this.on('error', this.callbacks.onError);
    }

    if (this.callbacks.onStatusChange) {
      this.on('status-change', this.callbacks.onStatusChange);
    }

    if (this.callbacks.onDestroy) {
      this.on('destroy', this.callbacks.onDestroy);
    }
  }

  /**
   * Initialize the checkout instance
   * @returns {Promise<CheckoutInstance>} Returns this instance for chaining
   */
  async initialize() {
    try {
      this._setState('initializing');

      // Validate container exists
      validateContainer(this.checkoutConfig.container);

      // Create API client and session
      this.apiClient = new APIClient({
        baseUrl: this.baseUrl || DEFAULTS.BASE_URL,
        orgId: this.orgId,
        timeout: DEFAULTS.REQUEST_TIMEOUT,
        retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
      });

      const sessionResponse = await this.apiClient.createClientSession({
        priceId: this.checkoutConfig.priceId,
        externalId: this.checkoutConfig.customer.externalId,
        email: this.checkoutConfig.customer.email,
        region: this.region || DEFAULTS.REGION,
        clientMetadata: this.checkoutConfig.clientMetadata,
        countryCode: this.checkoutConfig.customer.countryCode,
      });

      const sessionData =
        this.apiClient.processSessionResponse(sessionResponse);
      this.orderId = sessionData.orderId;
      this.clientToken = sessionData.clientToken;

      // Initialize Primer checkout
      await this._initializePrimerCheckout();

      this._setState('ready');
      return this;
    } catch (error) {
      this._setState('error');
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Initialize Primer checkout with current client token
   * @private
   */
  async _initializePrimerCheckout() {
    /** @type {Partial<UniversalCheckoutOptions> & {onTokenizeSuccess: function, onResumeSuccess: function}} */
    const checkoutOptions = {
      container: this.checkoutConfig.container,
      onTokenizeSuccess: this._handleTokenizeSuccess,
      onResumeSuccess: this._handleResumeSuccess,
      ...(this.checkoutConfig.universalCheckoutOptions || {}),
    };

    await this.primerWrapper.showUniversalCheckout(
      this.clientToken,
      checkoutOptions
    );
  }

  /**
   * Handle successful payment method tokenization
   * @private
   * @param {PaymentMethodTokenData} paymentMethodTokenData - Payment method token from Primer
   * @param {PrimerHandler} primerHandler - Primer handler for success/failure
   */
  async _handleTokenizeSuccess(paymentMethodTokenData, primerHandler) {
    try {
      this._setState('processing');

      const paymentResponse = await this.apiClient.createPayment({
        orderId: this.orderId,
        paymentMethodToken: paymentMethodTokenData.token,
      });

      const result = this.apiClient.processPaymentResponse(paymentResponse);
      await this._processPaymentResult(result, primerHandler);
    } catch (error) {
      this._setState('error');
      this.emit('error', error);
      primerHandler.handleFailure(error.message || 'Payment processing failed');
    }
  }

  /**
   * Handle successful payment resume (3DS flows)
   * @private
   * @param {ResumeTokenData} resumeTokenData - Resume token from Primer
   * @param {PrimerHandler} primerHandler - Primer handler for success/failure
   */
  async _handleResumeSuccess(resumeTokenData, primerHandler) {
    try {
      this._setState('processing');

      const resumeResponse = await this.apiClient.resumePayment({
        orderId: this.orderId,
        resumeToken: resumeTokenData.resumeToken,
      });

      const result = this.apiClient.processPaymentResponse(resumeResponse);
      await this._processPaymentResult(result, primerHandler);
    } catch (error) {
      this._setState('error');
      this.emit('error', error);
      primerHandler.handleFailure(error.message || 'Payment processing failed');
    }
  }

  /**
   * Process payment result and handle different scenarios
   * @private
   */
  async _processPaymentResult(result, primerHandler) {
    // Update order ID if it changed
    if (result.orderId) {
      this.orderId = result.orderId;
    }

    switch (result.type) {
      case 'success':
        this._setState('completed');
        this.emit('success', {
          orderId: result.orderId,
          status: result.status,
          transactionId: result.transactionId,
          metadata: result.metadata,
        });
        primerHandler.handleSuccess();
        break;

      case 'action_required':
        this._setState('action_required');
        // Update client token and continue
        this.clientToken = result.clientToken;
        primerHandler.continueWithNewClientToken(result.clientToken);
        break;

      case 'processing':
        this._setState('processing');
        // Let the payment process - usually requires polling or webhook
        setTimeout(() => {
          primerHandler.handleFailure(
            'Payment is still processing. Please check back later.'
          );
        }, 30000);
        break;

      default:
        throw new CheckoutError(`Unknown payment result type: ${result.type}`);
    }
  }

  /**
   * Update the checkout to use a different price
   * @param {string} newPriceId - New price identifier
   * @returns {Promise<void>}
   */
  async updatePrice(newPriceId) {
    this._ensureNotDestroyed();
    requireString(newPriceId, 'priceId');

    if (this.state === 'processing') {
      throw new CheckoutError(
        'Cannot update price while payment is processing'
      );
    }

    try {
      this._setState('updating');

      // Update client session with new price
      await this.apiClient.updateClientSession({
        orderId: this.orderId,
        clientToken: this.clientToken,
        priceId: newPriceId,
      });

      this.checkoutConfig.priceId = newPriceId;
      this._setState('ready');

      this.emit('status-change', 'price-updated');
    } catch (error) {
      this._setState('error');
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get current checkout status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      id: this.id,
      state: this.state,
      orderId: this.orderId,
      priceId: this.checkoutConfig.priceId,
      isDestroyed: this.isDestroyed,
    };
  }

  /**
   * Destroy the checkout instance and clean up resources
   * @returns {Promise<void>}
   */
  async destroy() {
    if (this.isDestroyed) {
      return;
    }

    try {
      // Clean up Primer checkout
      await this.primerWrapper.destroy();

      // Clear state
      this._setState('destroyed');
      this.orderId = null;
      this.clientToken = null;
      this.isDestroyed = true;

      // Emit destroy event
      this.emit('destroy');

      // Remove all listeners
      this.removeAllListeners();
    } catch (error) {
      console.warn('Error during checkout cleanup:', error);
    }
  }

  /**
   * Set internal state and emit change events
   * @private
   */
  _setState(newState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.emit('status-change', newState, oldState);
    }
  }

  /**
   * Ensure checkout is not destroyed
   * @private
   */
  _ensureNotDestroyed() {
    if (this.isDestroyed) {
      throw new CheckoutError('Checkout instance has been destroyed');
    }
  }

  /**
   * Get the container element
   * @returns {Element} Container element
   */
  getContainer() {
    return document.querySelector(this.checkoutConfig.container);
  }

  /**
   * Check if checkout is in a given state
   * @param {string} state - State to check
   * @returns {boolean} True if in the specified state
   */
  isInState(state) {
    return this.state === state;
  }

  /**
   * Check if checkout is ready for user interaction
   * @returns {boolean} True if ready
   */
  isReady() {
    return this.state === 'ready' && !this.isDestroyed;
  }

  /**
   * Check if checkout is currently processing a payment
   * @returns {boolean} True if processing
   */
  isProcessing() {
    return ['processing', 'action_required'].includes(this.state);
  }
}

export default CheckoutInstance;
