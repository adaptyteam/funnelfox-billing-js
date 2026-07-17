/**
 * @jest-environment jsdom
 */

import sessionService from '../src/shared/services/session-service';

const baseParams = {
  orgId: 'org_123',
  priceId: 'price_123',
  externalId: 'user_456',
  email: 'user@test.com',
  integration: 'stripe' as const,
};

const successBody = {
  status: 'success',
  data: { client_token: 'ct', order_id: 'order-1' },
};

function mockFetchOnce(body: unknown, ok = true) {
  (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
    ok,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('SessionService', () => {
  beforeEach(() => {
    sessionService.clearCache();
    (global.fetch as jest.Mock).mockReset();
  });

  test('caches successful sessions per key', async () => {
    mockFetchOnce(successBody);
    const a = await sessionService.createSession(baseParams);
    const b = await sessionService.createSession(baseParams);
    expect(b).toBe(a);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('different countryCode produces a different session', async () => {
    mockFetchOnce(successBody);
    mockFetchOnce({
      ...successBody,
      data: { ...successBody.data, order_id: 'order-2' },
    });
    await sessionService.createSession({ ...baseParams, countryCode: 'US' });
    await sessionService.createSession({ ...baseParams, countryCode: 'DE' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not cache a status:error response', async () => {
    mockFetchOnce({ status: 'error', error: [{ msg: 'boom' }] });
    mockFetchOnce(successBody);
    await sessionService.createSession(baseParams); // resolves with error envelope
    await Promise.resolve(); // let the eviction tail run
    await sessionService.createSession(baseParams);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not cache a rejected request', async () => {
    jest.useFakeTimers();
    try {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
      const first = sessionService.createSession(baseParams);
      const rejection = expect(first).rejects.toThrow();
      await jest.runAllTimersAsync();
      await rejection;
      expect(global.fetch).toHaveBeenCalledTimes(3); // one attempt per retry

      await Promise.resolve(); // let the eviction tail run
      (global.fetch as jest.Mock).mockReset();
      mockFetchOnce(successBody);
      const resp = await sessionService.createSession(baseParams);
      expect(resp.data.order_id).toBe('order-1');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('invalidate() evicts exactly one key', async () => {
    mockFetchOnce(successBody);
    mockFetchOnce({
      ...successBody,
      data: { ...successBody.data, order_id: 'order-2' },
    });
    await sessionService.createSession(baseParams);
    sessionService.invalidate(baseParams);
    const resp = await sessionService.createSession(baseParams);
    expect(resp.data.order_id).toBe('order-2');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
