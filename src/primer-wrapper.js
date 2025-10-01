/**
 * @fileoverview Primer SDK integration wrapper
 *
 * @typedef {import('@primer-io/checkout-web').IPrimerHeadlessUniversalCheckout} PrimerCheckout
 * @typedef {import('@primer-io/checkout-web').ITokenizationHandler} PrimerTokenizationHandler
 * @typedef {import('@primer-io/checkout-web').IResumeHandler} PrimerResumeHandler
 * @typedef {import('@primer-io/checkout-web').PaymentMethodTokenData} PaymentMethodTokenData
 * @typedef {import('@primer-io/checkout-web').ResumeTokenData} ResumeTokenData
 * @typedef {import('@primer-io/checkout-web').UniversalCheckoutOptions} UniversalCheckoutOptions
 */

import { PrimerError } from './errors.js';
import { merge } from './utils/helpers.js';

/**
 * Wrapper class for Primer SDK integration
 */
class PrimerWrapper {
  constructor() {
    this.currentCheckout = null;
    this.isInitialized = false;
  }

  /**
   * Checks if Primer SDK is available
   * @returns {boolean} True if Primer is available
   */
  isPrimerAvailable() {
    return (
      typeof window !== 'undefined' &&
      window.Primer &&
      typeof window.Primer.showUniversalCheckout === 'function'
    );
  }

  /**
   * Ensures Primer SDK is available
   * @throws {PrimerError} If Primer SDK is not available
   */
  ensurePrimerAvailable() {
    if (!this.isPrimerAvailable()) {
      throw new PrimerError(
        'Primer SDK not found. Please include the Primer SDK script before initializing FunnefoxSDK.'
      );
    }
  }

  /**
   * Creates a universal checkout instance
   * @param {string} clientToken - Client token from your backend
   * @param {Partial<UniversalCheckoutOptions> & {onTokenizeSuccess: function, onResumeSuccess: function}} options - Checkout options
   * @returns {Promise<PrimerCheckout>} Primer checkout instance
   */
  async showUniversalCheckout(clientToken, options) {
    this.ensurePrimerAvailable();

    // Extract SDK-managed handlers
    const {
      onTokenizeSuccess,
      onResumeSuccess,
      container,
      ...userPrimerOptions
    } = options;

    // Merge defaults with user's Primer options
    /** @type {UniversalCheckoutOptions} */
    const primerOptions = merge(
      {
        clientToken,
        container,
        paymentHandling: 'MANUAL',
        apiVersion: '2.4',
        paypal: {
          buttonColor: 'blue',
          paymentFlow: 'PREFER_VAULT',
        },
      },
      userPrimerOptions
    );

    // Add the required event handlers (must override any user-provided ones)
    primerOptions.onTokenizeSuccess =
      this._wrapTokenizeHandler(onTokenizeSuccess);
    primerOptions.onResumeSuccess = this._wrapResumeHandler(onResumeSuccess);

    try {
      const checkout = await window.Primer.showUniversalCheckout(
        clientToken,
        primerOptions
      );
      this.currentCheckout = checkout;
      this.isInitialized = true;
      return checkout;
    } catch (error) {
      throw new PrimerError('Failed to initialize Primer checkout', error);
    }
  }

  /**
   * Wraps the tokenize success handler with error handling
   * @private
   * @param {function(PaymentMethodTokenData, PrimerTokenizationHandler): Promise<void>} handler
   * @returns {function(PaymentMethodTokenData, PrimerTokenizationHandler): Promise<void>}
   */
  _wrapTokenizeHandler(handler) {
    return async (paymentMethodTokenData, primerHandler) => {
      try {
        await handler(paymentMethodTokenData, primerHandler);
      } catch (error) {
        console.error('Error in tokenize handler:', error);
        primerHandler.handleFailure(
          'Payment processing failed. Please try again.'
        );
      }
    };
  }

  /**
   * Wraps the resume success handler with error handling
   * @private
   * @param {function(ResumeTokenData, PrimerResumeHandler): Promise<void>} handler
   * @returns {function(ResumeTokenData, PrimerResumeHandler): Promise<void>}
   */
  _wrapResumeHandler(handler) {
    return async (resumeTokenData, primerHandler) => {
      try {
        await handler(resumeTokenData, primerHandler);
      } catch (error) {
        console.error('Error in resume handler:', error);
        primerHandler.handleFailure(
          'Payment processing failed. Please try again.'
        );
      }
    };
  }

  /**
   * Updates the client token for an existing checkout
   * @param {string} newClientToken - New client token
   * @returns {Promise<void>}
   */
  async updateClientToken(newClientToken) {
    if (!this.currentCheckout) {
      throw new PrimerError('No active checkout to update');
    }

    try {
      // Primer SDK doesn't have a direct update method, so we need to destroy and recreate
      // This is handled at the checkout level
      throw new PrimerError('Client token updates require checkout recreation');
    } catch (error) {
      throw new PrimerError('Failed to update client token', error);
    }
  }

  /**
   * Destroys the current checkout instance
   * @returns {Promise<void>}
   */
  async destroy() {
    if (this.currentCheckout) {
      try {
        // Primer checkout cleanup - this depends on Primer SDK version
        if (typeof this.currentCheckout.destroy === 'function') {
          await this.currentCheckout.destroy();
        } else {
          // Fallback - clear the container
          const container = document.querySelector(
            this.currentCheckout.container
          );
          if (container) {
            container.innerHTML = '';
          }
        }
      } catch (error) {
        console.warn('Error destroying Primer checkout:', error);
      } finally {
        this.currentCheckout = null;
        this.isInitialized = false;
      }
    }
  }

  /**
   * Creates standardized Primer handler helpers
   * @param {Object} handlers - Handler functions
   * @param {function} handlers.onSuccess - Success callback
   * @param {function} handlers.onError - Error callback
   * @param {function} handlers.onActionRequired - Action required callback
   * @returns {Object} Primer-compatible handler functions
   */
  createHandlers(handlers) {
    return {
      /**
       * Handle successful tokenization
       */
      handleSuccess: () => {
        if (handlers.onSuccess) {
          handlers.onSuccess();
        }
      },

      /**
       * Handle payment failure
       */
      handleFailure: message => {
        if (handlers.onError) {
          handlers.onError(new Error(message));
        }
      },

      /**
       * Continue with new client token (for 3DS flows)
       */
      continueWithNewClientToken: newClientToken => {
        if (handlers.onActionRequired) {
          handlers.onActionRequired(newClientToken);
        }
      },
    };
  }

  /**
   * Gets the current checkout state
   * @returns {PrimerCheckout|null} Current checkout instance or null
   */
  getCurrentCheckout() {
    return this.currentCheckout;
  }

  /**
   * Checks if checkout is currently active
   * @returns {boolean} True if checkout is active
   */
  isActive() {
    return this.isInitialized && this.currentCheckout !== null;
  }

  /**
   * Validates that a container element exists and is suitable for Primer
   * @param {string} selector - DOM selector
   * @returns {Element} The container element
   * @throws {PrimerError} If container is invalid
   */
  validateContainer(selector) {
    const element = document.querySelector(selector);

    if (!element) {
      throw new PrimerError(`Checkout container not found: ${selector}`);
    }

    // Check if container is suitable (visible, not already in use, etc.)
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none') {
      console.warn(
        'Checkout container is hidden, this may cause display issues'
      );
    }

    return element;
  }
}

export default PrimerWrapper;
