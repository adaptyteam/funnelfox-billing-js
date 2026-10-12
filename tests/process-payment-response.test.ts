import APIClient from '../src/api-client';
import CheckoutInstance from '../src/checkout';
import { EVENTS } from '../src/constants';
import { APIError } from '../src/errors';
import type {
  CheckoutConfigWithCallbacks,
  CreatePaymentResponse,
} from '../src/types';

jest.mock('../src/primer-wrapper', () =>
  jest.fn(() => ({ disableButtons: jest.fn() }))
);

describe('processPaymentResponse', () => {
  const client = new APIClient({
    baseUrl: 'https://api.example.com',
    orgId: 'org',
  });

  const failed = (data: Partial<CreatePaymentResponse['data']>) =>
    ({
      status: 'success',
      data: { order_id: 'o1', checkout_status: 'failed', ...data },
    }) as CreatePaymentResponse;

  test('failed checkout carries decline code and source', () => {
    let error: APIError | undefined;
    try {
      client.processPaymentResponse(
        failed({
          failed_message_for_user: 'Insufficient funds.',
          decline_code: 'INSUFFICIENT_FUNDS',
          decline_code_source: 'primer',
        })
      );
    } catch (e) {
      error = e as APIError;
    }
    expect(error).toBeInstanceOf(APIError);
    expect(error?.message).toBe('Insufficient funds.');
    expect(error?.declineCode).toBe('INSUFFICIENT_FUNDS');
    expect(error?.declineCodeSource).toBe('primer');
    expect(error?.code).toBe('API_ERROR');
  });

  test('failed checkout without decline code keeps nulls', () => {
    expect(() => client.processPaymentResponse(failed({}))).toThrow(
      expect.objectContaining({ declineCode: null, declineCodeSource: null })
    );
  });
});

test('purchase failure emits a plain Error with the decline code', async () => {
  const checkout = new CheckoutInstance({
    orgId: 'org',
    checkoutConfig: {
      customer: {},
    } as unknown as CheckoutConfigWithCallbacks,
  });
  checkout.orderId = 'o1';
  checkout.apiClient.resumePayment = jest.fn().mockResolvedValue({
    status: 'success',
    data: {
      order_id: 'o1',
      checkout_status: 'failed',
      decline_code: 'INSUFFICIENT_FUNDS',
      decline_code_source: 'primer',
    },
  });
  const onFail = jest.fn();
  checkout.on(EVENTS.PURCHASE_FAILURE, onFail);

  await (
    checkout as unknown as {
      handleResumeSuccess: (d: unknown, h: unknown) => Promise<void>;
    }
  ).handleResumeSuccess({ resumeToken: 't' }, { handleFailure: jest.fn() });

  const error = onFail.mock.calls[0][0];
  expect(error).not.toBeInstanceOf(APIError);
  expect(error.name).toBe('Error');
  expect(error.message).toBe('Payment failed');
  expect(error.declineCode).toBe('INSUFFICIENT_FUNDS');
  expect(error.declineCodeSource).toBe('primer');
  expect(error).not.toHaveProperty('response');
});
