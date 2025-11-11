/**
 * @fileoverview Input validation utilities for Funnefox SDK
 */

import { ValidationError } from '../errors';

export function validateSDKConfig(config: any) {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('config', 'SDK configuration must be an object');
  }
  if (!config.orgId || typeof config.orgId !== 'string') {
    throw new ValidationError('orgId', 'must be a non-empty string');
  }
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

export function validateCheckoutConfig(config: any) {
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

export function sanitizeString(input: any): string {
  if (input === null || input === undefined) {
    return '';
  }
  return String(input).trim();
}

export function requireString(value: any, fieldName: string) {
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
  Object.keys(obj as any).forEach(prop => {
    if (typeof (obj as any)[prop] === 'object' && (obj as any)[prop] !== null) {
      deepFreeze((obj as any)[prop]);
    }
  });
  return Object.freeze(obj);
}
