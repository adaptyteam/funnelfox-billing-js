/**
 * @jest-environment jsdom
 */

import { configure, createClientSession } from '../src';
import { APIError } from '../src/errors';

describe('createClientSession', () => {
  const baseConfig = {
    priceId: 'price_123',
    externalId: 'user_456',
    email: 'user@test.com',
  };

  beforeEach(() => {
    configure({
      baseUrl: 'https://api.example.com',
      orgId: 'org_123',
    });
  });

  test('returns processed session data on success', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'success',
          data: {
            client_token: 'client-token',
            order_id: 'order-abc',
          },
        }),
    } as Response);

    const session = await createClientSession({
      ...baseConfig,
      clientMetadata: { source: 'jest' },
    });

    expect(session).toEqual({
      type: 'session_created',
      clientToken: 'client-token',
      orderId: 'order-abc',
    });
  });

  test('throws APIError when backend returns error payload', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: 'error',
          req_id: 'req-123',
          error: [
            {
              msg: 'Bad request',
              code: 'bad_request',
              type: 'api_exception',
            },
          ],
        }),
    } as Response);

    const promise = createClientSession(baseConfig);
    await expect(promise).rejects.toThrow(APIError);
    await expect(promise).rejects.toThrow('Bad request');
  });
});
