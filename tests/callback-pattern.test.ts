/**
 * @jest-environment jsdom
 */

import { configure, createCheckout, Billing } from '../src';
import createDefaultSkin from '../src/skins/default';
import { CheckoutConfig, PaymentResult } from '../src/types';
import PrimerWrapper from '../src/primer-wrapper';

jest.mock('../src/primer-wrapper', () => {
  return jest.fn().mockImplementation(() => ({
    ensurePrimerAvailable: jest.fn(),
    ensurePrimerLoaded: jest.fn().mockResolvedValue(undefined),
    renderCheckout: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    disableButtons: jest.fn(),
    validateContainer: jest.fn().mockReturnValue(document.createElement('div')),
  }));
});

jest.mock('../src/skins/default', () => ({
  __esModule: true,
  default: jest.fn(async (checkoutConfig: CheckoutConfig) => {
    const container = document.querySelector(checkoutConfig.container);
    if (!container) {
      throw new Error(`Container not found: ${checkoutConfig.container}`);
    }

    container.innerHTML = `
      <div class="ff-payment-container">
        <div id="success-screen"></div>
        <div class="loader-container"></div>
        <div class="payment-errors-container"></div>
        <div class="ff-payment-method-card ff-payment-method-payment-card">
          <div class="errorContainer"></div>
        </div>
        <div class="ff-payment-method-google-pay">
          <div id="googlePayButton"></div>
        </div>
        <div class="ff-payment-method-apple-pay">
          <div id="applePayButton"></div>
        </div>
        <div class="ff-payment-method-paypal">
          <div id="paypalButton"></div>
        </div>
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

    const paypalButton = container.querySelector(
      '#paypalButton'
    ) as HTMLElement;
    const googlePayButton = container.querySelector(
      '#googlePayButton'
    ) as HTMLElement;
    const applePayButton = container.querySelector(
      '#applePayButton'
    ) as HTMLElement;

    const skin = {
      init: jest.fn().mockResolvedValue(undefined),
      renderCardForm: jest.fn(),
      getCardInputElements: jest.fn().mockReturnValue({
        cardNumber,
        expiryDate,
        cvv,
        cardholderName,
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
      onMethodsAvailable: jest.fn(),
      getCheckoutOptions: jest.fn().mockReturnValue({
        cardElements: {
          cardNumber,
          expiryDate,
          cvv,
          cardholderName,
          button,
        },
        paymentButtonElements: {
          paypal: paypalButton,
          googlePay: googlePayButton,
          applePay: applePayButton,
        },
        card: {
          cardholderName: {
            required: false,
          },
        },
        applePay: {
          buttonStyle: 'black',
        },
        paypal: {
          buttonColor: 'gold',
          buttonShape: 'pill',
          buttonLabel: 'pay',
          buttonSize: 'large',
          buttonHeight: 54,
        },
        googlePay: {
          buttonColor: 'black',
          buttonSizeMode: 'fill',
          buttonType: 'pay',
        },
      }),
    };

    return Promise.resolve(skin);
  }),
}));

describe('Callback Pattern Tests', () => {
  beforeEach(() => {
    (PrimerWrapper as unknown as jest.Mock).mockClear();
    (createDefaultSkin as unknown as jest.Mock).mockClear();
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
    test('createCheckout applies session card field flags when user config is absent', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            data: {
              client_token: 'test-token',
              order_id: 'order-123',
              show_email_field: true,
              show_cardholder_name_field: true,
            },
          }),
      } as Response);

      await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-apple-pay-contact-fields',
          email: 'test@example.com',
        },
        container: '#test-container',
      });

      const checkoutConfig = (createDefaultSkin as unknown as jest.Mock).mock
        .calls[0][0];
      expect(checkoutConfig.card.emailAddress.visible).toBe(true);
      expect(checkoutConfig.card.cardholderName.required).toBe(true);
    });

    test('createCheckout keeps user card field config over session flags', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            data: {
              client_token: 'test-token',
              order_id: 'order-123',
              show_email_field: true,
              show_cardholder_name_field: true,
            },
          }),
      } as Response);

      await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-apple-pay',
          email: 'test@example.com',
        },
        container: '#test-container',
        card: {
          emailAddress: {
            visible: false,
          },
          cardholderName: {
            required: false,
          },
        },
      });

      const checkoutConfig = (createDefaultSkin as unknown as jest.Mock).mock
        .calls[0][0];
      expect(checkoutConfig.card.emailAddress.visible).toBe(false);
      expect(checkoutConfig.card.cardholderName.required).toBe(false);
    });

    test('createCheckout stores detected country, defaults, and per-country overrides', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            data: {
              client_token: 'test-token',
              order_id: 'order-123',
              show_cardholder_name_field: false,
              show_country_selector_field: true,
              show_postal_code_field: false,
              detected_country_code: 'us',
              valid_countries: [
                { code: 'DE', name: 'Germany' },
                { code: 'US', name: 'United States of America' },
              ],
              country_field_overrides: {
                US: { show_cardholder_name: true, show_postal_code: true },
              },
            },
          }),
      } as Response);

      await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-country-config',
          email: 'test@example.com',
        },
        container: '#test-container',
      });

      const checkoutConfig = (createDefaultSkin as unknown as jest.Mock).mock
        .calls[0][0];
      const cardSessionFieldConfig = (createDefaultSkin as unknown as jest.Mock)
        .mock.calls[0][1];

      expect(checkoutConfig.card.cardholderName.required).toBe(false);
      expect(cardSessionFieldConfig).toEqual({
        showCountrySelector: true,
        showPostalCode: false,
        detectedCountryCode: 'US',
        validCountries: [
          { code: 'DE', name: 'Germany' },
          { code: 'US', name: 'United States of America' },
        ],
        countryFieldOverrides: {
          US: { show_cardholder_name: true, show_postal_code: true },
        },
      });
    });

    test('createCheckout forwards selected country and only sends postal code when visible', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'success',
              data: {
                client_token: 'test-token',
                order_id: 'order-123',
                show_cardholder_name_field: false,
                show_country_selector_field: true,
                show_postal_code_field: false,
                detected_country_code: 'US',
                valid_countries: [
                  { code: 'DE', name: 'Germany' },
                  { code: 'US', name: 'United States of America' },
                ],
                country_field_overrides: {
                  US: { show_cardholder_name: true, show_postal_code: true },
                  DE: { show_cardholder_name: false, show_postal_code: false },
                },
              },
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'success',
              data: {
                order_id: 'order-123',
                checkout_status: 'succeeded',
              },
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'success',
              data: {
                order_id: 'order-123',
                checkout_status: 'succeeded',
              },
            }),
        } as Response);

      await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-country-payment',
          email: 'test@example.com',
        },
        container: '#test-container',
      });

      const primerWrapperInstances = (PrimerWrapper as unknown as jest.Mock).mock
        .results.map(result => result.value)
        .filter(instance => instance?.renderCheckout);
      const renderCheckout = primerWrapperInstances.find(
        instance => (instance.renderCheckout as jest.Mock).mock.calls.length > 0
      )?.renderCheckout as jest.Mock;

      const checkoutOptions = renderCheckout.mock.calls[0][1];
      const renderOptions = renderCheckout.mock.calls[0][2];
      const primerHandler = {
        handleSuccess: jest.fn(),
        handleFailure: jest.fn(),
        continueWithNewClientToken: jest.fn(),
      };

      expect(renderOptions.isCardholderNameRequired()).toBe(false);
      renderOptions.onCardInputValueChange('postalCode', '10001');
      await checkoutOptions.onTokenizeSuccess({ token: 'pm-token-us' }, primerHandler);

      let requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
      expect(requestBody).toMatchObject({
        order_id: 'order-123',
        payment_method_token: 'pm-token-us',
        country_code: 'US',
        postal_code: '10001',
      });
      expect(requestBody).not.toHaveProperty('email_address');

      renderOptions.onCardInputValueChange('countryCode', 'DE');
      expect(renderOptions.isCardholderNameRequired()).toBe(false);
      await checkoutOptions.onTokenizeSuccess({ token: 'pm-token-de' }, primerHandler);

      requestBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
      expect(requestBody).toMatchObject({
        order_id: 'order-123',
        payment_method_token: 'pm-token-de',
        country_code: 'DE',
      });
      expect(requestBody).not.toHaveProperty('email_address');
      expect(requestBody).not.toHaveProperty('postal_code');
    });

    test('createCheckout preserves Apple Pay contact fields when email collection is enabled', async () => {
      configure({
        baseUrl: 'https://api.example.com',
        orgId: 'test-org',
      });
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            data: {
              client_token: 'test-token',
              order_id: 'order-123',
              collect_apple_pay_email: true,
            },
          }),
      } as Response);

      await createCheckout({
        priceId: 'price-123',
        customer: {
          externalId: 'user-456',
          email: 'test@example.com',
        },
        container: '#test-container',
        applePay: {
          billingOptions: {
            requiredBillingContactFields: ['name', 'postalAddress'],
          },
          shippingOptions: {
            requiredShippingContactFields: ['name'],
          },
        },
      });

      const primerWrapperInstances = (PrimerWrapper as unknown as jest.Mock).mock
        .results.map(result => result.value)
        .filter(instance => instance?.renderCheckout);
      const renderCheckout = primerWrapperInstances.find(
        instance => (instance.renderCheckout as jest.Mock).mock.calls.length > 0
      )?.renderCheckout as jest.Mock;
      const checkoutOptions = renderCheckout.mock.calls[0][1];

      expect(
        checkoutOptions.applePay.billingOptions.requiredBillingContactFields
      ).toEqual(['name', 'postalAddress', 'emailAddress']);
      expect(
        checkoutOptions.applePay.shippingOptions.requiredShippingContactFields
      ).toEqual(['name', 'emailAddress']);
    });

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
