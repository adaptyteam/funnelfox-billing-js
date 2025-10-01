/**
 * @jest-environment jsdom
 */

import {
  configure,
  createCheckout,
  Billing
} from '../src/index.js';
import { ValidationError } from '../src/errors.js';

describe('Billing API', () => {
  beforeEach(() => {
    // Mock successful API response
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 'success',
        data: {
          client_token: 'test-token',
          order_id: 'order-123'
        }
      })
    });
  });

  describe('Individual Functions', () => {
    test('configure should set global configuration', () => {
      const config = {
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      };

      expect(() => configure(config)).not.toThrow();
    });

    test('createCheckout should create checkout with global config', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const checkoutConfig = {
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container'
      };

      const checkout = await createCheckout(checkoutConfig);
      
      expect(checkout).toBeDefined();
      expect(checkout.id).toBeDefined();
    });

    test('createCheckout should work with inline config', async () => {
      const options = {
        orgId: 'inline-org',
        apiConfig: {
          baseUrl: 'https://api.inline.com'
        },
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container'
      };

      const checkout = await createCheckout(options);
      
      expect(checkout).toBeDefined();
      expect(checkout.id).toBeDefined();
    });
  });

  describe('Namespace Style', () => {
    test('Billing.configure should set global configuration', () => {
      const config = {
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      };

      expect(() => Billing.configure(config)).not.toThrow();
    });

    test('Billing.createCheckout should create checkout', async () => {
      Billing.configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const checkoutConfig = {
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container'
      };

      const checkout = await Billing.createCheckout(checkoutConfig);
      
      expect(checkout).toBeDefined();
      expect(checkout.id).toBeDefined();
    });
  });

});