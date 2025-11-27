/**
 * @fileoverview Input validation utilities for Funnefox SDK
 */

import { ValidationError } from '../errors';

export function validateSDKConfig(config: unknown) {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('config', 'SDK configuration must be an object');
  }
  if (!('orgId' in config) || typeof config.orgId !== 'string') {
    throw new ValidationError('orgId', 'must be a non-empty string');
  }
  if ('baseUrl' in config) {
    if (typeof config.baseUrl !== 'string') {
      throw new ValidationError('baseUrl', 'must be a valid URL string');
    }
    if (!isValidUrl(config.baseUrl)) {
      throw new ValidationError('baseUrl', 'must be a valid URL format');
    }
  }
  if ('region' in config && typeof config.region !== 'string') {
    throw new ValidationError('region', 'must be a string if provided');
  }
  if ('sandbox' in config && typeof config.sandbox !== 'boolean') {
    throw new ValidationError('sandbox', 'must be a boolean if provided');
  }
  return true;
}

export function validateCheckoutConfig(config: unknown) {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('checkoutConfig', 'must be an object');
  }
  if (!('priceId' in config) || typeof config.priceId !== 'string') {
    throw new ValidationError('priceId', 'must be a non-empty string');
  }
  if (!('externalId' in config) || typeof config.externalId !== 'string') {
    throw new ValidationError('externalId', 'must be a non-empty string');
  }
  if (!('email' in config) || typeof config.email !== 'string') {
    throw new ValidationError('email', 'must be a non-empty string');
  }
  if (!isValidEmail(config.email)) {
    throw new ValidationError('email', 'must be a valid email address');
  }
  if (!('container' in config) || typeof config.container !== 'string') {
    throw new ValidationError(
      'container',
      'must be a valid DOM selector string'
    );
  }
  if ('clientMetadata' in config && typeof config.clientMetadata !== 'object') {
    throw new ValidationError(
      'clientMetadata',
      'must be an object if provided'
    );
  }
  if ('primerOptions' in config && typeof config.primerOptions !== 'object') {
    throw new ValidationError('primerOptions', 'must be an object if provided');
  }
  return true;
}

export function isValidUrl(url: string) {
  if (typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidEmail(email: string) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidSelector(selector: string) {
  if (typeof selector !== 'string' || selector.length === 0) return false;
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeString(input?: string | null): string {
  return input?.trim() || '';
}

export function requireString(value: string, fieldName: string) {
  const sanitized = sanitizeString(value);
  if (sanitized.length === 0) {
    throw new ValidationError(fieldName, 'must be a non-empty string', value);
  }
  return true;
}

export function validateContainer(selector: string) {
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

export function deepFreeze<T>(obj: T): T {
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
