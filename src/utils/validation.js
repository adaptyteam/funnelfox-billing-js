/**
 * @fileoverview Input validation utilities for Funnefox SDK
 */

import { ValidationError } from '../errors.js';

/**
 * Validates SDK configuration
 * @param {Object} config - Configuration object to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function validateSDKConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('config', 'SDK configuration must be an object');
  }

  if (!config.orgId || typeof config.orgId !== 'string') {
    throw new ValidationError('orgId', 'must be a non-empty string');
  }

  // baseUrl is optional (has default), but if provided must be valid
  if (config.baseUrl) {
    if (typeof config.baseUrl !== 'string') {
      throw new ValidationError('baseUrl', 'must be a valid URL string');
    }
    if (!isValidUrl(config.baseUrl)) {
      throw new ValidationError('baseUrl', 'must be a valid URL format');
    }
  }

  if (config.region && typeof config.region !== 'string') {
    throw new ValidationError('region', 'must be a string if provided');
  }

  if (config.sandbox !== undefined && typeof config.sandbox !== 'boolean') {
    throw new ValidationError('sandbox', 'must be a boolean if provided');
  }

  return true;
}

/**
 * Validates checkout configuration
 * @param {Object} config - Checkout configuration to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function validateCheckoutConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('checkoutConfig', 'must be an object');
  }

  if (!config.priceId || typeof config.priceId !== 'string') {
    throw new ValidationError('priceId', 'must be a non-empty string');
  }

  if (!config.externalId || typeof config.externalId !== 'string') {
    throw new ValidationError('externalId', 'must be a non-empty string');
  }

  if (!config.email || typeof config.email !== 'string') {
    throw new ValidationError('email', 'must be a non-empty string');
  }

  if (!isValidEmail(config.email)) {
    throw new ValidationError('email', 'must be a valid email address');
  }

  if (!config.container || typeof config.container !== 'string') {
    throw new ValidationError(
      'container',
      'must be a valid DOM selector string'
    );
  }

  if (config.clientMetadata && typeof config.clientMetadata !== 'object') {
    throw new ValidationError(
      'clientMetadata',
      'must be an object if provided'
    );
  }

  if (config.primerOptions && typeof config.primerOptions !== 'object') {
    throw new ValidationError('primerOptions', 'must be an object if provided');
  }

  return true;
}

/**
 * Validates a URL string
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
export function isValidUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates a DOM selector
 * @param {string} selector - DOM selector to validate
 * @returns {boolean} True if valid selector format
 */
export function isValidSelector(selector) {
  if (typeof selector !== 'string' || selector.length === 0) {
    return false;
  }

  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes a string input
 * @param {*} input - Input to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeString(input) {
  if (input === null || input === undefined) {
    return '';
  }

  return String(input).trim();
}

/**
 * Validates that a value is a non-empty string
 * @param {*} value - Value to validate
 * @param {string} fieldName - Name of the field for error reporting
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function requireString(value, fieldName) {
  const sanitized = sanitizeString(value);

  if (sanitized.length === 0) {
    throw new ValidationError(fieldName, 'must be a non-empty string', value);
  }

  return true;
}

/**
 * Validates that a container element exists in the DOM
 * @param {string} selector - DOM selector
 * @returns {Element} The found element
 * @throws {ValidationError} If element not found
 */
export function validateContainer(selector) {
  requireString(selector, 'container');

  const element = document.querySelector(selector);

  if (!element) {
    throw new ValidationError(
      'container',
      `element not found: ${selector}`,
      selector
    );
  }

  return element;
}

/**
 * Deep freezes an object to prevent modification
 * @param {Object} obj - Object to freeze
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  Object.keys(obj).forEach(prop => {
    if (typeof obj[prop] === 'object' && obj[prop] !== null) {
      deepFreeze(obj[prop]);
    }
  });

  return Object.freeze(obj);
}
