/**
 * @jest-environment jsdom
 *
 * FFB-704: silentPurchase legacy compatibility + detailed (handle3DS) mode.
 * Row numbers refer to the outcome table in the FFB-704 plan (§4.2).
 */

import * as constants from '../src/constants';
import { silentPurchase } from '../src/api';
import Billing, * as entry from '../src';
import {
  APIError,
  FunnefoxSDKError,
  NetworkError,
  PrimerError,
  ValidationError,
} from '../src/errors';
import { HeadlessManager } from '../src/utils/headless-manager';
import APIClient from '../src/api-client';
import PrimerWrapper from '../src/primer-wrapper';
import * as threeDS from '../src/one-click-3ds';
import type { OneClickResult, ThreeDSResult } from '../src/types';
import {
  ACTION_TOKEN,
  BASE_URL,
  CLOSE_ERROR,
  ENDPOINT,
  ORG_ID,
  SESSION_BODY,
  bodyOf,
  callsTo,
  challengeNeverEnds,
  installPrimer,
  jsonResponse,
  paymentBody,
  primerToken,
  resumeErrorWith,
  resumeWith,
  routeFetch,
} from './helpers/one-click';

const base = {
  priceId: 'pp_upsell',
  externalId: 'user_1',
  clientMetadata: { source: 'jest' },
  orgId: ORG_ID,
  baseUrl: BASE_URL,
};

function hooks() {
  const calls: string[] = [];
  const onThreeDSStart = jest.fn((info: { orderId: string }) => {
    calls.push(`start:${info.orderId}`);
  });
  const onThreeDSEnd = jest.fn((info: { result: ThreeDSResult }) => {
    calls.push(`end:${info.result}`);
  });
  return { calls, onThreeDSStart, onThreeDSEnd };
}

const detailed = (
  h: ReturnType<typeof hooks>,
  extra: Record<string, unknown> = {}
) =>
  silentPurchase({
    ...base,
    handle3DS: true,
    onThreeDSStart: h.onThreeDSStart,
    onThreeDSEnd: h.onThreeDSEnd,
    ...extra,
  });

const actionResponse = (orderId = 'order_1') =>
  jsonResponse(
    200,
    paymentBody({
      checkout_status: 'processing',
      action_required_token: ACTION_TOKEN,
      order_id: orderId,
    })
  );

beforeEach(() => {
  installPrimer();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Legacy mode (AC2, AC3)
// ---------------------------------------------------------------------------

describe('legacy silentPurchase (no handle3DS)', () => {
  test('L1: body is exactly {pp_ident, external_id, client_metadata}', async () => {
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    await expect(silentPurchase(base)).resolves.toBe(true);
    const [call] = callsTo(ENDPOINT.ONE_CLICK);
    expect(bodyOf(call)).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: { source: 'jest' },
    });
  });

  test.each([
    ['succeeded', paymentBody({})],
    ['failed', paymentBody({ checkout_status: 'failed' })],
    [
      'processing + token',
      paymentBody({
        checkout_status: 'processing',
        action_required_token: ACTION_TOKEN,
      }),
    ],
  ])(
    'L2: returns true for %s, no Primer, no resume, no hooks',
    async (_name, body) => {
      const primer = installPrimer();
      const h = hooks();
      routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, body)] });
      await expect(
        silentPurchase({
          ...base,
          onThreeDSStart: h.onThreeDSStart,
          onThreeDSEnd: h.onThreeDSEnd,
        } as unknown as Parameters<typeof silentPurchase>[0])
      ).resolves.toBe(true);
      expect(primer.createHeadless).not.toHaveBeenCalled();
      expect(callsTo(ENDPOINT.RESUME)).toHaveLength(0);
      expect(callsTo(ENDPOINT.SESSION)).toHaveLength(0);
      expect(h.calls).toEqual([]);
    }
  );

  test('L3: returns false when the 2xx envelope is not success', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, { status: 'error', error: [{ code: 'x' }] }),
      ],
    });
    await expect(silentPurchase(base)).resolves.toBe(false);
  });

  test('L3b: a 2xx error envelope with double_purchase still rejects (unchanged)', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, {
          status: 'error',
          error: [{ msg: 'x', code: 'double_purchase' }],
        }),
      ],
    });
    await expect(silentPurchase(base)).rejects.toThrow(
      'This product was already purchased'
    );
  });

  test('L4: a 400 still rejects with APIError', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(400, {
          status: 'error',
          error: [{ msg: 'double', code: 'double_purchase' }],
        }),
      ],
    });
    jest.useFakeTimers();
    const promise = silentPurchase(base);
    const assertion = expect(promise).rejects.toBeInstanceOf(APIError);
    const unchanged = expect(promise).rejects.toMatchObject({
      statusCode: 400,
      errorCode: null,
      code: 'API_ERROR',
    });
    await jest.advanceTimersByTimeAsync(5000);
    await unchanged;
    await assertion;
  });

  test('L5: CIT fields are sent in snake_case only when set; [] preserved', async () => {
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await silentPurchase({
      ...base,
      initiationType: 'cit',
      citCardNetworks: [],
      citGooglePayPanOnly: false,
    });
    await silentPurchase({ ...base, initiationType: 'mit' });
    const [first, second] = callsTo(ENDPOINT.ONE_CLICK);
    expect(bodyOf(first)).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: { source: 'jest' },
      initiation_type: 'cit',
      cit_card_networks: [],
      cit_google_pay_pan_only: false,
    });
    expect(bodyOf(second)).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: { source: 'jest' },
      initiation_type: 'mit',
    });
  });

  test('L5b: CIT fields are passed through in detailed mode too', async () => {
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    await silentPurchase({
      ...base,
      handle3DS: true,
      initiationType: 'cit',
      citCardNetworks: ['VISA'],
      citGooglePayPanOnly: true,
    });
    expect(bodyOf(callsTo(ENDPOINT.ONE_CLICK)[0])).toEqual({
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: { source: 'jest' },
      initiation_type: 'cit',
      cit_card_networks: ['VISA'],
      cit_google_pay_pan_only: true,
    });
  });

  test('L6: initiationType "cit" without handle3DS warns once', async () => {
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await silentPurchase({ ...base, initiationType: 'cit' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('handle3DS');
    warn.mockClear();
    await silentPurchase({ ...base, initiationType: 'cit', handle3DS: true });
    expect(warn).not.toHaveBeenCalled();
  });

  test('S5: legacy network failure still retries 3 times and rejects with NetworkError', async () => {
    routeFetch({ [ENDPOINT.ONE_CLICK]: [new TypeError('Failed to fetch')] });
    jest.useFakeTimers();
    const promise = silentPurchase(base);
    const assertion = expect(promise).rejects.toBeInstanceOf(NetworkError);
    await jest.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Detailed mode: one case per row (AC5, AC8, AC16)
// ---------------------------------------------------------------------------

describe('detailed silentPurchase (handle3DS: true) — rows without 3DS', () => {
  test('row 1: succeeded', async () => {
    const h = hooks();
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'succeeded',
      orderId: 'order_1',
      threeDSChallenged: false,
    });
    expect(h.calls).toEqual([]);
    expect(callsTo(ENDPOINT.SESSION)).toHaveLength(0);
  });

  test('row 2: failed -> declined with decline fields', async () => {
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'failed',
            failed_message_for_user: 'Insufficient funds.',
            decline_code: 'INSUFFICIENT_FUNDS',
            decline_code_source: 'primer',
          })
        ),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'declined',
      orderId: 'order_1',
      threeDSChallenged: false,
      failedMessageForUser: 'Insufficient funds.',
      declineCode: 'INSUFFICIENT_FUNDS',
      declineCodeSource: 'primer',
    });
    expect(h.calls).toEqual([]);
  });

  test('row 3: cancelled -> error (APIError, no failedRequest)', async () => {
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, paymentBody({ checkout_status: 'cancelled' })),
      ],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('error');
    expect(result.orderId).toBe('order_1');
    expect(result.threeDSChallenged).toBe(false);
    expect(result.error).toBeInstanceOf(APIError);
    expect(result.error?.message).toBe('Payment was cancelled');
    expect(result.failedRequest).toBeUndefined();
    expect(h.calls).toEqual([]);
  });

  test('row 4: processing with empty token -> processing', async () => {
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, paymentBody({ checkout_status: 'processing' })),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'processing',
      orderId: 'order_1',
      threeDSChallenged: false,
    });
    expect(h.calls).toEqual([]);
  });

  test('row 14: 400 double_purchase -> already_purchased, one request', async () => {
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(400, {
          status: 'error',
          error: [{ msg: 'already', code: 'double_purchase', type: 'x' }],
        }),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'already_purchased',
      orderId: null,
      threeDSChallenged: false,
    });
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
    expect(h.calls).toEqual([]);
  });

  test('row 14b: 2xx error envelope with double_purchase -> already_purchased', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, {
          status: 'error',
          error: [{ msg: 'already', code: 'double_purchase' }],
        }),
      ],
    });
    const result = await silentPurchase({ ...base, handle3DS: true });
    expect(result.outcome).toBe('already_purchased');
  });

  test('2xx error envelope (no double_purchase) -> error, failedRequest one_click', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, {
          status: 'error',
          error: [{ msg: 'nope', code: 'x' }],
        }),
      ],
    });
    const result = await silentPurchase({ ...base, handle3DS: true });
    expect(result.outcome).toBe('error');
    expect(result.error).toBeInstanceOf(APIError);
    expect((result.error as APIError).errorCode).toBe('x');
    expect(result.failedRequest).toBe('one_click');
  });

  test('unknown checkout_status -> error', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(200, paymentBody({ checkout_status: 'weird' })),
      ],
    });
    const result = await silentPurchase({ ...base, handle3DS: true });
    expect(result.outcome).toBe('error');
    expect(result.error?.message).toContain('weird');
  });

  test.each([
    [
      '3DS guard 400',
      jsonResponse(400, { status: 'error', error: [{ msg: 'finish 3DS' }] }),
      400,
    ],
    [
      '429',
      jsonResponse(429, { status: 'error', error: [{ msg: 'limit' }] }),
      429,
    ],
    [
      '500',
      jsonResponse(500, { status: 'error', error: [{ msg: 'boom' }] }),
      500,
    ],
  ])(
    'row 15 / S2: one_click %s -> error after exactly one POST',
    async (_name, response, statusCode) => {
      const h = hooks();
      routeFetch({ [ENDPOINT.ONE_CLICK]: [response] });
      const result = await detailed(h);
      expect(result.outcome).toBe('error');
      expect(result.orderId).toBeNull();
      expect(result.threeDSChallenged).toBe(false);
      expect(result.error).toBeInstanceOf(APIError);
      expect((result.error as APIError).statusCode).toBe(statusCode);
      expect(result.failedRequest).toBe('one_click');
      expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
      expect(h.calls).toEqual([]);
    }
  );

  test('row 15 / S1: one_click network failure -> error after exactly one fetch', async () => {
    const h = hooks();
    routeFetch({ [ENDPOINT.ONE_CLICK]: [new TypeError('Failed to fetch')] });
    const result = await detailed(h);
    expect(result.outcome).toBe('error');
    expect(result.orderId).toBeNull();
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
    expect(h.calls).toEqual([]);
  });

  test('row 15: invalid JSON -> error (APIError)', async () => {
    const fetchMock = routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        {
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('bad')),
        } as Response,
      ],
    });
    const result = await silentPurchase({ ...base, handle3DS: true });
    expect(result.outcome).toBe('error');
    expect(result.error).toBeInstanceOf(APIError);
    expect((result.error as APIError).statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('row 16: in-flight guard -> error without a request', async () => {
    let release: (r: Response) => void = () => {};
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        () => new Promise<Response>(resolve => (release = resolve)),
      ],
    });
    const first = silentPurchase({ ...base, handle3DS: true });
    const h = hooks();
    const second = await detailed(h);
    expect(second.outcome).toBe('error');
    expect(second.orderId).toBeNull();
    expect(second.threeDSChallenged).toBe(false);
    expect(second.error).toBeInstanceOf(FunnefoxSDKError);
    expect((second.error as FunnefoxSDKError).code).toBe(
      'one_click_in_progress'
    );
    expect(second.failedRequest).toBeUndefined();
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
    expect(h.calls).toEqual([]);
    release(jsonResponse(200, paymentBody({})));
    await expect(first).resolves.toMatchObject({ outcome: 'succeeded' });
    // the guard is released afterwards
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    await expect(
      silentPurchase({ ...base, handle3DS: true })
    ).resolves.toMatchObject({ outcome: 'succeeded' });
  });

  test('another customer is not blocked by the in-flight guard', async () => {
    let release: (r: Response) => void = () => {};
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        () => new Promise<Response>(resolve => (release = resolve)),
        jsonResponse(200, paymentBody({})),
      ],
    });
    const first = silentPurchase({ ...base, handle3DS: true });
    const other = await silentPurchase({
      ...base,
      externalId: 'user_2',
      handle3DS: true,
    });
    expect(other.outcome).toBe('succeeded');
    release(jsonResponse(200, paymentBody({})));
    await first;
  });

  test.each(['orgId', 'baseUrl', 'priceId', 'externalId'])(
    'rejects with ValidationError when %s is empty',
    async field => {
      routeFetch({});
      await expect(
        silentPurchase({ ...base, [field]: '', handle3DS: true })
      ).rejects.toBeInstanceOf(ValidationError);
    }
  );
});

describe('detailed silentPurchase — 3DS rows', () => {
  test('row 5: challenge passed -> succeeded; hooks start/passed', async () => {
    const primer = installPrimer({ scenario: resumeWith('resume_ok') });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse('order_9')],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(200, paymentBody({ order_id: 'order_9' })),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'succeeded',
      orderId: 'order_9',
      threeDSChallenged: true,
    });
    expect(h.calls).toEqual(['start:order_9', 'end:passed']);
    expect(primer.continueWith).toEqual([ACTION_TOKEN]);
    expect(bodyOf(callsTo(ENDPOINT.RESUME)[0])).toEqual({
      order_id: 'order_9',
      resume_token: 'resume_ok',
    });
    expect(primer.resumeHandler.handleSuccess).toHaveBeenCalledTimes(1);
    // M1 session: customer-bound, no e-mail, same price point
    expect(bodyOf(callsTo(ENDPOINT.SESSION)[0])).toEqual({
      region: 'default',
      integration_type: 'primer',
      pp_ident: 'pp_upsell',
      external_id: 'user_1',
      client_metadata: {},
    });
  });

  test('H2: onThreeDSStart fires before create_client_session and the Primer headless', async () => {
    const order: string[] = [];
    const primer = installPrimer();
    const impl = primer.createHeadless.getMockImplementation()!;
    primer.createHeadless.mockImplementation((...args: unknown[]) => {
      order.push('createHeadless');
      return impl(...args);
    });
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [
        () => {
          order.push('create_client_session');
          return jsonResponse(200, SESSION_BODY);
        },
      ],
      [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
    });
    await silentPurchase({
      ...base,
      handle3DS: true,
      onThreeDSStart: () => order.push('start'),
    });
    expect(order).toEqual(['start', 'create_client_session', 'createHeadless']);
  });

  test('row 6: non-null list, code not in it -> declined, hook passed', async () => {
    jest.replaceProperty(constants, 'THREE_DS_AUTH_DECLINE_CODES', [
      'AUTHENTICATION_REQUIRED',
    ]);
    installPrimer();
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'failed',
            failed_message_for_user: 'Payment was declined.',
            decline_code: 'REFER_TO_CARD_ISSUER',
            decline_code_source: 'primer',
          })
        ),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'declined',
      orderId: 'order_1',
      threeDSChallenged: true,
      failedMessageForUser: 'Payment was declined.',
      declineCode: 'REFER_TO_CARD_ISSUER',
      declineCodeSource: 'primer',
    });
    expect(h.calls).toEqual(['start:order_1', 'end:passed']);
  });

  test('row 6b: non-null list, code in it -> 3ds_failed, hook failed', async () => {
    jest.replaceProperty(constants, 'THREE_DS_AUTH_DECLINE_CODES', [
      'AUTHENTICATION_REQUIRED',
    ]);
    installPrimer();
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'failed',
            decline_code: 'AUTHENTICATION_REQUIRED',
            decline_code_source: 'primer',
          })
        ),
      ],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('3ds_failed');
    expect(result.declineCode).toBe('AUTHENTICATION_REQUIRED');
    expect(h.calls).toEqual(['start:order_1', 'end:failed']);
  });

  test('row 6c: shipped list is null -> any decline after a challenge is 3ds_failed', async () => {
    expect(constants.THREE_DS_AUTH_DECLINE_CODES).toBeNull();
    const primer = installPrimer();
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'failed',
            failed_message_for_user: 'Payment was declined.',
            decline_code: 'REFER_TO_CARD_ISSUER',
            decline_code_source: 'primer',
          })
        ),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: '3ds_failed',
      orderId: 'order_1',
      threeDSChallenged: true,
      failedMessageForUser: 'Payment was declined.',
      declineCode: 'REFER_TO_CARD_ISSUER',
      declineCodeSource: 'primer',
    });
    expect(h.calls).toEqual(['start:order_1', 'end:failed']);
    expect(primer.resumeHandler.handleFailure).toHaveBeenCalledTimes(1);
  });

  test('row 7: resume processing -> processing, hook passed', async () => {
    installPrimer();
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(200, paymentBody({ checkout_status: 'processing' })),
      ],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: 'processing',
      orderId: 'order_1',
      threeDSChallenged: true,
    });
    expect(h.calls).toEqual(['start:order_1', 'end:passed']);
  });

  test('row 8 / H4: chained token -> error, no second challenge or hook pair', async () => {
    const primer = installPrimer();
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'processing',
            action_required_token: primerToken('3DS_AUTHENTICATION'),
          })
        ),
      ],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('error');
    expect(result.threeDSChallenged).toBe(true);
    expect(result.error).toBeInstanceOf(FunnefoxSDKError);
    expect(result.failedRequest).toBeUndefined();
    expect(h.calls).toEqual(['start:order_1', 'end:error']);
    expect(primer.continueWith).toEqual([ACTION_TOKEN]);
    expect(primer.resumeHandler.handleFailure).toHaveBeenCalledTimes(1);
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(1);
  });

  test('row 9: Primer resume error (not a close) -> 3ds_failed, no resume call', async () => {
    const authError = Object.assign(new Error('3DS failed'), {
      code: 'THREE_DS_AUTH_FAILED',
      stack: 'x',
    });
    installPrimer({ scenario: resumeErrorWith(authError) });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('3ds_failed');
    expect(result.threeDSChallenged).toBe(true);
    expect(result.error).toBeInstanceOf(PrimerError);
    expect((result.error as PrimerError).primerError).toBe(authError);
    expect(result.failedRequest).toBeUndefined();
    expect(h.calls).toEqual(['start:order_1', 'end:failed']);
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(0);
  });

  test('row 9b: onCheckoutFail after the challenge started -> 3ds_failed', async () => {
    installPrimer({
      scenario: (cb, log) =>
        cb.onTokenizeSuccess(
          {},
          {
            ...log.tokenizeHandler,
            continueWithNewClientToken: () =>
              setTimeout(() => cb.onCheckoutFail(new Error('fail')), 0),
          }
        ),
    });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('3ds_failed');
    expect(h.calls).toEqual(['start:order_1', 'end:failed']);
  });

  test('row 10: user closes the challenge -> 3ds_abandoned', async () => {
    installPrimer({ scenario: resumeErrorWith(CLOSE_ERROR) });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
    });
    const result = await detailed(h);
    expect(result).toEqual({
      outcome: '3ds_abandoned',
      orderId: 'order_1',
      threeDSChallenged: true,
    });
    expect(h.calls).toEqual(['start:order_1', 'end:abandoned']);
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(0);
  });

  test('row 10b: threeDSTimeoutMs -> 3ds_abandoned', async () => {
    installPrimer({ scenario: challengeNeverEnds });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
    });
    jest.useFakeTimers();
    const promise = detailed(h, { threeDSTimeoutMs: 5000 });
    await jest.advanceTimersByTimeAsync(5001);
    await expect(promise).resolves.toEqual({
      outcome: '3ds_abandoned',
      orderId: 'order_1',
      threeDSChallenged: true,
    });
    expect(h.calls).toEqual(['start:order_1', 'end:abandoned']);
  });

  test('row 11: non-Primer token -> error, Primer never touched, hooks start/error', async () => {
    const primer = installPrimer();
    const load = jest.spyOn(PrimerWrapper.prototype, 'ensurePrimerLoaded');
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'processing',
            action_required_token: 'pi_123_secret_456',
          })
        ),
      ],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('error');
    expect(result.threeDSChallenged).toBe(true);
    expect(result.orderId).toBe('order_1');
    expect(result.error).toBeInstanceOf(PrimerError);
    expect(result.failedRequest).toBeUndefined();
    expect(h.calls).toEqual(['start:order_1', 'end:error']);
    expect(load).not.toHaveBeenCalled();
    expect(primer.createHeadless).not.toHaveBeenCalled();
    expect(callsTo(ENDPOINT.SESSION)).toHaveLength(0);
  });

  test('row 12a: create_client_session 500 (after retries) -> error, original APIError', async () => {
    installPrimer();
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [
        jsonResponse(500, { status: 'error', error: [{ msg: 'boom' }] }),
      ],
    });
    jest.useFakeTimers();
    const promise = detailed(h);
    await jest.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result.outcome).toBe('error');
    expect(result.threeDSChallenged).toBe(true);
    expect(result.error).toBeInstanceOf(APIError);
    expect((result.error as APIError).statusCode).toBe(500);
    expect(result.failedRequest).toBe('create_client_session');
    expect(callsTo(ENDPOINT.SESSION)).toHaveLength(3);
    expect(h.calls).toEqual(['start:order_1', 'end:error']);
  });

  test('row 12b: Primer createHeadless rejects -> error, PrimerError, no failedRequest', async () => {
    installPrimer({ createHeadlessError: new Error('primer down') });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('error');
    expect(result.error).toBeInstanceOf(PrimerError);
    expect(result.failedRequest).toBeUndefined();
    expect(h.calls).toEqual(['start:order_1', 'end:error']);
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(0);
  });

  test('row 12b: empty vault -> error, PrimerError', async () => {
    installPrimer({ methods: [] });
    const h = hooks();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
    });
    const result = await detailed(h);
    expect(result.outcome).toBe('error');
    expect(result.error).toBeInstanceOf(PrimerError);
    expect(result.error?.message).toContain('No saved payment method');
    expect(h.calls).toEqual(['start:order_1', 'end:error']);
  });

  test.each([
    ['5xx', jsonResponse(502, { status: 'error', error: [{ msg: 'bad gw' }] })],
    ['network', new TypeError('Failed to fetch')],
  ])(
    'row 13 / S3: resume_payment %s -> error after exactly one resume POST',
    async (_name, response) => {
      installPrimer();
      const h = hooks();
      routeFetch({
        [ENDPOINT.ONE_CLICK]: [actionResponse()],
        [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
        [ENDPOINT.RESUME]: [response],
      });
      const result = await detailed(h);
      expect(result.outcome).toBe('error');
      expect(result.threeDSChallenged).toBe(true);
      expect(result.failedRequest).toBe('resume_payment');
      expect(callsTo(ENDPOINT.RESUME)).toHaveLength(1);
      expect(h.calls).toEqual(['start:order_1', 'end:error']);
    }
  );

  test('resume 2xx error envelope -> error, failedRequest resume_payment', async () => {
    installPrimer();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(200, {
          status: 'error',
          error: [{ msg: 'x', code: 'y' }],
        }),
      ],
    });
    const result = await silentPurchase({ ...base, handle3DS: true });
    expect(result.outcome).toBe('error');
    expect(result.failedRequest).toBe('resume_payment');
  });

  test.each(['cancelled', 'weird'])(
    'resume checkout_status %s -> error',
    async status => {
      installPrimer();
      routeFetch({
        [ENDPOINT.ONE_CLICK]: [actionResponse()],
        [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
        [ENDPOINT.RESUME]: [
          jsonResponse(200, paymentBody({ checkout_status: status })),
        ],
      });
      const result = await silentPurchase({ ...base, handle3DS: true });
      expect(result.outcome).toBe('error');
      expect(result.threeDSChallenged).toBe(true);
    }
  );
});

// ---------------------------------------------------------------------------
// Hooks (AC8)
// ---------------------------------------------------------------------------

describe('hooks', () => {
  test('H5: throwing hooks change nothing; onThreeDSEnd still fires once', async () => {
    installPrimer();
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onThreeDSEnd = jest.fn(() => {
      throw new Error('end hook');
    });
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
    });
    const result = await silentPurchase({
      ...base,
      handle3DS: true,
      onThreeDSStart: () => {
        throw new Error('start hook');
      },
      onThreeDSEnd,
    });
    expect(result.outcome).toBe('succeeded');
    expect(onThreeDSEnd).toHaveBeenCalledTimes(1);
    expect(onThreeDSEnd).toHaveBeenCalledWith({ result: 'passed' });
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  test('H6: an unexpected exception in the 3DS step resolves error with one end(error)', async () => {
    const runner = jest
      .spyOn(threeDS, 'runOneClickThreeDS')
      .mockRejectedValue(new Error('unexpected'));
    const h = hooks();
    routeFetch({ [ENDPOINT.ONE_CLICK]: [actionResponse()] });
    const result = await detailed(h);
    expect(runner).toHaveBeenCalled();
    expect(result.outcome).toBe('error');
    expect(result.error?.message).toBe('unexpected');
    expect(h.calls).toEqual(['start:order_1', 'end:error']);
  });

  test('H6b: a non-Error rejection is wrapped', async () => {
    jest.spyOn(threeDS, 'runOneClickThreeDS').mockRejectedValue('weird');
    routeFetch({ [ENDPOINT.ONE_CLICK]: [actionResponse()] });
    const result = await silentPurchase({ ...base, handle3DS: true });
    expect(result.outcome).toBe('error');
    expect(result.error).toBeInstanceOf(FunnefoxSDKError);
  });

  test('H5b: hooks are optional', async () => {
    installPrimer();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
    });
    await expect(
      silentPurchase({ ...base, handle3DS: true })
    ).resolves.toMatchObject({ outcome: 'succeeded', threeDSChallenged: true });
  });
});

// ---------------------------------------------------------------------------
// Single POST (AC15) and error passthrough (AC16)
// ---------------------------------------------------------------------------

describe('single POST and error passthrough', () => {
  test('S4: no client timeout on one_click; threeDSTimeoutMs does not abort it', async () => {
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [() => new Promise<Response>(() => {})],
    });
    jest.useFakeTimers();
    let settled = false;
    void silentPurchase({
      ...base,
      externalId: 'user_s4',
      handle3DS: true,
      threeDSTimeoutMs: 1000,
    }).then(() => (settled = true));
    await jest.advanceTimersByTimeAsync(120000);
    expect(settled).toBe(false);
    expect(callsTo(ENDPOINT.ONE_CLICK)).toHaveLength(1);
  });

  test('S4b: no client timeout on resume_payment; the 3DS timer is cleared first', async () => {
    installPrimer();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [() => new Promise<Response>(() => {})],
    });
    jest.useFakeTimers();
    const h = hooks();
    let settled = false;
    void detailed(h, { threeDSTimeoutMs: 1000, externalId: 'user_s4b' }).then(
      () => (settled = true)
    );
    await jest.advanceTimersByTimeAsync(120000);
    expect(settled).toBe(false);
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(1);
    expect(h.calls).toEqual(['start:order_1']);
  });

  test('S6: requestOnce sends the same URL and headers as request()', async () => {
    routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, paymentBody({}))] });
    await silentPurchase(base);
    await silentPurchase({ ...base, handle3DS: true });
    const [legacy, once] = callsTo(ENDPOINT.ONE_CLICK);
    expect(once[0]).toBe(legacy[0]);
    expect(once[0]).toBe(`${BASE_URL}/${ORG_ID}${ENDPOINT.ONE_CLICK}`);
    expect((once[1] as RequestInit).headers).toEqual(
      (legacy[1] as RequestInit).headers
    );
    expect((once[1] as RequestInit).method).toBe('POST');
  });

  describe('S7: result.error is the original instance; failedRequest names the call', () => {
    test('one_click 503 -> APIError(503), same instance, failedRequest one_click', async () => {
      const body = { status: 'error', error: [{ msg: 'down', code: 'svc' }] };
      routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(503, body)] });
      const spy = jest.spyOn(APIClient.prototype, 'oneClickOnce');
      const result = await silentPurchase({ ...base, handle3DS: true });
      const thrown = await spy.mock.results[0].value.catch((e: unknown) => e);
      expect(result.error).toBe(thrown);
      expect(result.error).toBeInstanceOf(APIError);
      expect((result.error as APIError).statusCode).toBe(503);
      // requestOnce fills errorCode from the body on the same instance (_makeRequest leaves it
      // empty; legacy request() is unchanged).
      expect((result.error as APIError).errorCode).toBe('svc');
      expect((result.error as APIError).code).toBe('API_ERROR');
      expect((result.error as APIError).response).toEqual(body);
      expect(result.error?.name).toBe('APIError');
      expect(result.failedRequest).toBe('one_click');
    });

    test('one_click fetch rejects -> NetworkError with originalError, failedRequest one_click', async () => {
      const rejection = new TypeError('Failed to fetch');
      routeFetch({ [ENDPOINT.ONE_CLICK]: [rejection] });
      const spy = jest.spyOn(APIClient.prototype, 'oneClickOnce');
      const result = await silentPurchase({ ...base, handle3DS: true });
      expect(result.error).toBe(
        await spy.mock.results[0].value.catch((e: unknown) => e)
      );
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.name).toBe('NetworkError');
      expect((result.error as NetworkError).originalError).toBe(rejection);
      expect(result.failedRequest).toBe('one_click');
    });

    test('resume_payment 502 -> APIError(502), failedRequest resume_payment', async () => {
      installPrimer();
      routeFetch({
        [ENDPOINT.ONE_CLICK]: [actionResponse()],
        [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
        [ENDPOINT.RESUME]: [
          jsonResponse(502, { status: 'error', error: [{ msg: 'gw' }] }),
        ],
      });
      const spy = jest.spyOn(APIClient.prototype, 'resumePaymentOnce');
      const result = await silentPurchase({ ...base, handle3DS: true });
      expect(result.error).toBe(
        await spy.mock.results[0].value.catch((e: unknown) => e)
      );
      expect((result.error as APIError).statusCode).toBe(502);
      expect(result.failedRequest).toBe('resume_payment');
      expect(result.threeDSChallenged).toBe(true);
    });

    test('resume_payment network failure -> NetworkError, failedRequest resume_payment', async () => {
      installPrimer();
      const rejection = new TypeError('Failed to fetch');
      routeFetch({
        [ENDPOINT.ONE_CLICK]: [actionResponse()],
        [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
        [ENDPOINT.RESUME]: [rejection],
      });
      const result = await silentPurchase({ ...base, handle3DS: true });
      expect(result.error).toBeInstanceOf(NetworkError);
      expect((result.error as NetworkError).originalError).toBe(rejection);
      expect(result.failedRequest).toBe('resume_payment');
    });

    test('create_client_session 500 -> APIError(500), same instance, failedRequest create_client_session', async () => {
      installPrimer();
      routeFetch({
        [ENDPOINT.ONE_CLICK]: [actionResponse()],
        [ENDPOINT.SESSION]: [
          jsonResponse(500, { status: 'error', error: [{ msg: 'boom' }] }),
        ],
      });
      const spy = jest.spyOn(APIClient.prototype, 'createClientSession');
      jest.useFakeTimers();
      const promise = silentPurchase({ ...base, handle3DS: true });
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;
      expect(result.error).toBe(
        await spy.mock.results[0].value.catch((e: unknown) => e)
      );
      expect((result.error as APIError).statusCode).toBe(500);
      expect(result.failedRequest).toBe('create_client_session');
    });

    test('row 12b, row 16 and row 3 have no failedRequest', async () => {
      installPrimer({ createHeadlessError: new Error('x') });
      routeFetch({
        [ENDPOINT.ONE_CLICK]: [actionResponse()],
        [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      });
      const r12b = await silentPurchase({ ...base, handle3DS: true });
      expect(r12b.error).toBeInstanceOf(PrimerError);
      expect(r12b).not.toHaveProperty('failedRequest');

      routeFetch({
        [ENDPOINT.ONE_CLICK]: [
          jsonResponse(200, paymentBody({ checkout_status: 'cancelled' })),
        ],
      });
      const r3 = await silentPurchase({ ...base, handle3DS: true });
      expect(r3.outcome).toBe('error');
      expect(r3).not.toHaveProperty('failedRequest');
    });

    test.each([
      ['succeeded', paymentBody({})],
      ['declined', paymentBody({ checkout_status: 'failed' })],
      ['processing', paymentBody({ checkout_status: 'processing' })],
    ])('non-error outcome %s has no failedRequest', async (_n, body) => {
      routeFetch({ [ENDPOINT.ONE_CLICK]: [jsonResponse(200, body)] });
      const result: OneClickResult = await silentPurchase({
        ...base,
        handle3DS: true,
      });
      expect(result).not.toHaveProperty('failedRequest');
      expect(result).not.toHaveProperty('error');
    });
  });
});

// ---------------------------------------------------------------------------
// Isolation (P6, E1)
// ---------------------------------------------------------------------------

describe('isolation', () => {
  test('P6: the HeadlessManager cache is not used by the one-click 3DS path', async () => {
    const getOrCreate = jest.spyOn(HeadlessManager.prototype, 'getOrCreate');
    installPrimer();
    routeFetch({
      [ENDPOINT.ONE_CLICK]: [actionResponse()],
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
    });
    await silentPurchase({ ...base, handle3DS: true });
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  test('E1: no new runtime exports on Billing or the entry point', () => {
    expect(Object.keys(Billing).sort()).toEqual(
      [
        'configure',
        'createCheckout',
        'createClientSession',
        'initMethod',
        'silentPurchase',
        'getAvailablePaymentMethods',
        'stripe',
      ].sort()
    );
    expect(Object.keys(Billing.stripe).sort()).toEqual(
      [
        'createCardForm',
        'purchaseWallet',
        'getAvailableWallet',
        'getAvailablePaymentMethods',
      ].sort()
    );
    expect(Object.keys(entry).sort()).toEqual(
      [
        'APIError',
        'Billing',
        'CHECKOUT_STATES',
        'CheckoutError',
        'ConfigurationError',
        'DEFAULTS',
        'ERROR_CODES',
        'EVENTS',
        'FunnefoxSDKError',
        'NetworkError',
        'PaymentMethod',
        'PrimerError',
        'SDK_VERSION',
        'ValidationError',
        'configure',
        'createCheckout',
        'createClientSession',
        'default',
        'getAvailablePaymentMethods',
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Types (AC4): checked by `tsc -p tsconfig.jest.json` (see build-summary)
// ---------------------------------------------------------------------------

type DeclaredSilentPurchase = typeof import('../src/types').silentPurchase;

export function overloadTypeChecks(declared: DeclaredSilentPurchase) {
  for (const fn of [declared, silentPurchase]) {
    const legacy: Promise<boolean> = fn(base);
    const legacyExplicit: Promise<boolean> = fn({ ...base, handle3DS: false });
    const detailedResult: Promise<OneClickResult> = fn({
      ...base,
      handle3DS: true,
      onThreeDSStart: ({ orderId }) => orderId.length,
      onThreeDSEnd: ({ result }) => {
        const r: ThreeDSResult = result;
        return r;
      },
    });
    // @ts-expect-error detailed mode does not resolve a boolean
    const wrong: Promise<boolean> = fn({ ...base, handle3DS: true });
    // @ts-expect-error hooks exist only in detailed mode
    fn({ ...base, onThreeDSStart: () => {} });
    void [legacy, legacyExplicit, detailedResult, wrong];
  }
}

test('type-level overload checks compile', () => {
  expect(typeof overloadTypeChecks).toBe('function');
});
