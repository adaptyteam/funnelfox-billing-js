/**
 * @jest-environment jsdom
 *
 * FFB-704: the internal one-click 3DS runner (mechanism M1) against a mocked Primer.
 */

import APIClient from '../src/api-client';

jest.mock('../src/one-click-3ds', () => ({
  ...jest.requireActual('../src/one-click-3ds'),
  THREE_DS_OVERLAY_REVEAL_DELAY_MS: 20,
}));

import PrimerWrapper from '../src/primer-wrapper';
import { NetworkError, PrimerError } from '../src/errors';
import {
  DEFAULT_THREE_DS_TIMEOUT_MS,
  getPrimerTokenIntent,
  isThreeDSCloseError,
  pickVaultedMethod,
  runOneClickThreeDS,
} from '../src/one-click-3ds';
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

const apiClient = () =>
  new APIClient({ baseUrl: BASE_URL, orgId: ORG_ID, retryAttempts: 1 });

const params = (extra: Record<string, unknown> = {}) => ({
  apiClient: apiClient(),
  region: 'default',
  priceId: 'pp_upsell',
  externalId: 'user_1',
  orderId: 'order_1',
  actionToken: ACTION_TOKEN,
  timeoutMs: DEFAULT_THREE_DS_TIMEOUT_MS,
  revealDelayMs: 20,
  onChallengeShown: () => {},
  ...extra,
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('helpers', () => {
  test('getPrimerTokenIntent decodes Primer JWT intents', () => {
    expect(getPrimerTokenIntent(primerToken('PROCESSOR_3DS'))).toBe(
      'PROCESSOR_3DS'
    );
    expect(getPrimerTokenIntent(primerToken('3DS_AUTHENTICATION'))).toBe(
      '3DS_AUTHENTICATION'
    );
    expect(getPrimerTokenIntent('pi_1_secret_2')).toBeNull();
    expect(getPrimerTokenIntent('a.b.c')).toBeNull();
    expect(getPrimerTokenIntent(`x.${btoa('{"foo":1}')}.y`)).toBeNull();
  });

  test('isThreeDSCloseError matches only the 3DS close error', () => {
    expect(isThreeDSCloseError(CLOSE_ERROR)).toBe(true);
    expect(
      isThreeDSCloseError({ ...CLOSE_ERROR, code: 'OTHER' } as never)
    ).toBe(false);
    expect(
      isThreeDSCloseError({ code: 'RESUME_ERROR', message: 'x', stack: '' })
    ).toBe(false);
    expect(isThreeDSCloseError(null)).toBe(false);
  });

  test('P7: pickVaultedMethod takes the first card, else the first item', () => {
    const paypal = {
      id: 'pp',
      paymentInstrumentType: 'PAYPAL_BILLING_AGREEMENT',
    };
    const card1 = { id: 'c1', paymentInstrumentType: 'PAYMENT_CARD' };
    const card2 = { id: 'c2', paymentInstrumentType: 'PAYMENT_CARD' };
    expect(pickVaultedMethod([paypal, card1, card2] as never)?.id).toBe('c1');
    expect(pickVaultedMethod([card2, card1] as never)?.id).toBe('c2');
    expect(pickVaultedMethod([paypal] as never)?.id).toBe('pp');
    expect(pickVaultedMethod([])).toBeNull();
    expect(pickVaultedMethod(undefined)).toBeNull();
  });
});

describe('runOneClickThreeDS', () => {
  test('P1/P2: continues with the action token, resumes with {order_id, resume_token}', async () => {
    const primer = installPrimer({ scenario: resumeWith('resume_9') });
    routeFetch({
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
    });
    const run = await runOneClickThreeDS(params());
    expect(run.kind).toBe('resumed');
    expect(primer.continueWith).toEqual([ACTION_TOKEN]);
    expect(primer.createHeadless).toHaveBeenCalledWith(
      'checkout-client-token',
      expect.objectContaining({ paymentHandling: 'MANUAL' })
    );
    expect(primer.startPaymentFlow).toHaveBeenCalledWith('pm_card');
    expect(bodyOf(callsTo(ENDPOINT.RESUME)[0])).toEqual({
      order_id: 'order_1',
      resume_token: 'resume_9',
    });
  });

  test('P3: the close error -> abandoned, no resume call', async () => {
    installPrimer({ scenario: resumeErrorWith(CLOSE_ERROR) });
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    await expect(runOneClickThreeDS(params())).resolves.toEqual({
      kind: 'abandoned',
    });
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(0);
  });

  test('P4: timeout -> abandoned and Primer overlay dismissed', async () => {
    installPrimer({ scenario: challengeNeverEnds });
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    const close = document.createElement('button');
    close.setAttribute('data-testid', 'OverlayContent.closeButton');
    const clicked = jest.fn();
    close.addEventListener('click', clicked);
    document.body.appendChild(close);

    jest.useFakeTimers();
    const promise = runOneClickThreeDS(params({ timeoutMs: 3000 }));
    await jest.advanceTimersByTimeAsync(3019);
    expect(clicked).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    await expect(promise).resolves.toEqual({ kind: 'abandoned' });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test('P4b: an invalid timeout falls back to the default', async () => {
    installPrimer({ scenario: challengeNeverEnds });
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    jest.useFakeTimers();
    let settled = false;
    void runOneClickThreeDS(params({ timeoutMs: -1 })).then(
      () => (settled = true)
    );
    await jest.advanceTimersByTimeAsync(DEFAULT_THREE_DS_TIMEOUT_MS + 10);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(20);
    expect(settled).toBe(true);
  });

  test('P5: settles exactly once when several callbacks fire', async () => {
    const primer = installPrimer({
      scenario: (cb, log) => {
        cb.onTokenizeSuccess(
          {},
          {
            ...log.tokenizeHandler,
            continueWithNewClientToken: (t: string) => {
              log.continueWith.push(t);
              setTimeout(() => {
                cb.onResumeError(CLOSE_ERROR);
                cb.onCheckoutFail(new Error('late'));
                void cb.onResumeSuccess(
                  { resumeToken: 'late' },
                  log.resumeHandler
                );
                cb.onTokenizeSuccess({}, log.tokenizeHandler);
              }, 0);
            },
          }
        );
      },
    });
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    await expect(runOneClickThreeDS(params())).resolves.toEqual({
      kind: 'abandoned',
    });
    await new Promise(r => setTimeout(r, 5));
    expect(callsTo(ENDPOINT.RESUME)).toHaveLength(0);
    expect(primer.resumeHandler.handleFailure).toHaveBeenCalled();
    expect(primer.tokenizeHandler.handleFailure).toHaveBeenCalled();
    expect(primer.continueWith).toEqual([ACTION_TOKEN]);
  });

  test('onCheckoutFail before tokenization -> error', async () => {
    installPrimer({
      scenario: cb => cb.onCheckoutFail(new Error('early')),
    });
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    const run = await runOneClickThreeDS(params());
    expect(run.kind).toBe('error');
    expect(run.kind === 'error' && run.error).toBeInstanceOf(PrimerError);
  });

  test('onTokenizeError -> error', async () => {
    installPrimer({
      scenario: cb => cb.onTokenizeError?.(new Error('tok')),
    });
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    const run = await runOneClickThreeDS(params());
    expect(run).toMatchObject({ kind: 'error' });
  });

  test('a Primer load failure -> error, no session created', async () => {
    jest
      .spyOn(PrimerWrapper.prototype, 'ensurePrimerLoaded')
      .mockRejectedValue(new PrimerError('Failed to load Primer SDK'));
    routeFetch({});
    const run = await runOneClickThreeDS(params());
    expect(run.kind).toBe('error');
    expect(run.kind === 'error' && run.error.message).toBe(
      'Failed to load Primer SDK'
    );
    expect(callsTo(ENDPOINT.SESSION)).toHaveLength(0);
  });

  test('a session error envelope (2xx) -> error with failedRequest create_client_session', async () => {
    installPrimer();
    routeFetch({
      [ENDPOINT.SESSION]: [
        jsonResponse(200, {
          status: 'error',
          error: [{ msg: 'no', code: 'x' }],
        }),
      ],
    });
    const run = await runOneClickThreeDS(params());
    expect(run).toMatchObject({
      kind: 'error',
      failedRequest: 'create_client_session',
    });
  });

  describe('overlay reveal (FFB-758)', () => {
    const overlayHidden = () =>
      Array.from(document.head.querySelectorAll('style')).some(style =>
        style.textContent?.includes('#primer-overlay')
      );

    test('the overlay is hidden until revealDelayMs, then shown once', async () => {
      installPrimer({ scenario: challengeNeverEnds });
      routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
      const onChallengeShown = jest.fn();
      jest.useFakeTimers();
      void runOneClickThreeDS(
        params({ revealDelayMs: 6000, onChallengeShown, timeoutMs: 60000 })
      );
      await jest.advanceTimersByTimeAsync(5999);
      expect(overlayHidden()).toBe(true);
      expect(onChallengeShown).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(overlayHidden()).toBe(false);
      expect(onChallengeShown).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60000);
      expect(onChallengeShown).toHaveBeenCalledTimes(1);
    });

    test('a repeated tokenization is refused, so the challenge is reported once', async () => {
      const primer = installPrimer({
        scenario: (cb, log) => {
          const handler = {
            ...log.tokenizeHandler,
            continueWithNewClientToken: (t: string) => log.continueWith.push(t),
          };
          cb.onTokenizeSuccess({ token: 'vaulted_tok' }, handler);
          cb.onTokenizeSuccess({ token: 'vaulted_tok' }, handler);
        },
      });
      routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
      const onChallengeShown = jest.fn();
      jest.useFakeTimers();
      void runOneClickThreeDS(
        params({ revealDelayMs: 6000, onChallengeShown, timeoutMs: 60000 })
      );
      await jest.advanceTimersByTimeAsync(7000);
      expect(onChallengeShown).toHaveBeenCalledTimes(1);
      expect(primer.continueWith).toEqual([ACTION_TOKEN]);
      expect(primer.tokenizeHandler.handleFailure).toHaveBeenCalledTimes(1);
    });

    test('a resume before revealDelayMs never shows the overlay', async () => {
      installPrimer({ scenario: resumeWith('resume_1', 0) });
      routeFetch({
        [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
        [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
      });
      const onChallengeShown = jest.fn();
      jest.useFakeTimers();
      const promise = runOneClickThreeDS(
        params({ revealDelayMs: 6000, onChallengeShown })
      );
      await jest.advanceTimersByTimeAsync(10000);
      await expect(promise).resolves.toMatchObject({ kind: 'resumed' });
      expect(onChallengeShown).not.toHaveBeenCalled();
      expect(overlayHidden()).toBe(false);
    });

    test('a timeout shorter than the reveal still shows the challenge, then abandons it', async () => {
      installPrimer({ scenario: challengeNeverEnds });
      routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
      const close = document.createElement('button');
      close.setAttribute('data-testid', 'OverlayContent.closeButton');
      const clicked = jest.fn();
      close.addEventListener('click', clicked);
      document.body.appendChild(close);
      const onChallengeShown = jest.fn();
      jest.useFakeTimers();
      let settled = false;
      const promise = runOneClickThreeDS(
        params({ revealDelayMs: 6000, timeoutMs: 3000, onChallengeShown })
      ).then(run => {
        settled = true;
        return run;
      });
      await jest.advanceTimersByTimeAsync(5999);
      expect(settled).toBe(false);
      expect(onChallengeShown).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(onChallengeShown).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(2999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const run = await promise;
      expect(run.kind).toBe('abandoned');
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(overlayHidden()).toBe(false);
    });

    test('warns when the overlay is not in the page at the reveal', async () => {
      installPrimer({ scenario: challengeNeverEnds });
      routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.useFakeTimers();
      void runOneClickThreeDS(
        params({ revealDelayMs: 6000, timeoutMs: 60000 })
      );
      await jest.advanceTimersByTimeAsync(6000);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('#primer-overlay')
      );
      warn.mockRestore();
    });
  });

  test('a successful resume calls handleSuccess; a decline calls handleFailure with the message', async () => {
    const ok = installPrimer();
    routeFetch({
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [jsonResponse(200, paymentBody({}))],
    });
    await runOneClickThreeDS(params());
    expect(ok.resumeHandler.handleSuccess).toHaveBeenCalledTimes(1);

    const declined = installPrimer();
    routeFetch({
      [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)],
      [ENDPOINT.RESUME]: [
        jsonResponse(
          200,
          paymentBody({
            checkout_status: 'failed',
            failed_message_for_user: 'Declined.',
          })
        ),
      ],
    });
    await runOneClickThreeDS(params());
    expect(declined.resumeHandler.handleFailure).toHaveBeenCalledWith(
      'Declined.'
    );
  });

  test('the timeout settles even while create_client_session hangs', async () => {
    installPrimer();
    routeFetch({
      [ENDPOINT.SESSION]: [() => new Promise<Response>(() => {})],
    });
    jest.useFakeTimers();
    const promise = runOneClickThreeDS(
      params({
        timeoutMs: 1000,
        apiClient: new APIClient({
          baseUrl: BASE_URL,
          orgId: ORG_ID,
          retryAttempts: 1,
          timeout: 600000,
        }),
      })
    );
    await jest.advanceTimersByTimeAsync(1001);
    const run = await promise;
    // No challenge was shown: a setup timeout is an error, not an abandoned challenge.
    expect(run).toMatchObject({
      kind: 'error',
      failedRequest: 'create_client_session',
    });
    expect(run.kind === 'error' && run.error).toBeInstanceOf(NetworkError);
    expect(callsTo(ENDPOINT.SESSION)).toHaveLength(1);
  });

  test('a timeout while Primer starts (before the challenge) -> error, PrimerError, no failedRequest', async () => {
    const primer = installPrimer();
    primer.createHeadless.mockImplementation(() => new Promise(() => {}));
    routeFetch({ [ENDPOINT.SESSION]: [jsonResponse(200, SESSION_BODY)] });
    const close = document.createElement('button');
    close.setAttribute('data-testid', 'OverlayContent.closeButton');
    const clicked = jest.fn();
    close.addEventListener('click', clicked);
    document.body.appendChild(close);
    jest.useFakeTimers();
    const promise = runOneClickThreeDS(params({ timeoutMs: 1000 }));
    await jest.advanceTimersByTimeAsync(1001);
    const run = await promise;
    expect(run.kind).toBe('error');
    expect(run.kind === 'error' && run.error).toBeInstanceOf(PrimerError);
    expect(run).not.toHaveProperty('failedRequest');
    expect(clicked).not.toHaveBeenCalled();
  });

  test('a late session response after a setup timeout is ignored', async () => {
    const primer = installPrimer();
    let release: (r: Response) => void = () => {};
    routeFetch({
      [ENDPOINT.SESSION]: [
        () => new Promise<Response>(resolve => (release = resolve)),
      ],
    });
    jest.useFakeTimers();
    const promise = runOneClickThreeDS(params({ timeoutMs: 1000 }));
    await jest.advanceTimersByTimeAsync(1001);
    await expect(promise).resolves.toMatchObject({
      kind: 'error',
      failedRequest: 'create_client_session',
    });
    release(jsonResponse(200, SESSION_BODY));
    await jest.advanceTimersByTimeAsync(10);
    expect(primer.createHeadless).not.toHaveBeenCalled();
  });
});
