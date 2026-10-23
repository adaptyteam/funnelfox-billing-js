/**
 * @jest-environment jsdom
 */

import { configure, createCheckout } from '../src';
import { CheckoutConfig } from '../src/types';
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
    const container = document.querySelector(
      checkoutConfig.container
    ) as HTMLElement;
    const element = () => {
      const node = document.createElement('div');
      container.appendChild(node);
      return node;
    };
    return {
      onLoaderChange: jest.fn(),
      onError: jest.fn(),
      onStatusChange: jest.fn(),
      onSuccess: jest.fn(),
      onDestroy: jest.fn(),
      onInputError: jest.fn(),
      onStartPurchase: jest.fn(),
      onPurchaseFailure: jest.fn(),
      onPurchaseCompleted: jest.fn(),
      onMethodsAvailable: jest.fn(),
      getCheckoutOptions: jest.fn().mockReturnValue({
        cardElements: {
          cardNumber: element(),
          expiryDate: element(),
          cvv: element(),
          cardholderName: element(),
          button: document.createElement('button'),
        },
        paymentButtonElements: {
          paypal: element(),
          googlePay: element(),
          applePay: element(),
        },
      }),
    };
  }),
}));

async function setUpCheckout() {
  configure({ baseUrl: 'https://api.example.com', orgId: 'test-org' });
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        status: 'success',
        data: { client_token: 'test-token', order_id: 'order-123' },
      }),
  } as Response);

  const checkout = await createCheckout({
    priceId: 'price-123',
    customer: { externalId: 'user-1', email: 'test@example.com' },
    container: '#test-container',
  });
  const purchaseStarts = jest.fn();
  checkout.on('start-purchase', purchaseStarts);

  const renderCheckout = (PrimerWrapper as unknown as jest.Mock).mock.results
    .map(result => result.value)
    .find(
      instance => (instance.renderCheckout as jest.Mock).mock.calls.length > 0
    ).renderCheckout as jest.Mock;
  const primerOptions = renderCheckout.mock.calls[0][1];

  return { checkout, purchaseStarts, primerOptions };
}

const applePayTap = { paymentMethodType: 'APPLE_PAY' };

describe('Apple Pay double tap', () => {
  beforeEach(() => {
    (PrimerWrapper as unknown as jest.Mock).mockClear();
  });

  test('a second tap while the sheet is opening does not start a second purchase', async () => {
    const { purchaseStarts, primerOptions } = await setUpCheckout();

    expect(primerOptions.onTokenizeShouldStart(applePayTap)).toBe(true);
    expect(primerOptions.onTokenizeShouldStart(applePayTap)).toBe(false);

    expect(purchaseStarts).toHaveBeenCalledTimes(1);
    expect(purchaseStarts).toHaveBeenCalledWith('APPLE_PAY');
  });

  test('closing the sheet lets the next tap start a purchase again', async () => {
    const { purchaseStarts, primerOptions } = await setUpCheckout();

    primerOptions.onTokenizeShouldStart(applePayTap);
    primerOptions.onPaymentMethodAction('PAYMENT_METHOD_UNSELECTED');

    expect(primerOptions.onTokenizeShouldStart(applePayTap)).toBe(true);
    expect(purchaseStarts).toHaveBeenCalledTimes(2);
  });

  test('a tokenization error lets the next tap start a purchase again', async () => {
    const { purchaseStarts, primerOptions } = await setUpCheckout();

    primerOptions.onTokenizeShouldStart(applePayTap);
    primerOptions.onTokenizeError(new Error('tokenization failed'));

    expect(primerOptions.onTokenizeShouldStart(applePayTap)).toBe(true);
    expect(purchaseStarts).toHaveBeenCalledTimes(2);
  });

  test('a failed payment lets the next tap start a purchase again', async () => {
    const { purchaseStarts, primerOptions } = await setUpCheckout();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));

    primerOptions.onTokenizeShouldStart(applePayTap);
    await primerOptions.onTokenizeSuccess(
      { token: 'pm-token' },
      { handleFailure: jest.fn(), handleSuccess: jest.fn() }
    );

    expect(primerOptions.onTokenizeShouldStart(applePayTap)).toBe(true);
    expect(purchaseStarts).toHaveBeenCalledTimes(2);
  });

  test('other payment methods are not held back by an Apple Pay sheet guard', async () => {
    const { purchaseStarts, primerOptions } = await setUpCheckout();
    const googlePayTap = { paymentMethodType: 'GOOGLE_PAY' };

    expect(primerOptions.onTokenizeShouldStart(googlePayTap)).toBe(true);
    expect(primerOptions.onTokenizeShouldStart(googlePayTap)).toBe(true);
    expect(purchaseStarts).toHaveBeenCalledTimes(2);
  });
});
