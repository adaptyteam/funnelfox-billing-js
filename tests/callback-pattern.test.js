/**
 * @jest-environment jsdom
 */

import {
  configure,
  createCheckout,
  Billing
} from '../src/index.js';

describe('Callback Pattern Tests', () => {
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

  describe('Individual Functions with Callbacks', () => {
    test('createCheckout should call onSuccess callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onSuccess,
        onError
      });

      // Simulate success
      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });

      expect(onSuccess).toHaveBeenCalledWith({ orderId: 'order-123', status: 'succeeded' });
      expect(onError).not.toHaveBeenCalled();
    });

    test('createCheckout should call onError callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onSuccess,
        onError
      });

      // Simulate error
      const error = new Error('Payment failed');
      checkout.emit('error', error);

      expect(onError).toHaveBeenCalledWith(error);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    test('createCheckout should call onStatusChange callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const onStatusChange = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onStatusChange
      });

      // Simulate status change
      checkout.emit('status-change', 'processing', 'ready');

      expect(onStatusChange).toHaveBeenCalledWith('processing', 'ready');
    });

    test('createCheckout should call onDestroy callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const onDestroy = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onDestroy
      });

      // Simulate destroy
      checkout.emit('destroy');

      expect(onDestroy).toHaveBeenCalled();
    });
  });

  describe('Namespace Style with Callbacks', () => {
    test('Billing.createCheckout should support callbacks', async () => {
      Billing.configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      const checkout = await Billing.createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onSuccess,
        onError
      });

      // Simulate success
      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });

      expect(onSuccess).toHaveBeenCalledWith({ orderId: 'order-123', status: 'succeeded' });
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('Mixed Usage: Callbacks + Events', () => {
    test('should support both callbacks and additional event listeners', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const callbackHandler = jest.fn();
      const eventHandler = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onSuccess: callbackHandler
      });

      // Add additional event listener
      checkout.on('success', eventHandler);

      // Simulate success
      const result = { orderId: 'order-123', status: 'succeeded' };
      checkout.emit('success', result);

      // Both callback and event listener should be called
      expect(callbackHandler).toHaveBeenCalledWith(result);
      expect(eventHandler).toHaveBeenCalledWith(result);
    });

    test('should allow removing callback-based listeners via events', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const callbackHandler = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onSuccess: callbackHandler
      });

      // Remove the callback listener
      checkout.off('success', callbackHandler);

      // Simulate success
      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });

      // Callback should not be called
      expect(callbackHandler).not.toHaveBeenCalled();
    });
  });

  describe('Callback Validation', () => {
    test('should not break if callbacks are not provided', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      // No callbacks provided - should not throw
      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container'
      });

      // Simulate events - should not throw
      expect(() => {
        checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });
        checkout.emit('error', new Error('Test error'));
        checkout.emit('status-change', 'processing');
        checkout.emit('destroy');
      }).not.toThrow();
    });

    test('should handle partial callback configuration', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org'
      });

      const onSuccess = jest.fn();
      // Only onSuccess provided, no onError

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com'
        },
        container: '#test-container',
        onSuccess
      });

      // Should work fine with missing callbacks
      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });
      checkout.emit('error', new Error('Test error')); // No callback, but shouldn't break

      expect(onSuccess).toHaveBeenCalled();
    });
  });
});