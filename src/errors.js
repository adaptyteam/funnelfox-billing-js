/**
 * @fileoverview Custom error classes for Funnefox SDK
 */

/**
 * Base error class for all Funnefox SDK errors
 */
class FunnefoxSDKError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} [code='SDK_ERROR'] - Error code
   * @param {*} [details=null] - Additional error details
   */
  constructor(message, code = 'SDK_ERROR', details = null) {
    super(message);
    this.name = 'FunnefoxSDKError';
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FunnefoxSDKError);
    }
  }
}

/**
 * Error thrown when input validation fails
 */
class ValidationError extends FunnefoxSDKError {
  /**
   * @param {string} field - Field that failed validation
   * @param {string} message - Validation error message
   * @param {*} [value] - Invalid value that caused the error
   */
  constructor(field, message, value = null) {
    super(`Invalid ${field}: ${message}`, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Error thrown when API calls fail
 */
class APIError extends FunnefoxSDKError {
  /**
   * @param {string} message - API error message
   * @param {number} [statusCode] - HTTP status code
   * @param {Object} [options] - Additional error details
   * @param {string} [options.errorCode] - API error code (e.g., 'double_purchase')
   * @param {string} [options.errorType] - API error type (e.g., 'api_exception')
   * @param {string} [options.requestId] - Request ID for tracking
   * @param {*} [options.response] - Full API response data
   */
  constructor(message, statusCode = null, options = {}) {
    super(message, options.errorCode || 'API_ERROR');
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.errorCode = options.errorCode || null;
    this.errorType = options.errorType || null;
    this.requestId = options.requestId || null;
    this.response = options.response || null;
  }
}

/**
 * Error thrown when Primer SDK integration fails
 */
class PrimerError extends FunnefoxSDKError {
  /**
   * @param {string} message - Primer error message
   * @param {*} [primerError] - Original Primer error object
   */
  constructor(message, primerError = null) {
    super(message, 'PRIMER_ERROR');
    this.name = 'PrimerError';
    this.primerError = primerError;
  }
}

/**
 * Error thrown when checkout operations fail
 */
class CheckoutError extends FunnefoxSDKError {
  /**
   * @param {string} message - Checkout error message
   * @param {string} [phase] - Checkout phase where error occurred
   */
  constructor(message, phase = null) {
    super(message, 'CHECKOUT_ERROR');
    this.name = 'CheckoutError';
    this.phase = phase;
  }
}

/**
 * Error thrown when SDK configuration is invalid
 */
class ConfigurationError extends FunnefoxSDKError {
  /**
   * @param {string} message - Configuration error message
   */
  constructor(message) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown when network requests fail
 */
class NetworkError extends FunnefoxSDKError {
  /**
   * @param {string} message - Network error message
   * @param {*} [originalError] - Original network error
   */
  constructor(message, originalError = null) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
    this.originalError = originalError;
  }
}

export {
  FunnefoxSDKError,
  ValidationError,
  APIError,
  PrimerError,
  CheckoutError,
  ConfigurationError,
  NetworkError,
};
