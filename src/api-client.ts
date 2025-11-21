/**
 * @fileoverview API client for Funnefox backend integration
 */

import { API_ENDPOINTS } from './constants';
import { APIError, NetworkError } from './errors';
import { retry, withTimeout } from './utils/helpers';

interface APIClientConfig {
  baseUrl: string;
  orgId: string;
  timeout?: number;
  retryAttempts?: number;
}

class APIClient {
  baseUrl: string;
  orgId: string;
  timeout: number;
  retryAttempts: number;

  constructor(config: APIClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.orgId = config.orgId;
    this.timeout = config.timeout || 30000;
    this.retryAttempts = config.retryAttempts || 3;
  }

  async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}/${this.orgId}${endpoint}`;
    const requestOptions: RequestInit = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
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

  async _makeRequest(url: string, options: RequestInit) {
    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error: any) {
      throw new NetworkError('Network request failed', error);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new APIError('Invalid JSON response', response.status, {});
    }

    if (!response.ok) {
      const message =
        data.message || data.message || data.error || `HTTP ${response.status}`;
      throw new APIError(message?.[0]?.msg || message, response.status, {
        response: data,
      });
    }
    return data;
  }

  async createClientSession(params: {
    priceId: string;
    externalId: string;
    email: string;
    clientMetadata?: Record<string, any>;
    region?: string;
    countryCode?: string;
  }) {
    const payload: any = {
      region: params.region || 'default',
      integration_type: 'primer',
      pp_ident: params.priceId,
      external_id: params.externalId,
      email_address: params.email,
      client_metadata: params.clientMetadata || {},
    };
    if (params.countryCode !== undefined) {
      payload.country_code = params.countryCode;
    }
    return await this.request(API_ENDPOINTS.CREATE_CLIENT_SESSION, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateClientSession(params: {
    orderId: string;
    clientToken: string;
    priceId: string;
  }) {
    const payload = {
      order_id: params.orderId,
      client_token: params.clientToken,
      pp_ident: params.priceId,
    };
    return await this.request(API_ENDPOINTS.UPDATE_CLIENT_SESSION, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async createPayment(params: { orderId: string; paymentMethodToken: string }) {
    const payload = {
      order_id: params.orderId,
      payment_method_token: params.paymentMethodToken,
    };
    return await this.request(API_ENDPOINTS.CREATE_PAYMENT, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async resumePayment(params: { orderId: string; resumeToken: string }) {
    const payload = {
      order_id: params.orderId,
      resume_token: params.resumeToken,
    };
    return await this.request(API_ENDPOINTS.RESUME_PAYMENT, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  processSessionResponse(response: any) {
    if (response.status === 'error') {
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

  processPaymentResponse(response: any) {
    if (response.status === 'error') {
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

    if (data.action_required_token) {
      return {
        type: 'action_required',
        orderId: data.order_id,
        clientToken: data.action_required_token,
      };
    }

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

  processResponse(response: any) {
    const data = response.data || response;
    if (data.client_token && data.order_id && !data.checkout_status) {
      return this.processSessionResponse(response);
    }
    if (data.checkout_status || data.action_required_token) {
      return this.processPaymentResponse(response);
    }
    throw new APIError('Unknown response format', null, response);
  }
}

export default APIClient;
