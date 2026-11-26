/**
 * @jest-environment jsdom
 */

import { createMethodGroup, initMethod } from '../src/api';
import { PaymentMethod } from '../src/enums';
import sessionService from '../src/shared/services/session-service';
import PrimerWrapper from '../src/primer-wrapper';

jest.mock('../src/primer-wrapper', () =>
  jest.fn(() => ({
    initializeHeadlessCheckout: jest.fn().mockResolvedValue(undefined),
    initMethod: jest.fn().mockResolvedValue({
      setDisabled: jest.fn(),
      destroy: jest.fn(),
    }),
    refreshClientSession: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    disableButtons: jest.fn(),
  }))
);

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

function callsTo(endpoint: string) {
  return fetchMock().mock.calls.filter(([url]) =>
    String(url).includes(endpoint)
  );
}

function bodyOf(call: Parameters<typeof fetch>) {
  return JSON.parse(String(call[1]?.body));
}

function json(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

const recalcBody = {
  status: 'success',
  data: {
    amount_total: 1100,
    tax_amount: 100,
    currency: 'USD',
    tax_behavior: 'exclusive',
  },
};

let customerSeq = 0;

function respondByEndpoint(
  recalc: () => Promise<Response> = () => json(recalcBody)
) {
  const orderId = `order-${++customerSeq}`;
  fetchMock().mockImplementation(url => {
    const path = String(url);
    if (path.includes('create_client_session')) {
      return json({
        status: 'success',
        data: {
          client_token: 'ct',
          order_id: orderId,
          tax_enabled: true,
          detected_country_code: 'NL',
        },
      });
    }
    if (path.includes('recalculate_tax')) {
      return recalc();
    }
    return json({ status: 'success', data: {} });
  });
  return orderId;
}

const WALLETS = [
  PaymentMethod.APPLE_PAY,
  PaymentMethod.GOOGLE_PAY,
  PaymentMethod.PAYPAL,
];

async function mountGroup(onTaxChange = jest.fn()) {
  const group = createMethodGroup({
    orgId: 'org_123',
    baseUrl: 'https://api.example.com',
    priceId: 'price_b',
    externalId: `user-${customerSeq}`,
    onTaxChange,
  });
  const handles = await Promise.all(
    WALLETS.map(method =>
      group.initMethod(method, document.createElement('div'))
    )
  );
  return { group, handles, onTaxChange };
}

describe('createMethodGroup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock().mockReset();
    sessionService.clearCache();
  });
  afterEach(() => jest.useRealTimers());

  test('all methods share one client session', async () => {
    respondByEndpoint();
    await mountGroup();

    expect(callsTo('create_client_session')).toHaveLength(1);
  });

  test('a plan switch moves the order once and recalculates the tax once for every method', async () => {
    const orderId = respondByEndpoint();
    const { handles, onTaxChange } = await mountGroup();
    onTaxChange.mockClear();

    await Promise.all(handles.map(handle => handle.updatePrice('price_a')));
    await jest.advanceTimersByTimeAsync(1000);

    expect(callsTo('update_client_session')).toHaveLength(1);
    expect(bodyOf(callsTo('update_client_session')[0])).toMatchObject({
      order_id: orderId,
      pp_ident: 'price_a',
    });
    expect(callsTo('recalculate_tax')).toHaveLength(1);
    expect(onTaxChange).toHaveBeenCalledTimes(WALLETS.length);
    expect(onTaxChange).toHaveBeenCalledWith(
      expect.objectContaining({ amountTotal: 1100, taxAmount: 100 })
    );
  });

  test('the group updatePrice is the same as calling it on one handle', async () => {
    respondByEndpoint();
    const { group } = await mountGroup();

    await group.updatePrice('price_a');
    await group.updatePrice('price_c');
    await group.updatePrice('price_c');

    expect(
      callsTo('update_client_session').map(call => bodyOf(call).pp_ident)
    ).toEqual(['price_a', 'price_c']);
  });

  test('a recalculation started for the old price is not reported after a plan switch', async () => {
    let releaseStale: (response: Response) => void = () => undefined;
    let recalcs = 0;
    respondByEndpoint(() =>
      ++recalcs === 1
        ? new Promise<Response>(resolve => (releaseStale = resolve))
        : json(recalcBody)
    );
    const { group, handles, onTaxChange } = await mountGroup();

    await group.updatePrice('price_a');
    await jest.advanceTimersByTimeAsync(1000);
    onTaxChange.mockClear();

    await handles[0].updatePrice('price_c');
    releaseStale({
      ok: true,
      json: () => Promise.resolve(recalcBody),
    } as Response);
    await jest.advanceTimersByTimeAsync(0);
    expect(onTaxChange).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    expect(onTaxChange).toHaveBeenCalledTimes(WALLETS.length);
  });

  test('a destroyed method gets no more tax updates, the others do', async () => {
    respondByEndpoint();
    const { handles, onTaxChange } = await mountGroup();
    await handles[0].destroy?.();
    onTaxChange.mockClear();

    await handles[1].updatePrice('price_a');
    await jest.advanceTimersByTimeAsync(1000);

    expect(onTaxChange).toHaveBeenCalledTimes(WALLETS.length - 1);
  });

  test('a failed recalculation reaches every method', async () => {
    respondByEndpoint(() =>
      json({ status: 'error', error: [{ msg: 'bad address' }] })
    );
    const onTaxError = jest.fn();
    const group = createMethodGroup({
      orgId: 'org_123',
      baseUrl: 'https://api.example.com',
      priceId: 'price_b',
      externalId: `user-${customerSeq}`,
      onTaxError,
    });
    await Promise.all(
      WALLETS.map(method =>
        group.initMethod(method, document.createElement('div'))
      )
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await group.updatePrice('price_a');
    await jest.advanceTimersByTimeAsync(10000);

    expect(callsTo('recalculate_tax').length).toBeGreaterThan(0);
    expect(onTaxError).toHaveBeenCalledTimes(WALLETS.length);
  });

  test('each method keeps its own button options', async () => {
    respondByEndpoint();
    const group = createMethodGroup({
      orgId: 'org_123',
      baseUrl: 'https://api.example.com',
      priceId: 'price_b',
      externalId: `user-${customerSeq}`,
      applePay: { buttonStyle: 'black' },
    });
    const wrappers = PrimerWrapper as unknown as jest.Mock;
    wrappers.mockClear();

    await group.initMethod(
      PaymentMethod.APPLE_PAY,
      document.createElement('div'),
      { applePay: { buttonStyle: 'white' } }
    );
    await group.initMethod(
      PaymentMethod.GOOGLE_PAY,
      document.createElement('div')
    );

    const [whiteWrapper, defaultWrapper] = wrappers.mock.results.map(
      result => result.value.initializeHeadlessCheckout.mock.calls[0][1]
    );
    expect(whiteWrapper.applePay).toMatchObject({ buttonStyle: 'white' });
    expect(defaultWrapper.applePay).toMatchObject({ buttonStyle: 'black' });
  });

  test('initMethod without a group keeps one session and one update per method', async () => {
    respondByEndpoint();
    const options = {
      orgId: 'org_123',
      baseUrl: 'https://api.example.com',
      priceId: 'price_b',
      externalId: `user-${customerSeq}`,
      sessionScope: 'legacy',
    };
    const handles = await Promise.all(
      WALLETS.map(method =>
        initMethod(method, document.createElement('div'), options)
      )
    );

    await Promise.all(handles.map(handle => handle.updatePrice('price_a')));

    expect(callsTo('create_client_session')).toHaveLength(1);
    expect(callsTo('update_client_session')).toHaveLength(WALLETS.length);
  });
});
