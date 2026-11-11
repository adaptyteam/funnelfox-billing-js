/**
 * @jest-environment jsdom
 */

import { configure, createCheckout } from '../src';
import PrimerWrapper from '../src/primer-wrapper';

jest.mock('../src/utils/primer-checkout-loader', () => ({
  loadPrimerCheckout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/primer-loader', () => ({
  loadPrimerSDK: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/primer-wrapper', () =>
  jest.fn().mockImplementation(() => ({
    ensurePrimerAvailable: jest.fn(),
    ensurePrimerLoaded: jest.fn().mockResolvedValue(undefined),
    renderCheckout: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    disableButtons: jest.fn(),
  }))
);

const integratorMarkup = `
  <form id="my-form">
    <div id="my-card-number"></div>
    <div id="my-expiry"></div>
    <div id="my-cvv"></div>
    <button id="my-pay">Pay</button>
  </form>
  <div id="my-paypal"></div>
  <div id="my-google-pay"></div>
  <div id="my-apple-pay"></div>`;

const selectors = {
  cardSelectors: {
    cardNumber: '#my-card-number',
    expiryDate: '#my-expiry',
    cvv: '#my-cvv',
    button: '#my-pay',
  },
  paymentButtonSelectors: {
    paypal: '#my-paypal',
    googlePay: '#my-google-pay',
    applePay: '#my-apple-pay',
  },
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function respondWithSession(data: Record<string, unknown>) {
  (global.fetch as jest.Mock).mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data }),
  }));
}

beforeEach(() => {
  document.body.innerHTML = `<div id="checkout">${integratorMarkup}</div>`;
  configure({ orgId: 'org', baseUrl: 'https://billing.test' });
});

test('custom cardSelectors inside the container resolve to the integrator markup on a legacy session', async () => {
  respondWithSession({ client_token: 'token-legacy', order_id: 'order-1' });
  const cardNumber = document.querySelector('#my-card-number');
  const button = document.querySelector('#my-pay');

  const checkout = await createCheckout({
    priceId: 'price-1',
    customer: { externalId: `user-${Math.random()}`, email: 'a@b.test' },
    container: '#checkout',
    ...selectors,
  });

  const wrapper = (PrimerWrapper as unknown as jest.Mock).mock.results.at(
    -1
  )?.value;
  const options = wrapper.renderCheckout.mock.calls[0][2];
  expect(options.cardElements.cardNumber).toBe(cardNumber);
  expect(options.cardElements.button).toBe(button);
  expect(document.querySelector('#checkout #my-card-number')).toBe(cardNumber);
  expect(document.querySelector('.ff-sdk-loader-container')).toBeNull();

  await checkout.destroy();
});

test('custom cardSelectors inside the container resolve to the integrator markup on a Primer Checkout session', async () => {
  respondWithSession({
    client_token: 'token-checkout',
    order_id: 'order-2',
    primer_sdk: 'checkout',
  });
  const cardNumber = document.querySelector('#my-card-number');

  const creating = createCheckout({
    priceId: 'price-1',
    customer: { externalId: `user-${Math.random()}`, email: 'a@b.test' },
    container: '#checkout',
    ...selectors,
  });
  while (!document.querySelector('primer-checkout')) {
    await flush();
  }
  const primerCheckout = document.querySelector('primer-checkout');
  primerCheckout?.dispatchEvent(
    new CustomEvent('primer:ready', {
      detail: { refreshSession: jest.fn(), setCardholderName: jest.fn() },
      bubbles: true,
    })
  );
  primerCheckout?.dispatchEvent(
    new CustomEvent('primer:methods-update', {
      detail: [{ type: 'PAYMENT_CARD' }, { type: 'PAYPAL' }],
      bubbles: true,
    })
  );
  const checkout = await creating;

  expect(document.querySelector('#checkout #my-card-number')).toBe(cardNumber);
  expect(cardNumber?.querySelector('primer-input-card-number')).not.toBeNull();
  expect(
    document.querySelector('#my-paypal primer-payment-method[type="PAYPAL"]')
  ).not.toBeNull();
  expect(document.querySelector('primer-card-form #my-pay')).not.toBeNull();
  expect(document.querySelector('primer-card-form #my-paypal')).toBeNull();
  expect(document.querySelector('.ff-sdk-loader-container')).toBeNull();

  await checkout.destroy();
});
