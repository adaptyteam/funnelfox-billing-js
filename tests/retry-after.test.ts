/**
 * @jest-environment jsdom
 */

import APIClient from '../src/api-client';
import { APIError } from '../src/errors';

const rateLimited = (retryAfter?: string) =>
  ({
    ok: false,
    status: 429,
    headers: new Headers(retryAfter ? { 'Retry-After': retryAfter } : {}),
    json: () =>
      Promise.resolve({ status: 'error', error: [{ msg: 'Rate limit' }] }),
  }) as Response;

const success = {
  ok: true,
  json: () => Promise.resolve({ status: 'success', data: {} }),
} as Response;

describe('retry after a 429', () => {
  const client = new APIClient({
    baseUrl: 'https://api.example.com',
    orgId: 'org_123',
  });
  const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('waits for Retry-After before the next attempt', async () => {
    fetchMock.mockResolvedValueOnce(rateLimited('7'));
    fetchMock.mockResolvedValueOnce(success);
    const request = client.request('/v1/checkout/create_client_session');

    await jest.advanceTimersByTimeAsync(6999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(request).resolves.toEqual({ status: 'success', data: {} });
  });

  test('never waits longer than 10 s', async () => {
    fetchMock.mockResolvedValueOnce(rateLimited('3600'));
    fetchMock.mockResolvedValueOnce(success);
    const request = client.request('/v1/checkout/create_client_session');

    await jest.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await request;
  });

  test('keeps the usual backoff without the header', async () => {
    fetchMock.mockResolvedValueOnce(rateLimited());
    fetchMock.mockResolvedValueOnce(success);
    const request = client.request('/v1/checkout/create_client_session');

    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await request;
  });

  test('reports the wait on the error when every attempt is refused', async () => {
    fetchMock.mockResolvedValue(rateLimited('2'));
    const request = client.request('/v1/checkout/create_client_session');
    const rejection = expect(request).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 2000,
    });

    await jest.runAllTimersAsync();
    await rejection;
    await expect(request).rejects.toBeInstanceOf(APIError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
