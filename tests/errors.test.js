/**
 * Test error classes
 */

import {
  FunnefoxSDKError,
  ValidationError,
  APIError,
  PrimerError,
  CheckoutError,
  ConfigurationError,
  NetworkError
} from '../src/errors.js';

describe('Error Classes', () => {
  describe('FunnefoxSDKError', () => {
    test('should create error with message and code', () => {
      const error = new FunnefoxSDKError('Test message', 'TEST_CODE');
      
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('FunnefoxSDKError');
      expect(error).toBeInstanceOf(Error);
    });

    test('should use default code when not provided', () => {
      const error = new FunnefoxSDKError('Test message');
      
      expect(error.code).toBe('SDK_ERROR');
    });
  });

  describe('ValidationError', () => {
    test('should create validation error with field info', () => {
      const error = new ValidationError('email', 'must be valid email');
      
      expect(error.message).toBe('Invalid email: must be valid email');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.field).toBe('email');
      expect(error.name).toBe('ValidationError');
    });

    test('should store invalid value', () => {
      const error = new ValidationError('email', 'invalid format', 'bad-email');
      
      expect(error.value).toBe('bad-email');
    });
  });

  describe('APIError', () => {
    test('should create API error with status code', () => {
      const error = new APIError('Server error', 500, {
        response: { error: 'Internal' }
      });

      expect(error.message).toBe('Server error');
      expect(error.code).toBe('API_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.response).toEqual({ error: 'Internal' });
      expect(error.name).toBe('APIError');
    });

    test('should create API error with error details', () => {
      const error = new APIError('Double purchase', null, {
        errorCode: 'double_purchase',
        errorType: 'api_exception',
        requestId: '4euAd4PZ',
        response: {
          status: 'error',
          req_id: '4euAd4PZ',
          error: [{
            msg: 'user has not finished subscription',
            code: 'double_purchase',
            type: 'api_exception'
          }]
        }
      });

      expect(error.message).toBe('Double purchase');
      expect(error.code).toBe('double_purchase');
      expect(error.errorCode).toBe('double_purchase');
      expect(error.errorType).toBe('api_exception');
      expect(error.requestId).toBe('4euAd4PZ');
      expect(error.name).toBe('APIError');
    });
  });

  describe('PrimerError', () => {
    test('should create Primer error with original error', () => {
      const originalError = new Error('Primer failed');
      const error = new PrimerError('Primer SDK error', originalError);
      
      expect(error.message).toBe('Primer SDK error');
      expect(error.code).toBe('PRIMER_ERROR');
      expect(error.primerError).toBe(originalError);
      expect(error.name).toBe('PrimerError');
    });
  });

  describe('CheckoutError', () => {
    test('should create checkout error with phase info', () => {
      const error = new CheckoutError('Payment failed', 'tokenization');
      
      expect(error.message).toBe('Payment failed');
      expect(error.code).toBe('CHECKOUT_ERROR');
      expect(error.phase).toBe('tokenization');
      expect(error.name).toBe('CheckoutError');
    });
  });

  describe('ConfigurationError', () => {
    test('should create configuration error', () => {
      const error = new ConfigurationError('Invalid configuration');
      
      expect(error.message).toBe('Invalid configuration');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.name).toBe('ConfigurationError');
    });
  });

  describe('NetworkError', () => {
    test('should create network error with original error', () => {
      const originalError = new Error('Connection failed');
      const error = new NetworkError('Network request failed', originalError);
      
      expect(error.message).toBe('Network request failed');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.originalError).toBe(originalError);
      expect(error.name).toBe('NetworkError');
    });
  });
});