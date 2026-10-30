/**
 * Test helpers for silentPurchase / one-click 3DS (FFB-704).
 */

import { THREE_DS_OVERLAY_REVEAL_DELAY_MS } from '../../src/one-click-3ds';

type Json = Record<string, unknown>;

/** A challenge answered after the overlay became visible. */
export const CHALLENGE_ANSWER_MS = THREE_DS_OVERLAY_REVEAL_DELAY_MS + 100;

export const BASE_URL = 'https://api.example.com';
export const ORG_ID = 'org_1';

export function primerToken(intent: string): string {
  const b64 = (o: Json) =>
    btoa(JSON.stringify(o))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ intent, exp: 1 })}.sig`;
}

export const ACTION_TOKEN = primerToken('PROCESSOR_3DS');

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

export function paymentBody(data: Json): Json {
  return {
    status: 'success',
    data: {
      action_required_token: '',
      checkout_status: 'succeeded',
      failed_message_for_user: '',
      decline_code: null,
      decline_code_source: null,
      order_id: 'order_1',
      ...data,
    },
  };
}

export const SESSION_BODY = {
  status: 'success',
  data: { client_token: 'checkout-client-token', order_id: 'session_order' },
};

export type Route =
  | Response
  | Error
  | (() => Response | Promise<Response> | Error);

/**
 * Routes `fetch` by endpoint suffix. Each endpoint has a queue of responses; a thrown Error
 * value makes fetch reject. Unrouted calls fail the test.
 */
export function routeFetch(routes: Record<string, Route[]>) {
  const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const href = String(url);
    const key = Object.keys(routes).find(k => href.endsWith(k));
    if (!key || routes[key].length === 0) {
      throw new Error(`unexpected fetch ${href}`);
    }
    const next = routes[key].length > 1 ? routes[key].shift() : routes[key][0];
    const value = typeof next === 'function' ? await next() : next;
    if (value instanceof Error) {
      throw value;
    }
    return value as Response;
  });
  return fetchMock;
}

export function callsTo(endpoint: string) {
  const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(endpoint));
}

export function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

export const ENDPOINT = {
  ONE_CLICK: '/v1/checkout/one_click',
  SESSION: '/v1/checkout/create_client_session',
  RESUME: '/v1/checkout/resume_payment',
};

// ---------- Primer mock ----------

export interface PrimerCallbacks {
  onTokenizeSuccess: (data: unknown, handler: unknown) => void;
  onTokenizeError?: (error: unknown) => void;
  onResumeSuccess: (data: unknown, handler: unknown) => Promise<void> | void;
  onResumeError: (error: unknown) => void;
  onCheckoutFail: (error: unknown) => void;
}

export interface PrimerLog {
  createHeadless: jest.Mock;
  continueWith: string[];
  tokenizeHandler: { handleSuccess: jest.Mock; handleFailure: jest.Mock };
  resumeHandler: { handleSuccess: jest.Mock; handleFailure: jest.Mock };
  startPaymentFlow: jest.Mock;
  callbacks?: PrimerCallbacks;
}

export type PrimerScenario = (cb: PrimerCallbacks, log: PrimerLog) => void;

export const CLOSE_ERROR = Object.assign(new Error("Can't fetch resume key"), {
  code: 'RESUME_ERROR',
  stack:
    "PrimerClientError: Can't fetch resume key\n at presentIFrameOverlay\n at async PROCESSOR_3DS",
});

/** After continueWithNewClientToken, Primer reports a resume token. */
export const resumeWith =
  (resumeToken = 'resume_1', afterMs = CHALLENGE_ANSWER_MS): PrimerScenario =>
  (cb, log) => {
    cb.onTokenizeSuccess(
      { token: 'vaulted_tok' },
      {
        ...log.tokenizeHandler,
        continueWithNewClientToken: (t: string) => {
          log.continueWith.push(t);
          setTimeout(() => {
            void cb.onResumeSuccess(
              { resumeToken },
              {
                ...log.resumeHandler,
                continueWithNewClientToken: (t2: string) =>
                  log.continueWith.push(t2),
              }
            );
          }, afterMs);
        },
      }
    );
  };

/** After continueWithNewClientToken, Primer raises the given resume error. */
export const resumeErrorWith =
  (error: unknown, afterMs = CHALLENGE_ANSWER_MS): PrimerScenario =>
  (cb, log) => {
    cb.onTokenizeSuccess(
      { token: 'vaulted_tok' },
      {
        ...log.tokenizeHandler,
        continueWithNewClientToken: (t: string) => {
          log.continueWith.push(t);
          setTimeout(() => cb.onResumeError(error), afterMs);
        },
      }
    );
  };

/** The challenge is shown and the user does nothing. */
export const challengeNeverEnds: PrimerScenario = (cb, log) => {
  cb.onTokenizeSuccess(
    { token: 'vaulted_tok' },
    {
      ...log.tokenizeHandler,
      continueWithNewClientToken: (t: string) => log.continueWith.push(t),
    }
  );
};

export function installPrimer(
  opts: {
    scenario?: PrimerScenario;
    methods?: unknown[];
    createHeadlessError?: unknown;
  } = {}
): PrimerLog {
  const log: PrimerLog = {
    createHeadless: jest.fn(),
    continueWith: [],
    tokenizeHandler: { handleSuccess: jest.fn(), handleFailure: jest.fn() },
    resumeHandler: { handleSuccess: jest.fn(), handleFailure: jest.fn() },
    startPaymentFlow: jest.fn(),
  };
  const methods = opts.methods ?? [
    { id: 'pm_card', paymentInstrumentType: 'PAYMENT_CARD' },
  ];
  log.startPaymentFlow.mockImplementation(async () => {
    setTimeout(() => (opts.scenario ?? resumeWith())(log.callbacks!, log), 0);
  });
  log.createHeadless.mockImplementation(
    async (_token: string, options: PrimerCallbacks) => {
      if (opts.createHeadlessError) {
        throw opts.createHeadlessError;
      }
      log.callbacks = options;
      return {
        start: jest.fn().mockResolvedValue(undefined),
        createVaultManager: () => ({
          fetchVaultedPaymentMethods: jest.fn().mockResolvedValue(methods),
          startPaymentFlow: log.startPaymentFlow,
        }),
      };
    }
  );
  (window as unknown as { Primer: unknown }).Primer = {
    createHeadless: log.createHeadless,
    showUniversalCheckout: jest.fn(),
  };
  return log;
}
