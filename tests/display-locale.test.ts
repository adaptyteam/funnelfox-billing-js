/**
 * @jest-environment jsdom
 */

import { buildOneClickRequest, createClientSession } from '../src/api';
import APIClient from '../src/api-client';
import CheckoutInstance from '../src/checkout';
import sessionService from '../src/shared/services/session-service';
import type { CheckoutConfigWithCallbacks } from '../src/types';

jest.mock('../src/primer-wrapper', () =>
  jest.fn(() => ({
    disableButtons: jest.fn(),
    refreshClientSession: jest.fn().mockResolvedValue(undefined),
  }))
);

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

describe('malformed display codes', () => {
  beforeEach(() => {
    sessionService.clearCache();
    fetchMock().mockReset();
  });

  test('are trimmed and upper-cased, or dropped with a warning instead of failing the session', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    respondOnce();
    await createClientSession({
      ...session,
      displayCurrency: ' eur ',
      displayCountry: 'de',
    });
    expect(lastBody()).toMatchObject({
      display_currency_code: 'EUR',
      display_country_code: 'DE',
    });

    respondOnce({ order_id: 'order-2' });
    await createClientSession({
      ...session,
      displayCurrency: 'EURO',
      displayCountry: 'DEU',
    });
    const body = lastBody();
    expect(body).not.toHaveProperty('display_currency_code');
    expect(body).not.toHaveProperty('display_country_code');
    expect(warn).toHaveBeenCalledTimes(2);

    expect(
      buildOneClickRequest({
        priceId: 'pp_upsell',
        externalId: 'user_1',
        clientMetadata: {},
        orgId: 'org_123',
        displayCurrency: 'gbp',
      }).display_currency_code
    ).toBe('GBP');
    warn.mockRestore();
  });
});

describe('CheckoutInstance.updatePrice', () => {
  beforeEach(() => fetchMock().mockReset());

  const openCheckout = () => {
    const checkout = new CheckoutInstance({
      orgId: 'org_123',
      baseUrl: 'https://api.example.com',
      checkoutConfig: {
        customer: { externalId: 'user_456' },
        priceId: 'price_b',
        displayCurrency: 'GBP',
        displayCountry: 'GB',
      } as unknown as CheckoutConfigWithCallbacks,
    });
    checkout.orderId = 'order-1';
    checkout.clientToken = 'ct';
    return checkout;
  };

  test('sends the currency the page shows for the new price and keeps it for the next change', async () => {
    const checkout = openCheckout();
    respondOnce();
    await checkout.updatePrice('price_a', undefined, {
      displayCurrency: 'EUR',
      displayCountry: 'DE',
    });
    expect(lastBody()).toMatchObject({
      order_id: 'order-1',
      pp_ident: 'price_a',
      display_currency_code: 'EUR',
      display_country_code: 'DE',
    });

    respondOnce();
    await checkout.updatePrice('price_c');
    expect(lastBody()).toMatchObject({
      pp_ident: 'price_c',
      display_currency_code: 'EUR',
      display_country_code: 'DE',
    });
  });

  test('applies rapid price changes in call order, the last one wins', async () => {
    const checkout = openCheckout();
    let releaseFirst: () => void = () => undefined;
    fetchMock().mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseFirst = () =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ status: 'success', data: {} }),
            } as Response);
        })
    );
    respondOnce();

    const first = checkout.updatePrice('price_a');
    const second = checkout.updatePrice('price_c');
    await Promise.resolve();
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);
    const sent = fetchMock().mock.calls.map(
      call => JSON.parse(String(call[1]?.body)).pp_ident
    );
    expect(sent).toEqual(['price_a', 'price_c']);
    expect(checkout.getStatus().priceId).toBe('price_c');
  });

  test('a failed price change does not block the next one', async () => {
    const checkout = openCheckout();
    fetchMock().mockRejectedValue(new Error('network down'));
    await expect(checkout.updatePrice('price_a')).rejects.toThrow();
    fetchMock().mockReset();
    respondOnce();
    await checkout.updatePrice('price_c');
    expect(lastBody()).toMatchObject({ pp_ident: 'price_c' });
  });

  test('moving to another price drops only this checkout session from the cache', async () => {
    const invalidate = jest.spyOn(sessionService, 'invalidate');
    const clearCache = jest.spyOn(sessionService, 'clearCache');
    const checkout = openCheckout();
    respondOnce();
    await checkout.updatePrice('price_a');
    expect(clearCache).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_b', integration: 'primer' })
    );
    invalidate.mockRestore();
    clearCache.mockRestore();
  });

  test('keeps the opening currency when none is passed', async () => {
    const checkout = openCheckout();
    respondOnce();
    await checkout.updatePrice('price_a');
    expect(lastBody()).toMatchObject({
      pp_ident: 'price_a',
      display_currency_code: 'GBP',
      display_country_code: 'GB',
    });
  });
});
