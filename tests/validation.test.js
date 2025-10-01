/**
 * @jest-environment jsdom
 */

import {
  validateSDKConfig,
  validateCheckoutConfig,
  isValidUrl,
  isValidEmail,
  requireString
} from '../src/utils/validation.js';
import { ValidationError } from '../src/errors.js';

describe('Validation Utils', () => {
  describe('validateSDKConfig', () => {
    test('should pass with valid config', () => {
      const config = {
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      };

      expect(() => validateSDKConfig(config)).not.toThrow();
    });

    test('should allow missing baseUrl (uses default)', () => {
      const config = { orgId: 'test-org' };

      expect(() => validateSDKConfig(config)).not.toThrow();
    });

    test('should throw ValidationError for invalid URL', () => {
      const config = {
        baseUrl: 'not-a-url',
        orgId: 'test-org'
      };
      
      expect(() => validateSDKConfig(config)).toThrow(ValidationError);
    });
  });

  describe('validateCheckoutConfig', () => {
    const validConfig = {
      priceId: 'price-123',
      externalId: 'user-456',
      email: 'test@example.com',
      container: '#test-container'
    };

    test('should pass with valid config', () => {
      expect(() => validateCheckoutConfig(validConfig)).not.toThrow();
    });

    test('should throw ValidationError for invalid email', () => {
      const config = { ...validConfig, email: 'invalid-email' };
      
      expect(() => validateCheckoutConfig(config)).toThrow(ValidationError);
      expect(() => validateCheckoutConfig(config)).toThrow(/email/);
    });

    test('should throw ValidationError for missing priceId', () => {
      const { priceId, ...config } = validConfig;
      
      expect(() => validateCheckoutConfig(config)).toThrow(ValidationError);
      expect(() => validateCheckoutConfig(config)).toThrow(/priceId/);
    });
  });

  describe('isValidUrl', () => {
    test('should return true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('https://api.example.com/path')).toBe(true);
    });

    test('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl(null)).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    test('should return true for valid emails', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
    });

    test('should return false for invalid emails', () => {
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
    });
  });

  describe('requireString', () => {
    test('should pass for valid strings', () => {
      expect(() => requireString('test', 'field')).not.toThrow();
      expect(() => requireString('  test  ', 'field')).not.toThrow();
    });

    test('should throw ValidationError for empty strings', () => {
      expect(() => requireString('', 'field')).toThrow(ValidationError);
      expect(() => requireString('   ', 'field')).toThrow(ValidationError);
      expect(() => requireString(null, 'field')).toThrow(ValidationError);
    });
  });
});