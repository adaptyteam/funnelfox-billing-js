/**
 * @jest-environment jsdom
 */

import {
  configure,
  createCheckout,
  createClientSession
} from '../src/index.js';

describe('Functional API', () => {
  beforeEach(() => {
    // Reset global config
    configure({
      baseUrl: 'https://api.test.com',
      orgId: 'test-org'
    });

    // Mock successful API responses
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

  describe('configure', () => {
    test('should set global configuration', () => {
      const config = {
        baseUrl: 'https://api.example.com',
        orgId: 'example-org'
      };

      expect(() => configure(config)).not.toThrow();
    });
  });

  describe('createCheckout', () => {
    test('should create checkout with global config', async () => {
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

    test('should create checkout with inline config', async () => {
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

    test('should throw error when no config available', async () => {
      // Clear global config
      configure(null);

      const checkoutConfig = {
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container'
      };

      await expect(createCheckout(checkoutConfig)).rejects.toThrow('orgId is required');
    });
  });

  describe('createClientSession', () => {
    test('should create client session with global config', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          status: 'success',
          data: {
            client_token: 'test-token-123',
            order_id: 'order-456'
          }
        })
      });

      const session = await createClientSession({
        priceId: 'price-123',
        externalId: 'user-456',
        email: 'test@example.com'
      });

      expect(session.clientToken).toBe('test-token-123');
      expect(session.orderId).toBe('order-456');
      expect(session.type).toBe('session_created');
    });

    test('should create client session with inline config', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          status: 'success',
          data: {
            client_token: 'test-token-789',
            order_id: 'order-101'
          }
        })
      });

      const session = await createClientSession({
        priceId: 'price-123',
        externalId: 'user-456',
        email: 'test@example.com',
        orgId: 'inline-org',
        apiConfig: {
          baseUrl: 'https://api.inline.com'
        }
      });

      expect(session.clientToken).toBe('test-token-789');
      expect(session.orderId).toBe('order-101');
    });
  });
});