/**
 * @jest-environment jsdom
 */

import { configure, createCheckout } from '../src';
import { loadPrimerSDK } from '../src/utils/primer-loader';
import type { CheckoutConfig } from '../src/types';

jest.mock('../src/utils/primer-checkout-loader', () => ({
  loadPrimerCheckout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/primer-loader', () => ({
  loadPrimerSDK: jest.fn().mockResolvedValue(undefined),
}));

// The default skin's layout: wallet containers and the card form container side by side.
jest.mock('../src/skins/default', () => ({
  __esModule: true,
  default: jest.fn(async (checkoutConfig: CheckoutConfig) => {
    const container = document.querySelector(
      checkoutConfig.container
    ) as HTMLElement;
    container.innerHTML = `
      <div id="wallets"><div id="googlePayButton"></div><div id="paypalButton"></div><div id="applePayButton"></div></div>
      <div class="ff-card-form-container" id="cardForm">
        <label for="cardNumberInput">Card number</label><div id="cardNumberInput"></div>
        <div id="expiryInput"></div><div id="cvvInput"></div>
        <input id="cardHolderInput" />
        <button id="submitButton">Pay</button>
      </div>`;
    const find = (selector: string) =>
      container.querySelector(selector) as HTMLElement;
    const noop = () => undefined;
    return {
      init: async () => undefined,
      renderCardForm: noop,
      getCardInputElements: noop,
      onLoaderChange: noop,
      onError: noop,
      onStatusChange: noop,
      onSuccess: noop,
      onDestroy: noop,
      onInputError: noop,
      onMethodRender: noop,
      onStartPurchase: noop,
      onPurchaseFailure: noop,
      onPurchaseCompleted: noop,
      onMethodsAvailable: noop,
      getCheckoutOptions: () => ({
        cardElements: {
          cardNumber: find('#cardNumberInput'),
          expiryDate: find('#expiryInput'),
          cvv: find('#cvvInput'),
          cardholderName: find('#cardHolderInput'),
          button: find('#submitButton'),
        },
        paymentButtonElements: {
          paypal: find('#paypalButton'),
          googlePay: find('#googlePayButton'),
          applePay: find('#applePayButton'),
        },
      }),
    };
  }),
}));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** Primer Checkout dispatches its lifecycle events on the `<primer-checkout>` element. */
function dispatch(type: string, detail?: unknown) {
  document
    .querySelector('primer-checkout')
    ?.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="checkout"></div>';
  (global.fetch as jest.Mock).mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      data: {
        client_token: 'token-cc',
        order_id: 'order-cc',
        primer_sdk: 'checkout',
      },
    }),
  }));
});

test('createCheckout on a Primer Checkout session never loads the legacy SDK and keeps wallets outside the card form', async () => {
  configure({ orgId: 'org', baseUrl: 'https://billing.test' });
  const creating = createCheckout({
    priceId: 'price-1',
    customer: {
      externalId: `user-${Math.random()}`,
      email: 'buyer@example.com',
    },
    container: '#checkout',
  });
  while (!document.querySelector('primer-checkout')) {
    await flush();
  }
  dispatch('primer:ready', {
    refreshSession: jest.fn(),
    setCardholderName: jest.fn(),
  });
  dispatch('primer:methods-update', [
    { type: 'PAYMENT_CARD' },
    { type: 'GOOGLE_PAY' },
    { type: 'PAYPAL' },
  ]);
  const checkout = await creating;

  expect(loadPrimerSDK).not.toHaveBeenCalled();
  const cardForm = document.querySelector(
    '#cardForm primer-card-form'
  ) as HTMLElement;
  expect(
    cardForm.querySelector('#cardNumberInput > primer-input-card-number')
  ).not.toBeNull();
  expect(cardForm.querySelector('#submitButton')?.getAttribute('type')).toBe(
    'button'
  );
  expect(cardForm.querySelector('#wallets')).toBeNull();
  expect(
    document.querySelector(
      '#googlePayButton primer-payment-method[type="GOOGLE_PAY"]'
    )
  ).not.toBeNull();
  expect(
    document.querySelector('#paypalButton primer-payment-method[type="PAYPAL"]')
  ).not.toBeNull();

  await checkout.destroy();
});
