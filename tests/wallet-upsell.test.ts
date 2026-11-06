/**
 * @jest-environment jsdom
 *
 * FFB-837: Billing.mountWalletUpsell, the one-click upsell confirmed in the wallet sheet,
 * against a mocked backend and a mocked Primer headless checkout.
 */

jest.mock('../src/one-click-3ds', () => ({
  ...jest.requireActual('../src/one-click-3ds'),
  THREE_DS_OVERLAY_REVEAL_DELAY_MS: 20,
}));

import { silentPurchase } from '../src/api';
import * as nativeButton from '../src/utils/apple-pay-native-button';
import { APIError, ValidationError } from '../src/errors';
import {
  REFRESH_BEFORE_EXPIRY_MS,
  mountWalletUpsell,
} from '../src/wallet-upsell';
import type {
  MountWalletUpsellOptions,
  WalletUpsellMount,
  WalletUpsellResult,
} from '../src/types';
import {
  ACTION_TOKEN,
  BASE_URL,
  CLOSE_ERROR,
  ENDPOINT,
  ORG_ID,
  bodyOf,
  callsTo,
  jsonResponse,
  paymentBody,
  routeFetch,
} from './helpers/one-click';

const WALLET_SESSION = '/v1/checkout/one_click_wallet_session';
const HOUR = 3600 * 1000;

/** Naive UTC, as the backend serializes `expires_at`. */
function naiveUtc(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString().replace('Z', '');
}

function sessionBody(extra: Record<string, unknown> = {}) {
  return {
    status: 'success',
    data: {
      wallet: 'GOOGLE_PAY',
      client_token: 'wallet-client-token-1',
      session_id: 'sess_1',
      order_id: 'order_w1',
      amount: 999,
      currency: 'usd',
      expires_at: naiveUtc(6 * HOUR),
      ...extra,
    },
  };
}

function errorBody(code: string, msg = code) {
  return { status: 'error', error: [{ msg, code, type: 'api_exception' }] };
}

// ---------- Primer mock ----------

interface Handler {
  handleSuccess: jest.Mock;
  handleFailure: jest.Mock;
  continueWithNewClientToken: jest.Mock;
}

interface HeadlessCall {
  token: string;
  options: Record<string, (...args: unknown[]) => unknown> & {
    applePay?: unknown;
    googlePay?: unknown;
  };
  button: { render: jest.Mock; setDisabled: jest.Mock; clean: jest.Mock };
}

interface PrimerMock {
  headless: HeadlessCall[];
  last(): HeadlessCall;
}

function installPrimer(
  opts: { methods?: string[]; renderError?: unknown } = {}
): PrimerMock {
  const mock: PrimerMock = {
    headless: [],
    last: () => mock.headless[mock.headless.length - 1],
  };
  const createHeadless = jest.fn(
    async (token: string, options: HeadlessCall['options']) => {
      const button = {
        render: jest.fn(async (wrapper: HTMLElement) => {
          if (opts.renderError) {
            throw opts.renderError;
          }
          wrapper.appendChild(document.createElement('button'));
        }),
        setDisabled: jest.fn().mockResolvedValue(undefined),
        clean: jest.fn(),
      };
      mock.headless.push({ token, options, button });
      return {
        start: jest.fn(async () => {
          options.onAvailablePaymentMethodsLoad(
            (opts.methods ?? ['PAYMENT_CARD', 'GOOGLE_PAY', 'APPLE_PAY']).map(
              type => ({ type })
            )
          );
        }),
        createPaymentMethodManager: jest.fn(async () => ({
          createButton: () => button,
        })),
      };
    }
  );
  (window as unknown as { Primer: unknown }).Primer = {
    createHeadless,
    showUniversalCheckout: jest.fn(),
  };
  return mock;
}

function newHandler(): Handler {
  return {
    handleSuccess: jest.fn(),
    handleFailure: jest.fn(),
    continueWithNewClientToken: jest.fn(),
  };
}

/** The customer taps; `false` when the SDK refuses the tap. */
function tap(call: HeadlessCall): boolean {
  return call.options.onTokenizeShouldStart({
    paymentMethodType: 'GOOGLE_PAY',
  }) as boolean;
}

/** Tap, confirm in the sheet; returns the tokenize handler. */
function tapAndConfirm(
  call: HeadlessCall,
  token = 'fresh_wallet_tok'
): Handler {
  expect(tap(call)).toBe(true);
  call.options.onTokenizeStart();
  const handler = newHandler();
  call.options.onTokenizeSuccess({ token }, handler);
  return handler;
}

function tapAndClose(call: HeadlessCall): void {
  expect(tap(call)).toBe(true);
  call.options.onPaymentMethodAction('PAYMENT_METHOD_UNSELECTED', {
    paymentMethodType: 'GOOGLE_PAY',
  });
}

// ---------- harness ----------

interface Harness {
  container: HTMLElement;
  options: MountWalletUpsellOptions;
  results: WalletUpsellResult[];
  nextResult(): Promise<WalletUpsellResult>;
}

function harness(extra: Partial<MountWalletUpsellOptions> = {}): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const results: WalletUpsellResult[] = [];
  let waiting: ((result: WalletUpsellResult) => void) | null = null;
  const options: MountWalletUpsellOptions = {
    orgId: ORG_ID,
    baseUrl: BASE_URL,
    priceId: 'pp_upsell',
    externalId: 'user_1',
    clientMetadata: { ff_billing_reason: 'upsell' },
    onStart: jest.fn(),
    onThreeDSStart: jest.fn(),
    onThreeDSEnd: jest.fn(),
    onResult: (result: WalletUpsellResult) => {
      results.push(result);
      waiting?.(result);
      waiting = null;
    },
    ...extra,
  };
  return {
    container,
    options,
    results,
    nextResult: () =>
      new Promise(resolve => {
        waiting = resolve;
      }),
  };
}

async function mounted(
  h: Harness
): Promise<Extract<WalletUpsellMount, { mounted: true }>> {
  const mount = await mountWalletUpsell(h.container, h.options);
  expect(mount.mounted).toBe(true);
  return mount as Extract<WalletUpsellMount, { mounted: true }>;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- mount ----------

describe('mount', () => {
  test('rejects only with ValidationError on invalid arguments', async () => {
    const h = harness();
    await expect(
      mountWalletUpsell(null as unknown as HTMLElement, h.options)
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mountWalletUpsell(h.container, { ...h.options, priceId: '' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mountWalletUpsell(h.container, {
        ...h.options,
        onResult: undefined as unknown as MountWalletUpsellOptions['onResult'],
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('not_wallet: no wallet for this customer, Primer is not touched', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, {
          status: 'success',
          data: { wallet: null, reason: 'not_wallet' },
        }),
      ],
    });
    const h = harness();
    await expect(mountWalletUpsell(h.container, h.options)).resolves.toEqual({
      mounted: false,
      reason: 'not_wallet',
    });
    expect(primer.headless).toHaveLength(0);
    expect(h.container.innerHTML).toBe('');
    expect(bodyOf(callsTo(WALLET_SESSION)[0])).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: { ff_billing_reason: 'upsell' },
    });
  });

  test.each([
    ['double_purchase', jsonResponse(400, errorBody('double_purchase'))],
    ['invalid_price', jsonResponse(400, errorBody('invalid_price'))],
    [
      'merchant_config_error',
      jsonResponse(400, errorBody('merchant_config_error')),
    ],
    ['rate limit', jsonResponse(429, errorBody(''))],
    ['5xx', jsonResponse(500, errorBody(''))],
    ['network', new TypeError('Failed to fetch')],
    [
      'a broken body',
      jsonResponse(200, { status: 'success', data: { wallet: 'GOOGLE_PAY' } }),
    ],
  ])('error: %s', async (_name, response) => {
    installPrimer();
    routeFetch({ [WALLET_SESSION]: [response] });
    const h = harness();
    const mount = await mountWalletUpsell(h.container, h.options);
    expect(mount).toMatchObject({ mounted: false, reason: 'error' });
    expect((mount as { error: Error }).error).toBeInstanceOf(Error);
    expect(h.container.innerHTML).toBe('');
  });

  test('wallet_unavailable: the device cannot show the wallet, the other one is not offered', async () => {
    installPrimer({ methods: ['PAYMENT_CARD', 'APPLE_PAY'] });
    routeFetch({ [WALLET_SESSION]: [jsonResponse(200, sessionBody())] });
    const h = harness();
    await expect(mountWalletUpsell(h.container, h.options)).resolves.toEqual({
      mounted: false,
      reason: 'wallet_unavailable',
      wallet: 'GOOGLE_PAY',
    });
    expect(h.container.innerHTML).toBe('');
  });

  test('error: the button fails to render, nothing is left behind', async () => {
    installPrimer({ renderError: new Error('render failed') });
    routeFetch({ [WALLET_SESSION]: [jsonResponse(200, sessionBody())] });
    const h = harness();
    const mount = await mountWalletUpsell(h.container, h.options);
    expect(mount).toMatchObject({ mounted: false, reason: 'error' });
    expect(h.container.innerHTML).toBe('');
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
  });

  test('mounted: the native button gets the session token and the style', async () => {
    const primer = installPrimer();
    routeFetch({ [WALLET_SESSION]: [jsonResponse(200, sessionBody())] });
    const h = harness({
      style: {
        buttonType: 'pay',
        buttonColor: 'white-outline',
        height: 48,
        borderRadius: 12,
      },
    });
    const mount = await mounted(h);
    expect(mount.wallet).toBe('GOOGLE_PAY');
    expect(primer.last().token).toBe('wallet-client-token-1');
    expect(primer.last().options.googlePay).toEqual({
      buttonType: 'pay',
      buttonColor: 'white',
      buttonSizeMode: 'fill',
    });
    expect(h.container.querySelector('button')).not.toBeNull();
    const css = document.head.querySelector('style')!.textContent;
    expect(css).toContain('height:48px');
    expect(css).toContain('border-radius:12px');
    mount.destroy();
    expect(h.container.innerHTML).toBe('');
    expect(primer.last().button.clean).toHaveBeenCalled();
  });

  test.each([
    [
      { buttonType: 'buy', buttonColor: 'white' },
      { buttonType: 'buy', buttonStyle: 'white' },
    ],
    [{ buttonType: 'pay' }, { buttonType: 'plain', buttonStyle: 'black' }],
    [{}, { buttonType: 'plain', buttonStyle: 'black' }],
  ] as const)('Apple Pay style %j', async (style, expected) => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ wallet: 'APPLE_PAY' })),
      ],
    });
    const h = harness({ style });
    const mount = await mounted(h);
    expect(mount.wallet).toBe('APPLE_PAY');
    expect(primer.last().options.applePay).toEqual(expected);
    mount.destroy();
  });

  test('Google Pay has no "continue" type: plain', async () => {
    const primer = installPrimer();
    routeFetch({ [WALLET_SESSION]: [jsonResponse(200, sessionBody())] });
    const mount = await mounted(harness({ style: { buttonType: 'continue' } }));
    expect(primer.last().options.googlePay).toMatchObject({
      buttonType: 'plain',
      buttonColor: 'black',
    });
    mount.destroy();
  });
});

// ---------- charge ----------

describe('charge', () => {
  test('confirmed sheet: one_click with the fresh token and the session, then the button is off', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, paymentBody({ order_id: 'order_w1' })),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    const handler = tapAndConfirm(primer.last());

    await expect(result).resolves.toEqual({
      outcome: 'succeeded',
      orderId: 'order_w1',
      threeDSChallenged: false,
    });
    expect(h.options.onStart).toHaveBeenCalledTimes(1);
    expect(handler.handleSuccess).toHaveBeenCalled();
    expect(bodyOf(callsTo(ENDPOINT.ONE_CLICK)[0])).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: { ff_billing_reason: 'upsell' },
      payment_method_token: 'fresh_wallet_tok',
      session_id: 'sess_1',
      idempotency_key: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
    });
    expect(primer.last().button.setDisabled).toHaveBeenLastCalledWith(true);
    expect(tap(primer.last())).toBe(false);
    mount.setDisabled(false);
    expect(primer.last().button.setDisabled).toHaveBeenLastCalledWith(true);
    expect(h.results).toHaveLength(1);
    mount.destroy();
  });

  test('declined: the sheet shows the message, outcome declined', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'failed',
            failed_message_for_user: 'Insufficient funds',
            decline_code: 'insufficient_funds',
            decline_code_source: 'primer',
          })
        ),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    const handler = tapAndConfirm(primer.last());
    await expect(result).resolves.toMatchObject({
      outcome: 'declined',
      failedMessageForUser: 'Insufficient funds',
      declineCode: 'insufficient_funds',
    });
    expect(handler.handleFailure).toHaveBeenCalledWith('Insufficient funds');
    mount.destroy();
  });

  test('cancelled: the sheet is closed, the button stays and a second tap pays', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))],
    });
    const h = harness();
    const mount = await mounted(h);
    tapAndClose(primer.last());
    expect(h.results).toEqual([
      { outcome: 'cancelled', orderId: null, threeDSChallenged: false },
    ]);
    expect(primer.last().button.setDisabled).not.toHaveBeenCalledWith(true);
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(0);

    const result = h.nextResult();
    tapAndConfirm(primer.last());
    await expect(result).resolves.toMatchObject({ outcome: 'succeeded' });
    expect(h.options.onStart).toHaveBeenCalledTimes(2);
    mount.destroy();
  });

  test('a double tap is refused while the attempt runs, and so is silentPurchase', async () => {
    const primer = installPrimer();
    let answer: (response: Response) => void = () => {};
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [
        () => new Promise<Response>(resolve => (answer = resolve)),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    expect(tap(primer.last())).toBe(false);
    await expect(
      silentPurchase({
        orgId: ORG_ID,
        baseUrl: BASE_URL,
        priceId: 'pp_other',
        externalId: 'user_1',
        clientMetadata: {},
        handle3DS: true,
      })
    ).resolves.toMatchObject({
      outcome: 'error',
      error: expect.objectContaining({ code: 'one_click_in_progress' }),
    });
    answer(jsonResponse(200, paymentBody({})));
    await expect(result).resolves.toMatchObject({ outcome: 'succeeded' });
    expect(h.options.onStart).toHaveBeenCalledTimes(1);
    mount.destroy();
  });

  test('already_purchased on DOUBLE_PURCHASE', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [jsonResponse(400, errorBody('double_purchase'))],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    await expect(result).resolves.toEqual({
      outcome: 'already_purchased',
      orderId: null,
      threeDSChallenged: false,
    });
    mount.destroy();
  });

  test('the one-click limit (429) is an error with the APIError, nothing retried', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(429, {
          status: 'error',
          error: [
            {
              msg: 'Rate limit exceeded. Try in 3600s.',
              type: 'api_exception',
            },
          ],
        }),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    const outcome = await result;
    expect(outcome).toMatchObject({
      outcome: 'error',
      orderId: null,
      failedRequest: 'one_click',
    });
    expect(outcome.error).toBeInstanceOf(APIError);
    expect((outcome.error as APIError).statusCode).toBe(429);
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
    mount.destroy();
  });

  test('retries run out: processing with the reserved order id', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [jsonResponse(502, errorBody(''))],
    });
    const h = harness();
    const mount = await mounted(h);
    jest.useFakeTimers();
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    await jest.advanceTimersByTimeAsync(8000);
    await expect(result).resolves.toMatchObject({
      outcome: 'processing',
      orderId: 'order_w1',
      failedRequest: 'one_click',
    });
    const keys = callsTo(ENDPOINT.ONE_CLICK).map(
      c => bodyOf(c).idempotency_key
    );
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1);
    mount.destroy();
  });

  test('wallet_session_invalid: one retry with a new session of the same amount', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody()),
        jsonResponse(
          200,
          sessionBody({
            session_id: 'sess_2',
            client_token: 'wallet-client-token-2',
          })
        ),
      ],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(400, errorBody('wallet_session_invalid')),
        jsonResponse(200, paymentBody({ order_id: 'order_w2' })),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    await expect(result).resolves.toMatchObject({
      outcome: 'succeeded',
      orderId: 'order_w2',
    });
    const [first, second] = callsTo(ENDPOINT.ONE_CLICK).map(bodyOf);
    expect(first.session_id).toBe('sess_1');
    expect(second.session_id).toBe('sess_2');
    expect(second.payment_method_token).toBe('fresh_wallet_tok');
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
    mount.destroy();
  });

  test('wallet_session_invalid with a different amount: no retry, error', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody()),
        jsonResponse(200, sessionBody({ session_id: 'sess_2', amount: 1099 })),
      ],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(400, errorBody('wallet_session_invalid')),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    const handler = tapAndConfirm(primer.last());
    await expect(result).resolves.toMatchObject({
      outcome: 'error',
      orderId: null,
      failedRequest: 'one_click',
    });
    expect(handler.handleFailure).toHaveBeenCalled();
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
    mount.destroy();
  });

  test('wallet_session_invalid twice: a single retry, then error', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody()),
        jsonResponse(200, sessionBody({ session_id: 'sess_2' })),
      ],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(400, errorBody('wallet_session_invalid')),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    await expect(result).resolves.toMatchObject({ outcome: 'error' });
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(2);
    mount.destroy();
  });

  test('wallet_token_rejected: error, the button is off', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(400, errorBody('wallet_token_rejected')),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    tapAndConfirm(primer.last());
    const outcome = await result;
    expect(outcome).toMatchObject({
      outcome: 'error',
      failedRequest: 'one_click',
    });
    expect((outcome.error as APIError).errorCode).toBe('wallet_token_rejected');
    expect(primer.last().button.setDisabled).toHaveBeenLastCalledWith(true);
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
    mount.destroy();
  });

  test('a Primer tokenization error ends the attempt as an error', async () => {
    const primer = installPrimer();
    routeFetch({ [WALLET_SESSION]: [jsonResponse(200, sessionBody())] });
    const h = harness();
    const mount = await mounted(h);
    expect(tap(primer.last())).toBe(true);
    primer.last().options.onTokenizeError(new Error('tokenize failed'));
    expect(h.results).toEqual([
      expect.objectContaining({ outcome: 'error', orderId: null }),
    ]);
    mount.destroy();
  });
});

// ---------- 3DS ----------

describe('3DS', () => {
  async function challenge(oneClick: Response, resume?: Response) {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [oneClick],
      ...(resume ? { [ENDPOINT.RESUME]: [resume] } : {}),
    });
    const h = harness();
    const mount = await mounted(h);
    const result = h.nextResult();
    const handler = tapAndConfirm(primer.last());
    await new Promise(resolve => setTimeout(resolve, 0));
    return { primer, h, mount, result, handler };
  }

  const actionBody = jsonResponse(
    200,
    paymentBody({ action_required_token: ACTION_TOKEN, order_id: 'order_w1' })
  );

  test('a shown challenge that passes: hooks once each, resume_payment once', async () => {
    const { primer, h, mount, result, handler } = await challenge(
      actionBody,
      jsonResponse(200, paymentBody({ order_id: 'order_w1' }))
    );
    expect(handler.continueWithNewClientToken).toHaveBeenCalledWith(
      ACTION_TOKEN
    );
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(h.options.onThreeDSStart).toHaveBeenCalledWith({
      orderId: 'order_w1',
    });
    const resumeHandler = newHandler();
    await primer
      .last()
      .options.onResumeSuccess({ resumeToken: 'resume_1' }, resumeHandler);
    await expect(result).resolves.toEqual({
      outcome: 'succeeded',
      orderId: 'order_w1',
      threeDSChallenged: true,
    });
    expect(h.options.onThreeDSEnd).toHaveBeenCalledTimes(1);
    expect(h.options.onThreeDSEnd).toHaveBeenCalledWith({ result: 'passed' });
    expect(resumeHandler.handleSuccess).toHaveBeenCalled();
    expect(bodyOf(callsTo(ENDPOINT.RESUME)[0])).toEqual({
      order_id: 'order_w1',
      resume_token: 'resume_1',
    });
    mount.destroy();
  });

  test('frictionless: resumed before the overlay shows, no hooks', async () => {
    const { primer, h, mount, result } = await challenge(
      actionBody,
      jsonResponse(200, paymentBody({ order_id: 'order_w1' }))
    );
    await primer
      .last()
      .options.onResumeSuccess({ resumeToken: 'resume_1' }, newHandler());
    await expect(result).resolves.toMatchObject({
      outcome: 'succeeded',
      threeDSChallenged: false,
    });
    expect(h.options.onThreeDSStart).not.toHaveBeenCalled();
    expect(h.options.onThreeDSEnd).not.toHaveBeenCalled();
    mount.destroy();
  });

  test('closing the challenge: 3ds_abandoned', async () => {
    const { primer, h, mount, result } = await challenge(actionBody);
    await new Promise(resolve => setTimeout(resolve, 40));
    primer.last().options.onResumeError(CLOSE_ERROR);
    await expect(result).resolves.toEqual({
      outcome: '3ds_abandoned',
      orderId: 'order_w1',
      threeDSChallenged: true,
    });
    expect(h.options.onThreeDSEnd).toHaveBeenCalledWith({
      result: 'abandoned',
    });
    mount.destroy();
  });

  test('a failed challenge: 3ds_failed', async () => {
    const { primer, mount, result } = await challenge(actionBody);
    primer.last().options.onResumeError(new Error('auth failed'));
    await expect(result).resolves.toMatchObject({ outcome: '3ds_failed' });
    mount.destroy();
  });

  test('resume_payment fails: error with failedRequest', async () => {
    const { primer, mount, result } = await challenge(
      actionBody,
      jsonResponse(500, errorBody(''))
    );
    await primer
      .last()
      .options.onResumeSuccess({ resumeToken: 'resume_1' }, newHandler());
    await expect(result).resolves.toMatchObject({
      outcome: 'error',
      failedRequest: 'resume_payment',
    });
    mount.destroy();
  });

  test('an action token that is not a 3DS token: error, no challenge', async () => {
    const { mount, result, handler } = await challenge(
      jsonResponse(200, paymentBody({ action_required_token: 'not-a-jwt' }))
    );
    await expect(result).resolves.toMatchObject({ outcome: 'error' });
    expect(handler.continueWithNewClientToken).not.toHaveBeenCalled();
    mount.destroy();
  });
});

// ---------- session life ----------

describe('session life', () => {
  test('a tap on an expiring session is refused and the button is replaced', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ expires_at: naiveUtc(30 * 1000) })),
        jsonResponse(
          200,
          sessionBody({
            session_id: 'sess_2',
            client_token: 'wallet-client-token-2',
          })
        ),
      ],
      [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))],
    });
    const h = harness();
    const mount = await mounted(h);
    expect(tap(primer.last())).toBe(false);
    expect(h.options.onStart).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(primer.headless.map(call => call.token)).toEqual([
      'wallet-client-token-1',
      'wallet-client-token-2',
    ]);
    expect(h.container.querySelectorAll('button')).toHaveLength(1);
    expect(tap(primer.headless[0])).toBe(false);

    const result = h.nextResult();
    tapAndConfirm(primer.last());
    await expect(result).resolves.toMatchObject({ outcome: 'succeeded' });
    expect(bodyOf(callsTo(ENDPOINT.ONE_CLICK)[0]).session_id).toBe('sess_2');
    mount.destroy();
  });

  test('a session shorter than the refresh margin is not prepared again in a loop', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(
          200,
          sessionBody({ expires_at: naiveUtc(10 * 60 * 1000) })
        ),
      ],
    });
    const h = harness();
    jest.useFakeTimers();
    const mount = await mounted(h);
    await jest.advanceTimersByTimeAsync(59 * 1000);
    expect(callsTo(WALLET_SESSION)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2 * 1000);
    expect(callsTo(WALLET_SESSION)).toHaveLength(2);
    expect(primer.headless).toHaveLength(2);
    mount.destroy();
  });

  test('the session is prepared again before it expires', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ expires_at: naiveUtc(HOUR) })),
        jsonResponse(
          200,
          sessionBody({
            session_id: 'sess_2',
            client_token: 'wallet-client-token-2',
          })
        ),
      ],
    });
    const h = harness();
    jest.useFakeTimers();
    const mount = await mounted(h);
    await jest.advanceTimersByTimeAsync(HOUR - REFRESH_BEFORE_EXPIRY_MS - 1000);
    expect(primer.headless).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(primer.headless.map(call => call.token)).toEqual([
      'wallet-client-token-1',
      'wallet-client-token-2',
    ]);
    expect(h.results).toEqual([]);
    mount.destroy();
  });

  test('preparing again fails: error without a tap, the button is off', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ expires_at: naiveUtc(HOUR) })),
        jsonResponse(200, { status: 'success', data: { wallet: null } }),
      ],
    });
    const h = harness();
    jest.useFakeTimers();
    const mount = await mounted(h);
    await jest.advanceTimersByTimeAsync(HOUR);
    expect(h.results).toEqual([
      expect.objectContaining({ outcome: 'error', orderId: null }),
    ]);
    expect(h.options.onStart).not.toHaveBeenCalled();
    expect(primer.last().button.setDisabled).toHaveBeenLastCalledWith(true);
    mount.destroy();
  });

  test('back on the tab with an expiring session: prepared again', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ expires_at: naiveUtc(HOUR) })),
        jsonResponse(
          200,
          sessionBody({
            session_id: 'sess_2',
            client_token: 'wallet-client-token-2',
          })
        ),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + HOUR - 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(primer.last().token).toBe('wallet-client-token-2');
    mount.destroy();
  });
});

// ---------- destroy / setDisabled ----------

describe('destroy and setDisabled', () => {
  test('setDisabled reaches the button and blocks taps', async () => {
    const primer = installPrimer();
    routeFetch({ [WALLET_SESSION]: [jsonResponse(200, sessionBody())] });
    const mount = await mounted(harness());
    mount.setDisabled(true);
    expect(primer.last().button.setDisabled).toHaveBeenLastCalledWith(true);
    expect(tap(primer.last())).toBe(false);
    mount.setDisabled(false);
    expect(primer.last().button.setDisabled).toHaveBeenLastCalledWith(false);
    expect(tap(primer.last())).toBe(true);
    mount.destroy();
  });

  test('destroy with the sheet open frees the customer for silentPurchase', async () => {
    const primer = installPrimer();
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))],
    });
    const h = harness();
    const mount = await mounted(h);
    expect(tap(primer.last())).toBe(true);
    mount.destroy();
    await expect(
      silentPurchase({
        orgId: ORG_ID,
        baseUrl: BASE_URL,
        priceId: 'pp_upsell',
        externalId: 'user_1',
        clientMetadata: {},
        handle3DS: true,
      })
    ).resolves.toMatchObject({ outcome: 'succeeded' });
    expect(h.results).toEqual([]);
  });

  test('Apple Pay "continue" is drawn by Apple\'s element over Primer\'s button', async () => {
    const overlay = document.createElement('apple-pay-button');
    const spy = jest
      .spyOn(nativeButton, 'overlayNativeApplePayButton')
      .mockResolvedValue(overlay);
    installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ wallet: 'APPLE_PAY' })),
      ],
    });
    const mount = await mounted(
      harness({
        style: {
          buttonType: 'continue',
          buttonColor: 'white',
          borderRadius: 8,
        },
      })
    );
    expect(spy).toHaveBeenCalledWith(expect.any(HTMLElement), {
      buttonType: 'continue',
      buttonStyle: 'white',
      borderRadius: 8,
    });
    expect(document.head.querySelector('style')!.textContent).toContain(
      'opacity:0'
    );
    mount.setDisabled(true);
    expect(overlay.style.pointerEvents).toBe('none');
    mount.destroy();
  });

  test('Apple Pay "continue" without Apple\'s element keeps Primer\'s button visible', async () => {
    jest
      .spyOn(nativeButton, 'overlayNativeApplePayButton')
      .mockResolvedValue(null);
    installPrimer();
    routeFetch({
      [WALLET_SESSION]: [
        jsonResponse(200, sessionBody({ wallet: 'APPLE_PAY' })),
      ],
    });
    const mount = await mounted(harness({ style: { buttonType: 'continue' } }));
    expect(document.head.querySelector('style')!.textContent).not.toContain(
      'opacity:0'
    );
    mount.destroy();
  });

  test('after destroy no result is reported and taps are refused', async () => {
    const primer = installPrimer();
    let answer: (response: Response) => void = () => {};
    routeFetch({
      [WALLET_SESSION]: [jsonResponse(200, sessionBody())],
      [ENDPOINT.ONE_CLICK]: [
        () => new Promise<Response>(resolve => (answer = resolve)),
      ],
    });
    const h = harness();
    const mount = await mounted(h);
    tapAndConfirm(primer.last());
    mount.destroy();
    expect(h.container.innerHTML).toBe('');
    answer(jsonResponse(200, paymentBody({})));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(h.results).toEqual([]);
    expect(tap(primer.last())).toBe(false);
  });
});
