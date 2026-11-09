/**
 * @jest-environment jsdom
 */

import { buildOneClickRequest, createClientSession } from '../src/api';
import APIClient from '../src/api-client';
import sessionService from '../src/shared/services/session-service';

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

function respondOnce(data: Record<string, unknown> = {}) {
  fetchMock().mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        status: 'success',
        data: { client_token: 'ct', order_id: 'order-1', ...data },
      }),
  } as Response);
}

function lastBody(): Record<string, unknown> {
  const calls = fetchMock().mock.calls;
  return JSON.parse(String(calls[calls.length - 1][1]?.body));
}

const session = {
  orgId: 'org_123',
  apiConfig: { baseUrl: 'https://api.example.com' },
  priceId: 'price_123',
  externalId: 'user_456',
};

describe('display currency and country', () => {
  beforeEach(() => {
    sessionService.clearCache();
    fetchMock().mockReset();
  });

  test('create_client_session carries what the page showed', async () => {
    respondOnce();
    await createClientSession({
      ...session,
      displayCurrency: 'EUR',
      displayCountry: 'DE',
    });
    expect(lastBody()).toMatchObject({
      pp_ident: 'price_123',
      display_currency_code: 'EUR',
      display_country_code: 'DE',
    });
  });

  test('create_client_session omits them when the page set none', async () => {
    respondOnce();
    await createClientSession(session);
    const body = lastBody();
    expect(body).not.toHaveProperty('display_currency_code');
    expect(body).not.toHaveProperty('display_country_code');
  });

  test('update_client_session carries them on a price change', async () => {
    respondOnce();
    const client = new APIClient({
      baseUrl: 'https://api.example.com',
      orgId: 'org_123',
    });
    await client.updateClientSession({
      orderId: 'order-1',
      clientToken: 'ct',
      priceId: 'price_456',
      displayCurrency: 'EUR',
      displayCountry: 'DE',
    });
    expect(lastBody()).toMatchObject({
      pp_ident: 'price_456',
      display_currency_code: 'EUR',
      display_country_code: 'DE',
    });
  });

  test('a cached session is not reused for another display currency', async () => {
    respondOnce();
    respondOnce({ order_id: 'order-2' });
    const params = {
      orgId: 'org_123',
      priceId: 'price_123',
      externalId: 'user_456',
      integration: 'primer' as const,
    };
    await sessionService.createSession({ ...params, displayCurrency: 'EUR' });
    await sessionService.createSession({ ...params, displayCurrency: 'GBP' });
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  test('one_click carries the upsell page currency only', () => {
    const base = {
      priceId: 'pp_upsell',
      externalId: 'user_1',
      clientMetadata: {},
      orgId: 'org_123',
      baseUrl: 'https://api.example.com',
    };
    expect(buildOneClickRequest({ ...base, displayCurrency: 'EUR' })).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: {},
      display_currency_code: 'EUR',
    });
    expect(buildOneClickRequest(base)).not.toHaveProperty(
      'display_currency_code'
    );
  });
});
