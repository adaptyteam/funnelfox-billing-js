/**
 * @jest-environment jsdom
 */

import { Billing } from '../src';
import { PaymentMethod } from '../src/enums';
import type { PaymentFailure } from '../src/types';

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
let session = 0;

function dispatch(type: string, detail?: unknown, cancelable = false) {
  const event = new CustomEvent(type, { detail, cancelable, bubbles: true });
  document.dispatchEvent(event);
  return event;
}

async function renderCard(callbacks: {
  onPaymentSuccess?: jest.Mock;
  onPaymentFail?: jest.Mock;
  onPaymentCancel?: jest.Mock;
}) {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const rendering = Billing.initMethod(PaymentMethod.PAYMENT_CARD, node, {
    orgId: 'org',
    baseUrl: 'https://billing.test',
    priceId: 'price-1',
    externalId: `user-${Math.random()}`,
    ...callbacks,
  });
  // The checkout element appears once the session is in; Primer then reports ready and its methods.
  while (!document.querySelector('primer-checkout')) {
    await flush();
  }
  dispatch('primer:ready', { refreshSession: jest.fn() });
  dispatch('primer:methods-update', [
    { type: 'PAYMENT_CARD' },
    { type: 'GOOGLE_PAY' },
  ]);
  const method = await rendering;
  rendered.push(method);
  return { node, method };
}

/** What Primer Checkout does after the customer submits: payment start, then the approval request. */
async function pay() {
  const continuePaymentCreation = jest.fn();
  const abortPaymentCreation = jest.fn();
  const start = dispatch(
    'primer:payment-start',
    {
      paymentMethodType: 'PAYMENT_CARD',
      continuePaymentCreation,
      abortPaymentCreation,
    },
    true
  );
  while (
    !continuePaymentCreation.mock.calls.length &&
    !abortPaymentCreation.mock.calls.length
  ) {
    await flush();
  }
  const continueFlow = jest.fn().mockResolvedValue(undefined);
  dispatch('primer:payment-approval-required', {
    paymentAttemptId: 'att-1',
    continueFlow,
  });
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
  session += 1;
  document.body.innerHTML = '';
  requests.length = 0;
  for (const key of Object.keys(replies)) {
    delete replies[key];
  }
  reply('/v1/checkout/create_client_session', {
    status: 'success',
    data: {
      client_token: `token-${session}`,
      order_id: 'order-1',
      primer_sdk: 'checkout',
    },
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
      const { status, body } = replies[endpoint];
      return { ok: status < 400, status, json: async () => body } as Response;
    }
  );
});

test('a Primer Checkout session renders the card form through a provider and pays after our approval', async () => {
  const onPaymentSuccess = jest.fn();
  const { node, method } = await renderCard({ onPaymentSuccess });

  const checkout = document.querySelector('primer-checkout') as HTMLElement;
  expect(checkout.getAttribute('client-token')).toBe(`token-${session}`);
  const provider = node.querySelector('primer-provider') as HTMLElement;
  expect(provider.getAttribute('checkout-id')).toBe(checkout.id);
  const cardForm = provider.querySelector('primer-card-form') as HTMLElement;

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
    client_token: `token-${session}`,
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
