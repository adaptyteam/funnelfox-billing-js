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

describe('purchase failure', () => {
  const buildCheckout = (
    apiMethod: 'createPayment' | 'resumePayment',
    response: Record<string, unknown>
  ): CheckoutInstance => {
    const checkout = new CheckoutInstance({
      orgId: 'org',
      checkoutConfig: {
        customer: {},
      } as unknown as CheckoutConfigWithCallbacks,
    });
    checkout.orderId = 'o1';
    checkout.apiClient[apiMethod] = jest.fn().mockResolvedValue({
      status: 'success',
      data: response,
    });
    return checkout;
  };

  const invokeHandler = async (
    checkout: CheckoutInstance,
    handler: 'handleTokenizeSuccess' | 'handleResumeSuccess',
    handlerData: unknown
  ) =>
    (
      checkout as unknown as {
        handleTokenizeSuccess: (
          d: unknown,
          h: unknown
        ) => Promise<void>;
        handleResumeSuccess: (d: unknown, h: unknown) => Promise<void>;
      }
    )[handler](handlerData, { handleFailure: jest.fn() });

  test('emits a plain Error with the decline code and source on resume', async () => {
    const checkout = buildCheckout('resumePayment', {
      order_id: 'o1',
      checkout_status: 'failed',
      decline_code: 'INSUFFICIENT_FUNDS',
      decline_code_source: 'primer',
    });
    const onFail = jest.fn();
    checkout.on(EVENTS.PURCHASE_FAILURE, onFail);

    await invokeHandler(checkout, 'handleResumeSuccess', { resumeToken: 't' });

    const error = onFail.mock.calls[0][0];
    expect(error).not.toBeInstanceOf(APIError);
    expect(error.name).toBe('Error');
    expect(error.message).toBe('Payment failed');
    expect(error.declineCode).toBe('INSUFFICIENT_FUNDS');
    expect(error.declineCodeSource).toBe('primer');
    expect(error).not.toHaveProperty('response');
  });

  test('emits a plain Error with the decline code and source on tokenize', async () => {
    const checkout = buildCheckout('createPayment', {
      order_id: 'o1',
      checkout_status: 'failed',
      failed_message_for_user: 'Insufficient funds.',
      decline_code: 'INSUFFICIENT_FUNDS',
      decline_code_source: 'stripe',
    });
    const onFail = jest.fn();
    checkout.on(EVENTS.PURCHASE_FAILURE, onFail);

    await invokeHandler(checkout, 'handleTokenizeSuccess', {
      token: 'pm_token',
    });

    const error = onFail.mock.calls[0][0];
    expect(error).not.toBeInstanceOf(APIError);
    expect(error.message).toBe('Insufficient funds.');
    expect(error.declineCode).toBe('INSUFFICIENT_FUNDS');
    expect(error.declineCodeSource).toBe('stripe');
    expect(error).not.toHaveProperty('response');
  });
});
