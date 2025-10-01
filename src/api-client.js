/**
 * @fileoverview API client for Funnefox backend integration
 */

import { APIError, NetworkError } from './errors.js';
import { retry, withTimeout } from './utils/helpers.js';

/**
 * HTTP client for Funnefox API requests
 */
class APIClient {
  /**
   * @param {Object} config - API client configuration
   * @param {string} config.baseUrl - Base URL for API calls
   * @param {string} config.orgId - Organization identifier
   * @param {number} [config.timeout=30000] - Request timeout in milliseconds
   * @param {number} [config.retryAttempts=3] - Number of retry attempts
   */
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.orgId = config.orgId;
    this.timeout = config.timeout || 30000;
    this.retryAttempts = config.retryAttempts || 3;
  }

  /**
   * Makes an HTTP request with error handling and retries
   * @param {string} endpoint - API endpoint
   * @param {Object} [options={}] - Request options
   * @returns {Promise<Object>} API response data
   * @throws {APIError|NetworkError} If request fails
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/${this.orgId}${endpoint}`;

    const requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      return await retry(async () => {
        return await withTimeout(
          this._makeRequest(url, requestOptions),
          this.timeout,
          'Request timed out'
        );
      }, this.retryAttempts);
    } catch (error) {
      if (error.name === 'APIError') {
        throw error;
      }
      throw new NetworkError('Network request failed', error);
    }
  }

  /**
   * Internal method to make the actual HTTP request
   * @private
   */
  async _makeRequest(url, options) {
    let response;

    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new NetworkError('Network request failed', error);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new APIError('Invalid JSON response', response.status, {});
    }

    if (!response.ok) {
      const message = data.message || data.error || `HTTP ${response.status}`;
      throw new APIError(message, response.status, { response: data });
    }

    return data;
  }

  /**
   * Creates a client session for checkout
   * @param {Object} params - Session parameters
   * @param {string} params.priceId - Price point identifier
   * @param {string} params.externalId - External user identifier
   * @param {string} params.email - Customer email
   * @param {Object} [params.clientMetadata] - Additional metadata
   * @param {string} [params.region='default'] - Checkout region
   * @param {string} [params.countryCode] - Optional ISO country code
   * @returns {Promise<Object>} Client session response
   */
  async createClientSession(params) {
    const payload = {
      region: params.region || 'default',
      integration_type: 'primer',
      pp_ident: params.priceId,
      external_id: params.externalId,
      email_address: params.email,
      client_metadata: params.clientMetadata || {},
    };

    // Add country_code if provided (nullable field per Swagger spec)
    if (params.countryCode !== undefined) {
      payload.country_code = params.countryCode;
    }

    return await this.request('/v1/checkout/create_client_session', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Updates an existing client session
   * @param {Object} params - Update parameters
   * @param {string} params.orderId - Order identifier
   * @param {string} params.clientToken - Current client token
   * @param {string} params.priceId - New price identifier
   * @returns {Promise<Object>} Update response
   */
  async updateClientSession(params) {
    const payload = {
      order_id: params.orderId,
      client_token: params.clientToken,
      pp_ident: params.priceId,
    };

    return await this.request('/v1/checkout/update_client_session', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Creates a payment with tokenized payment method
   * @param {Object} params - Payment parameters
   * @param {string} params.orderId - Order identifier
   * @param {string} params.paymentMethodToken - Payment method token from Primer
   * @returns {Promise<Object>} Payment response
   */
  async createPayment(params) {
    const payload = {
      order_id: params.orderId,
      payment_method_token: params.paymentMethodToken,
    };

    return await this.request('/v1/checkout/create_payment', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Resumes a payment with 3DS or similar flows
   * @param {Object} params - Resume parameters
   * @param {string} params.orderId - Order identifier
   * @param {string} params.resumeToken - Resume token from Primer
   * @returns {Promise<Object>} Resume response
   */
  async resumePayment(params) {
    const payload = {
      order_id: params.orderId,
      resume_token: params.resumeToken,
    };

    return await this.request('/v1/checkout/resume_payment', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * One-click payment for returning customers with saved payment methods
   * @param {Object} params - One-click payment parameters
   * @param {string} params.externalId - External user identifier
   * @param {string} params.priceId - Price point identifier
   * @param {Object} [params.clientMetadata] - Additional metadata
   * @returns {Promise<Object>} Payment response
   */
  async oneClickPayment(params) {
    const payload = {
      external_id: params.externalId,
      pp_ident: params.priceId,
      client_metadata: params.clientMetadata || {},
    };

    return await this.request('/v1/checkout/one_click', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Processes session creation response (create_client_session)
   * @param {Object} response - Raw API response
   * @returns {Object} Processed session data
   * @throws {APIError} If response indicates an error
   */
  processSessionResponse(response) {
    if (response.status === 'error') {
      // Extract error details from error array format
      const firstError = response.error?.[0];
      const message = firstError?.msg || 'Session creation failed';

      throw new APIError(message, null, {
        errorCode: firstError?.code,
        errorType: firstError?.type,
        requestId: response.req_id,
        response,
      });
    }

    const data = response.data || response;

    return {
      type: 'session_created',
      orderId: data.order_id,
      clientToken: data.client_token,
    };
  }

  /**
   * Processes payment/resume response (create_payment, resume_payment, one_click)
   * @param {Object} response - Raw API response
   * @returns {Object} Processed payment data
   * @throws {APIError} If response indicates an error
   */
  processPaymentResponse(response) {
    if (response.status === 'error') {
      // Extract error details from error array format
      const firstError = response.error?.[0];
      const message = firstError?.msg || 'Payment request failed';

      throw new APIError(message, null, {
        errorCode: firstError?.code,
        errorType: firstError?.type,
        requestId: response.req_id,
        response,
      });
    }

    const data = response.data || response;

    // Check for action required (3DS, etc.)
    if (data.action_required_token) {
      return {
        type: 'action_required',
        orderId: data.order_id,
        clientToken: data.action_required_token,
      };
    }

    // Handle checkout status
    if (data.checkout_status) {
      switch (data.checkout_status) {
        case 'succeeded':
          return {
            type: 'success',
            orderId: data.order_id,
            status: 'succeeded',
            transactionId: data.transaction_id,
          };

        case 'failed':
          throw new APIError(
            data.failed_message_for_user || 'Payment failed',
            null,
            data
          );

        case 'cancelled':
          throw new APIError('Payment was cancelled by user', null, data);

        case 'processing':
          return {
            type: 'processing',
            orderId: data.order_id,
            status: 'processing',
          };

        default:
          throw new APIError(
            `Unhandled checkout status: ${data.checkout_status}`,
            null,
            data
          );
      }
    }

    throw new APIError('Invalid payment response format', null, data);
  }

  /**
   * Processes API response and extracts relevant data
   * @deprecated Use processSessionResponse() or processPaymentResponse() instead
   * @param {Object} response - Raw API response
   * @returns {Object} Processed response data
   * @throws {APIError} If response indicates an error
   */
  processResponse(response) {
    // Try to detect response type and delegate to specialized methods
    const data = response.data || response;

    if (data.client_token && data.order_id && !data.checkout_status) {
      return this.processSessionResponse(response);
    }

    if (data.checkout_status || data.action_required_token) {
      return this.processPaymentResponse(response);
    }

    // Fallback for unknown response types
    throw new APIError('Unknown response format', null, response);
  }
}

export default APIClient;
