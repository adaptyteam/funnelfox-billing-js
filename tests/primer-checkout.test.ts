/**
 * @jest-environment jsdom
 */

import { Billing } from '../src';
import { PaymentMethod } from '../src/enums';
import type { PaymentFailure } from '../src/types';

jest.mock('../src/skins/card/template.html', () => ({
  __esModule: true,
  default: jest
    .requireActual('fs')
    .readFileSync(
      jest
        .requireActual('path')
        .join(__dirname, '../src/skins/card/template.html'),
      'utf8'
    ),
}));

jest.mock('../src/utils/primer-checkout-loader', () => ({
  loadPrimerCheckout: jest.fn().mockResolvedValue(undefined),
}));

type Reply = { status: number; body: unknown };

const replies: Record<string, Reply> = {};
const requests: { endpoint: string; body: Record<string, unknown> }[] = [];

function reply(endpoint: string, body: unknown, status = 200) {
  replies[endpoint] = { status, body };
}

function paymentData(data: Record<string, unknown>) {
  return {
    status: 'success',
    data: {
      action_required_token: '',
      failed_message_for_user: '',
      order_id: 'order-1',
      ...data,
    },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const rendered: { destroy?: () => void }[] = [];
let tokens = 0;

function lastCheckout() {
  const all = document.querySelectorAll('primer-checkout');
  return all[all.length - 1] as HTMLElement;
}

/** Primer Checkout dispatches its lifecycle events on the `<primer-checkout>` element. */
function dispatch(
  type: string,
  detail?: unknown,
  cancelable = false,
  target: EventTarget = lastCheckout()
) {
  const event = new CustomEvent(type, { detail, cancelable, bubbles: true });
  target.dispatchEvent(event);
  return event;
}

const primerApi = { refreshSession: jest.fn(), setCardholderName: jest.fn() };

async function renderMethod(
  options: {
    onPaymentSuccess?: jest.Mock;
    onPaymentFail?: jest.Mock;
    onPaymentCancel?: jest.Mock;
    onLoaderChange?: jest.Mock;
    onRenderError?: jest.Mock;
    card?: { cardholderName?: { required: boolean } };
    externalId?: string;
  } = {},
  method: PaymentMethod = PaymentMethod.PAYMENT_CARD,
  primerMethods = [{ type: 'PAYMENT_CARD' }, { type: 'GOOGLE_PAY' }]
) {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const checkoutsBefore = document.querySelectorAll('primer-checkout').length;
  const { externalId, ...callbacks } = options;
  const rendering = Billing.initMethod(method, node, {
    orgId: 'org',
    baseUrl: 'https://billing.test',
    priceId: 'price-1',
    externalId: externalId || `user-${Math.random()}`,
    ...callbacks,
  });
  let settled = false;
  rendering.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  // A new session gets its own checkout element; Primer then reports ready and its methods on it. A cached
  // session reuses its checkout, which is ready already.
  while (
    document.querySelectorAll('primer-checkout').length === checkoutsBefore &&
    !settled
  ) {
    await flush();
  }
  if (document.querySelectorAll('primer-checkout').length > checkoutsBefore) {
    dispatch('primer:ready', primerApi);
    dispatch('primer:methods-update', primerMethods);
  }
  const methodInterface = await rendering;
  rendered.push(methodInterface);
  return { node, method: methodInterface, checkout: lastCheckout() };
}

const renderCard = (options: Parameters<typeof renderMethod>[0] = {}) =>
  renderMethod(options);

/** What Primer Checkout does after the customer submits: payment start, then the approval request. */
async function pay(
  target: EventTarget = lastCheckout(),
  paymentMethodType = 'PAYMENT_CARD'
) {
  const continuePaymentCreation = jest.fn();
  const abortPaymentCreation = jest.fn();
  const start = dispatch(
    'primer:payment-start',
    {
      paymentMethodType,
      continuePaymentCreation,
      abortPaymentCreation,
    },
    true,
    target
  );
  while (
    !continuePaymentCreation.mock.calls.length &&
    !abortPaymentCreation.mock.calls.length
  ) {
    await flush();
  }
  const continueFlow = jest.fn().mockResolvedValue(undefined);
  dispatch(
    'primer:payment-approval-required',
    { paymentAttemptId: 'att-1', continueFlow },
    false,
    target
  );
  while (!continueFlow.mock.calls.length) {
    await flush();
  }
  return { start, continuePaymentCreation, abortPaymentCreation, continueFlow };
}

async function until(check: () => boolean) {
  while (!check()) {
    await flush();
  }
}

afterEach(async () => {
  for (const method of rendered.splice(0)) {
    await method.destroy?.();
  }
});

beforeEach(() => {
  document.body.innerHTML = '';
  requests.length = 0;
  for (const key of Object.keys(replies)) {
    delete replies[key];
  }
  reply('/v1/checkout/create_client_session', {
    status: 'success',
    data: { order_id: 'order-1', primer_sdk: 'checkout' },
  });
  reply(
    '/v1/checkout/approve_payment',
    paymentData({ checkout_status: 'processing' })
  );
  reply(
    '/v1/checkout/order_status',
    paymentData({ checkout_status: 'succeeded' })
  );
  (global.fetch as jest.Mock).mockImplementation(
    async (url: string, options: RequestInit) => {
      const endpoint = new URL(url).pathname.replace(/^\/org/, '');
      requests.push({
        endpoint,
        body: JSON.parse((options.body as string) || '{}'),
      });
      const { status, body } = replies[endpoint] || { status: 200, body: {} };
      // Every new session gets its own client token, like the real backend.
      const json =
        endpoint === '/v1/checkout/create_client_session'
          ? {
              ...(body as { data: object }),
              data: {
                ...(body as { data: object }).data,
                client_token: `token-${++tokens}`,
              },
            }
          : body;
      return { ok: status < 400, status, json: async () => json } as Response;
    }
  );
});

test('a Primer Checkout session renders the card form through a provider and pays after our approval', async () => {
  const onPaymentSuccess = jest.fn();
  const { node, method } = await renderCard({ onPaymentSuccess });

  const checkout = document.querySelector('primer-checkout') as HTMLElement;
  const clientToken = checkout.getAttribute('client-token');
  expect(clientToken).toMatch(/^token-/);
  const provider = node.querySelector('primer-provider') as HTMLElement;
  expect(provider.getAttribute('checkout-id')).toBe(checkout.id);
  const cardForm = provider.querySelector('primer-card-form') as HTMLElement;
  // The SDK card skin sits in the form's slot, with Primer's secure inputs in its containers.
  expect(cardForm.hasAttribute('hide-labels')).toBe(true);
  expect(
    cardForm.querySelector('#cardNumberInput > primer-input-card-number')
  ).not.toBeNull();
  expect(
    cardForm.querySelector('#expiryInput > primer-input-card-expiry')
  ).not.toBeNull();
  expect(cardForm.querySelector('#cvvInput > primer-input-cvv')).not.toBeNull();
  expect(
    cardForm.querySelector('label[for="cardNumberInput"]')?.textContent
  ).toBe('Card number');

  const submitted = jest.fn();
  cardForm.addEventListener('primer:card-submit', submitted);
  await method.submit?.();
  expect(submitted).toHaveBeenCalledTimes(1);

  const { start, continuePaymentCreation } = await pay();
  expect(start.defaultPrevented).toBe(true);
  expect(continuePaymentCreation).toHaveBeenCalledTimes(1);
  expect(
    requests.find(r => r.endpoint === '/v1/checkout/approve_payment')?.body
  ).toEqual({
    order_id: 'order-1',
    payment_attempt_id: 'att-1',
    client_token: clientToken,
    client_metadata: {},
  });

  dispatch('primer:payment-success', {
    payment: { id: 'pay-1', orderId: 'order-1' },
  });
  await until(() => onPaymentSuccess.mock.calls.length > 0);
  // The order is synced before the host hears about the success, so the purchase already exists.
  expect(requests.map(r => r.endpoint)).toContain('/v1/checkout/order_status');
  expect(onPaymentSuccess).toHaveBeenCalledWith({
    orderId: 'order-1',
    status: 'succeeded',
  });
});

test('a declined payment reports the decline reason from our order', async () => {
  reply(
    '/v1/checkout/order_status',
    paymentData({
      checkout_status: 'failed',
      failed_message_for_user: 'Your card was declined.',
      decline_code: 'REFER_TO_CARD_ISSUER',
      decline_code_source: 'primer',
    })
  );
  const onPaymentFail = jest.fn();
  await renderCard({ onPaymentFail });

  await pay();
  dispatch('primer:payment-failure', { error: { code: 'PAYMENT_FAILED' } });
  await until(() => onPaymentFail.mock.calls.length > 0);

  const failure: PaymentFailure = onPaymentFail.mock.calls[0][0];
  expect(failure.message).toBe('Your card was declined.');
  expect(failure.declineCode).toBe('REFER_TO_CARD_ISSUER');
  expect(failure.declineCodeSource).toBe('primer');
});

test('when our backend refuses the attempt, Primer is resumed and the refusal is what the host sees', async () => {
  reply(
    '/v1/checkout/approve_payment',
    {
      status: 'error',
      error: [{ msg: 'duplicate_payment_for_the_same_order_id.' }],
    },
    400
  );
  const onPaymentFail = jest.fn();
  await renderCard({ onPaymentFail });

  const { continueFlow } = await pay();
  expect(continueFlow).toHaveBeenCalledTimes(1);
  dispatch('primer:payment-failure', { error: { code: 'PAYMENT_FAILED' } });
  await until(() => onPaymentFail.mock.calls.length > 0);

  expect(onPaymentFail.mock.calls[0][0].message).toBe(
    'duplicate_payment_for_the_same_order_id.'
  );
  expect(requests.map(r => r.endpoint)).not.toContain(
    '/v1/checkout/order_status'
  );
});

test('a closed wallet sheet is a cancel, and destroying the last method removes the checkout', async () => {
  const onPaymentCancel = jest.fn();
  const { method } = await renderCard({ onPaymentCancel });

  dispatch('primer:payment-cancel', { paymentMethodType: 'PAYMENT_CARD' });
  expect(onPaymentCancel).toHaveBeenCalledTimes(1);

  await method.destroy?.();
  rendered.splice(0);
  expect(document.querySelector('primer-checkout')).toBeNull();
  expect(document.querySelector('primer-provider')).toBeNull();
});

test('our cardholder field is validated before Primer gets the submit, and its value reaches Primer', async () => {
  const { node, method } = await renderCard({
    card: { cardholderName: { required: true } },
  });
  const cardForm = node.querySelector('primer-card-form') as HTMLElement;
  const submitted = jest.fn();
  cardForm.addEventListener('primer:card-submit', submitted);

  await method.submit?.();
  expect(submitted).not.toHaveBeenCalled();
  expect(
    node
      .querySelector('#cardHolderInput')
      ?.parentElement?.querySelector('.errorContainer')?.textContent
  ).toBe('Please enter the cardholder name');

  const cardholder = node.querySelector('#cardHolderInput') as HTMLInputElement;
  cardholder.value = 'Jane Doe';
  cardholder.dispatchEvent(new Event('input'));
  expect(primerApi.setCardholderName).toHaveBeenCalledWith('Jane Doe');

  await method.submit?.();
  expect(submitted).toHaveBeenCalledTimes(1);
});

test('a re-rendered method keeps paying after the old instance is destroyed', async () => {
  const first = await renderCard({ externalId: 'same-customer' });
  // The funnel mounts the new card form before it destroys the old one; both share the cached session.
  await renderCard({ externalId: 'same-customer' });
  expect(document.querySelectorAll('primer-checkout')).toHaveLength(1);
  await first.method.destroy?.();

  const { continuePaymentCreation, abortPaymentCreation } = await pay();
  expect(abortPaymentCreation).not.toHaveBeenCalled();
  expect(continuePaymentCreation).toHaveBeenCalledTimes(1);
  expect(requests.map(r => r.endpoint)).toContain(
    '/v1/checkout/approve_payment'
  );
});

test('a wallet sheet closed before any payment start leaves the loader alone', async () => {
  const onLoaderChange = jest.fn();
  const onPaymentCancel = jest.fn();
  await renderCard({ onLoaderChange, onPaymentCancel });

  dispatch('primer:payment-cancel', { paymentMethodType: 'PAYMENT_CARD' });
  expect(onPaymentCancel).toHaveBeenCalledTimes(1);
  expect(onLoaderChange).not.toHaveBeenCalledWith(true);

  await pay();
  expect(onLoaderChange).toHaveBeenLastCalledWith(true);
  dispatch('primer:payment-cancel', { paymentMethodType: 'PAYMENT_CARD' });
  expect(onLoaderChange).toHaveBeenLastCalledWith(false);
});

test('a wallet takes the loader only once its sheet is approved, and success is reported before the loader is released', async () => {
  const calls: string[] = [];
  const onLoaderChange = jest.fn((state: boolean) =>
    calls.push(`loader:${state}`)
  );
  const onPaymentSuccess = jest.fn(() => calls.push('success'));
  const onPaymentCancel = jest.fn(() => calls.push('cancel'));
  await renderMethod(
    { onLoaderChange, onPaymentSuccess, onPaymentCancel },
    PaymentMethod.GOOGLE_PAY
  );

  const abortPaymentCreation = jest.fn();
  dispatch(
    'primer:payment-start',
    {
      paymentMethodType: 'GOOGLE_PAY',
      continuePaymentCreation: jest.fn(),
      abortPaymentCreation,
    },
    true
  );
  await flush();
  dispatch('primer:payment-cancel', { paymentMethodType: 'GOOGLE_PAY' });
  expect(calls).toEqual(['cancel']);

  await pay(lastCheckout(), 'GOOGLE_PAY');
  expect(calls).toEqual(['cancel', 'loader:true']);
  dispatch('primer:payment-success', { paymentMethodType: 'GOOGLE_PAY' });
  await until(() => onPaymentSuccess.mock.calls.length > 0);
  expect(calls).toEqual(['cancel', 'loader:true', 'success', 'loader:false']);
});

test('a method Primer does not offer is reported as a render error, as in the legacy flow', async () => {
  const onRenderError = jest.fn();
  await expect(
    renderMethod({ onRenderError }, PaymentMethod.APPLE_PAY, [
      { type: 'PAYMENT_CARD' },
    ])
  ).rejects.toThrow();
  expect(onRenderError).toHaveBeenCalledWith(PaymentMethod.APPLE_PAY);
});

test('two checkouts on one page each handle only their own payment', async () => {
  const first = await renderCard({ externalId: 'customer-a' });
  const second = await renderCard({ externalId: 'customer-b' });
  expect(first.checkout).not.toBe(second.checkout);

  await pay(second.checkout);
  const approvals = requests.filter(
    r => r.endpoint === '/v1/checkout/approve_payment'
  );
  expect(approvals).toHaveLength(1);
  expect(approvals[0].body.client_token).toBe(
    second.checkout.getAttribute('client-token')
  );
});

test('a checkout that fails to initialize is not reused by the next attempt', async () => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const options = {
    orgId: 'org',
    baseUrl: 'https://billing.test',
    priceId: 'price-1',
    externalId: 'customer-broken',
  };
  const failing = Billing.initMethod(PaymentMethod.PAYMENT_CARD, node, options);
  while (!document.querySelector('primer-checkout')) {
    await flush();
  }
  const broken = lastCheckout();
  dispatch('primer:state-change', {
    primerJsError: { code: 'INITIALIZATION_ERROR' },
  });
  await expect(failing).rejects.toThrow();
  expect(broken.isConnected).toBe(false);

  const retry = await renderCard({ externalId: 'customer-broken' });
  expect(retry.checkout).not.toBe(broken);
});
