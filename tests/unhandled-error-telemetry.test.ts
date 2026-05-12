/**
 * @jest-environment jsdom
 */

import { PaymentMethod } from '../src/enums';
import { startUnhandledErrorTelemetry } from '../src/utils/unhandled-error-telemetry';

describe('unhandled error telemetry', () => {
  const cleanupFns: Array<() => void> = [];

  afterEach(() => {
    cleanupFns.splice(0).forEach(cleanup => cleanup());
  });

  function startScope(enabled = true): void {
    const cleanup = startUnhandledErrorTelemetry({
      id: `checkout_${Math.random()}`,
      orgId: 'org_123',
      enabled,
      getContext: () => ({
        checkoutId: 'checkout_123',
        orderId: 'order_123',
        priceId: 'price_123',
        state: 'ready',
        paymentMethod: PaymentMethod.APPLE_PAY,
        reqId: 'req_123',
      }),
    });
    cleanupFns.push(cleanup);
  }

  function getReportParams(): URLSearchParams {
    const img = document.querySelector('img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    return new URL(img?.src || '').searchParams;
  }

  function createWindowErrorEvent(
    error: Error,
    options: {
      filename?: string;
      lineno?: number;
      colno?: number;
    } = {}
  ): ErrorEvent {
    const event = new Event('error') as ErrorEvent;
    Object.defineProperties(event, {
      message: { value: error.message },
      error: { value: error },
      filename: { value: options.filename || '' },
      lineno: { value: options.lineno || 0 },
      colno: { value: options.colno || 0 },
    });
    return event;
  }

  function createWindowErrorMessageEvent(message: string): ErrorEvent {
    const event = new Event('error') as ErrorEvent;
    Object.defineProperties(event, {
      message: { value: message },
      error: { value: undefined },
      filename: { value: '' },
      lineno: { value: 0 },
      colno: { value: 0 },
    });
    return event;
  }

  test('does not report browser errors when disabled', () => {
    startScope(false);

    window.dispatchEvent(createWindowErrorMessageEvent('Invalid Date'));

    expect(document.querySelector('img')).toBeNull();
  });

  test('reports window error events for an enabled scope', () => {
    startScope();

    window.dispatchEvent(
      createWindowErrorEvent(new RangeError('Invalid Date'), {
        filename: 'https://sdk.primer.io/apple-pay.js',
        lineno: 10,
        colno: 20,
      })
    );

    const params = getReportParams();
    expect(params.get('message')).toContain('RangeError: Invalid Date');
    expect(params.get('code')).toBe('UNHANDLED_ERROR');
    expect(params.get('event_type')).toBe('error');
    expect(params.get('checkout_id')).toBe('checkout_123');
    expect(params.get('order_id')).toBe('order_123');
    expect(params.get('price_id')).toBe('price_123');
    expect(params.get('checkout_state')).toBe('ready');
    expect(params.get('payment_method')).toBe(PaymentMethod.APPLE_PAY);
    expect(params.get('req_id')).toBe('req_123');
  });

  test('reports unhandled promise rejections for an enabled scope', () => {
    startScope();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', {
      value: new RangeError('Invalid Date'),
    });

    window.dispatchEvent(event);

    const params = getReportParams();
    expect(params.get('message')).toContain('RangeError: Invalid Date');
    expect(params.get('code')).toBe('UNHANDLED_REJECTION');
    expect(params.get('event_type')).toBe('unhandledrejection');
  });

  test('stops reporting after cleanup', () => {
    startScope();
    cleanupFns.splice(0).forEach(cleanup => cleanup());

    window.dispatchEvent(createWindowErrorMessageEvent('Invalid Date'));

    expect(document.querySelector('img')).toBeNull();
  });

  test('deduplicates identical errors in a short window', () => {
    startScope();

    for (let i = 0; i < 6; i += 1) {
      window.dispatchEvent(
        createWindowErrorEvent(new RangeError('Invalid Date'))
      );
    }

    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  test('uses only the latest active scope', () => {
    startScope();
    startScope();

    window.dispatchEvent(createWindowErrorEvent(new RangeError('Invalid Date')));

    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  test('cleanup of previous scope does not remove newer scope', () => {
    const firstCleanup = startUnhandledErrorTelemetry({
      id: 'first',
      orgId: 'org_123',
      enabled: true,
      getContext: () => ({
        checkoutId: 'checkout_first',
        orderId: 'order_first',
        priceId: 'price_123',
        state: 'ready',
        paymentMethod: PaymentMethod.APPLE_PAY,
        reqId: 'req_first',
      }),
    });
    cleanupFns.push(firstCleanup);

    const secondCleanup = startUnhandledErrorTelemetry({
      id: 'second',
      orgId: 'org_123',
      enabled: true,
      getContext: () => ({
        checkoutId: 'checkout_second',
        orderId: 'order_second',
        priceId: 'price_123',
        state: 'ready',
        paymentMethod: PaymentMethod.GOOGLE_PAY,
        reqId: 'req_second',
      }),
    });
    cleanupFns.push(secondCleanup);

    firstCleanup();
    window.dispatchEvent(createWindowErrorEvent(new RangeError('Invalid Date')));

    const params = getReportParams();
    expect(params.get('checkout_id')).toBe('checkout_second');
    expect(params.get('order_id')).toBe('order_second');
    expect(params.get('payment_method')).toBe(PaymentMethod.GOOGLE_PAY);
  });
});
