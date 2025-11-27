/**
 * @jest-environment jsdom
 */

import { configure, createCheckout, Billing } from '../src';
import { PaymentResult, PrimerWrapperInterface } from '../src/types';

jest.mock('../src/primer-wrapper', () => {
  return jest.fn().mockImplementation(() => ({
    ensurePrimerAvailable: jest.fn(),
    renderCheckout: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    disableButtons: jest.fn(),
    validateContainer: jest.fn().mockReturnValue(document.createElement('div')),
  }));
});

jest.mock('../src/skins/default', () => ({
  __esModule: true,
  default: jest.fn(
    async (
      _primerWrapper: PrimerWrapperInterface,
      containerSelector: string
    ) => {
      const container = document.querySelector(containerSelector);
      if (!container)
        return Promise.resolve({
          renderCardForm: jest.fn(),
          renderButton: jest.fn(),
          getCardInputSelectors: jest.fn().mockReturnValue({
            cardNumber: '#cardNumberInput',
            expiryDate: '#expiryInput',
            cvv: '#cvvInput',
            cardholderName: '#cardHolderInput',
            button: '#submitButton',
          }),
          getCardInputElements: jest.fn().mockReturnValue({
            cardNumber: document.createElement('div'),
            expiryDate: document.createElement('div'),
            cvv: document.createElement('div'),
            cardholderName: document.createElement('div'),
            button: document.createElement('button'),
          }),
          onLoaderChange: jest.fn(),
          onError: jest.fn(),
          onStatusChange: jest.fn(),
          onSuccess: jest.fn(),
          onDestroy: jest.fn(),
          onInputError: jest.fn(),
          onMethodRender: jest.fn(),
          onStartPurchase: jest.fn(),
          onPurchaseFailure: jest.fn(),
          onPurchaseCompleted: jest.fn(),
        });

      container.innerHTML = `
      <div class="ff-payment-container">
        <div id="success-screen"></div>
        <div class="loader-container"></div>
        <div class="payment-errors-container"></div>
        <div class="ff-payment-method-card ff-payment-method-payment-card">
          <div class="errorContainer"></div>
        </div>
        <div class="ff-payment-method-google-pay"></div>
        <div class="ff-payment-method-apple-pay"></div>
        <div class="ff-payment-method-paypal"></div>
        <div>
          <div id="cardNumberInput"></div>
        </div>
        <div>
          <div id="expiryInput"></div>
        </div>
        <div>
          <div id="cvvInput"></div>
        </div>
        <input id="cardHolderInput" />
        <button id="submitButton"></button>
      </div>
    `;

      const cardNumber = container.querySelector(
        '#cardNumberInput'
      ) as HTMLElement;
      const expiryDate = container.querySelector('#expiryInput') as HTMLElement;
      const cvv = container.querySelector('#cvvInput') as HTMLElement;
      const cardholderName = container.querySelector(
        '#cardHolderInput'
      ) as HTMLElement;
      const button = container.querySelector(
        '#submitButton'
      ) as HTMLButtonElement;

      const skin = {
        renderCardForm: jest.fn(),
        renderButton: jest.fn(),
        getCardInputSelectors: jest.fn().mockReturnValue({
          cardNumber: '#cardNumberInput',
          expiryDate: '#expiryInput',
          cvv: '#cvvInput',
          cardholderName: '#cardHolderInput',
          button: '#submitButton',
        }),
        getCardInputElements: jest.fn().mockReturnValue({
          cardNumber,
          expiryDate,
          cvv,
          cardholderName,
          button,
        }),
        onLoaderChange: jest.fn(),
        onError: jest.fn(),
        onStatusChange: jest.fn(),
        onSuccess: jest.fn(),
        onDestroy: jest.fn(),
        onInputError: jest.fn(),
        onMethodRender: jest.fn(),
        onStartPurchase: jest.fn(),
        onPurchaseFailure: jest.fn(),
        onPurchaseCompleted: jest.fn(),
      };

      return Promise.resolve(skin);
    }
  ),
}));

describe('Callback Pattern Tests', () => {
  beforeEach(() => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'success',
          data: {
            client_token: 'test-token',
            order_id: 'order-123',
          },
        }),
    } as Response);
  });

  describe('Individual Functions with Callbacks', () => {
    test('createCheckout should call onSuccess callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onSuccess,
        onError,
      });

      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });

      expect(onSuccess).toHaveBeenCalledWith({
        orderId: 'order-123',
        status: 'succeeded',
      });
      expect(onError).not.toHaveBeenCalled();
    });

    test('createCheckout should call onError callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onSuccess,
        onError,
      });

      const error = new Error('Payment failed');
      checkout.emit('error', error);

      expect(onError).toHaveBeenCalledWith(error);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    test('createCheckout should call onStatusChange callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const onStatusChange = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onStatusChange,
      });

      // Cast to `unknown` then to the expected tuple type to satisfy typing
      checkout.emit('status-change', 'processing', 'ready');

      expect(onStatusChange).toHaveBeenCalledWith('processing', 'ready');
    });

    test('createCheckout should call onDestroy callback', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const onDestroy = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onDestroy,
      });

      checkout.emit('destroy');

      expect(onDestroy).toHaveBeenCalled();
    });
  });

  describe('Namespace Style with Callbacks', () => {
    test('Billing.createCheckout should support callbacks', async () => {
      Billing.configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      const checkout = await Billing.createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onSuccess,
        onError,
      });

      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });

      expect(onSuccess).toHaveBeenCalledWith({
        orderId: 'order-123',
        status: 'succeeded',
      });
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('Mixed Usage: Callbacks + Events', () => {
    test('should support both callbacks and additional event listeners', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const callbackHandler = jest.fn();
      const eventHandler = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onSuccess: callbackHandler,
      });

      checkout.on('success', eventHandler);

      const result = {
        orderId: 'order-123',
        status: 'succeeded',
      } as PaymentResult;
      checkout.emit('success', result);

      expect(callbackHandler).toHaveBeenCalledWith(result);
      expect(eventHandler).toHaveBeenCalledWith(result);
    });

    test('should allow removing callback-based listeners via events', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const callbackHandler = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onSuccess: callbackHandler,
      });

      checkout.off('success', callbackHandler);

      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });

      expect(callbackHandler).not.toHaveBeenCalled();
    });
  });

  describe('Callback Validation', () => {
    test('should not break if callbacks are not provided', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
      });

      expect(() => {
        checkout.emit('success', {
          orderId: 'order-123',
          status: 'succeeded',
        });
        checkout.emit('error', new Error('Test error'));
        checkout.emit('status-change', 'processing', 'ready');
        checkout.emit('destroy');
      }).not.toThrow();
    });

    test('should handle partial callback configuration', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });

      const onSuccess = jest.fn();

      const checkout = await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        onSuccess,
      });

      checkout.emit('success', { orderId: 'order-123', status: 'succeeded' });
      checkout.emit('error', new Error('Test error'));

      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
