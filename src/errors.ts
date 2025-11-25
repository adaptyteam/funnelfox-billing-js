/**
 * @fileoverview Custom error classes for Funnefox SDK
 */

import { ERROR_CODES } from '.';

class FunnefoxSDKError extends Error {
  code: string;
  details: unknown;
  constructor(
    message: string,
    code: string = ERROR_CODES.SDK_ERROR,
    details: unknown = null
  ) {
    super(message);
    this.name = 'FunnefoxSDKError';
    this.code = code;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FunnefoxSDKError);
    }
  }
}

class ValidationError extends FunnefoxSDKError {
  field: string;
  value: unknown;
  constructor(field: string, message: string, value: unknown = null) {
    super(`Invalid ${field}: ${message}`, ERROR_CODES.VALIDATION_ERROR);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

class APIError extends FunnefoxSDKError {
  statusCode: number | null;
  errorCode: string | null;
  errorType: string | null;
  requestId: string | null;
  response: unknown;
  constructor(
    message: string,
    statusCode: number | null = null,
    options: {
      errorCode?: string | null;
      errorType?: string | null;
      requestId?: string | null;
      response?: unknown;
    } = {}
  ) {
    super(message, options.errorCode || ERROR_CODES.API_ERROR);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.errorCode = options.errorCode || null;
    this.errorType = options.errorType || null;
    this.requestId = options.requestId || null;
    this.response = options.response || null;
  }
}

class PrimerError extends FunnefoxSDKError {
  primerError: unknown;
  constructor(message: string, primerError: unknown = null) {
    super(message, ERROR_CODES.PRIMER_ERROR);
    this.name = 'PrimerError';
    this.primerError = primerError;
  }
}

class CheckoutError extends FunnefoxSDKError {
  phase: string | null;
  constructor(message: string, phase: string | null = null) {
    super(message, ERROR_CODES.CHECKOUT_ERROR);
    this.name = 'CheckoutError';
    this.phase = phase;
  }
}

class ConfigurationError extends FunnefoxSDKError {
  constructor(message: string) {
    super(message, ERROR_CODES.CONFIGURATION_ERROR);
    this.name = 'ConfigurationError';
  }
}

class NetworkError extends FunnefoxSDKError {
  originalError: unknown;
  constructor(message: string, originalError: unknown = null) {
    super(message, ERROR_CODES.NETWORK_ERROR);
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
