import type { PaymentMethod } from '../enums';
import { getErrorImage } from './error-image';
import { isBrowser } from './helpers';

type TelemetryPrimitive = string | number | boolean | null | undefined;

interface TelemetryContext {
  checkoutId?: string;
  orderId?: string | null;
  priceId?: string;
  state?: string;
  paymentMethod?: PaymentMethod;
  reqId?: string;
}

interface TelemetryScope {
  id: string;
  orgId: string;
  baseUrl: string;
  enabled: boolean;
  getContext: () => TelemetryContext;
}

interface NormalizedError {
  name: string;
  message: string;
  code: string;
  stack?: string;
}

let activeScope: TelemetryScope | null = null;
const recentSignatures = new Map<string, number>();

const DEDUPE_WINDOW_MS = 3000;

let isListening = false;

export function startUnhandledErrorTelemetry(
  scope: TelemetryScope
): () => void {
  if (!scope.enabled || !isBrowser()) {
    return () => {};
  }

  activeScope = scope;
  attachListeners();

  return () => {
    stopUnhandledErrorTelemetry(scope.id);
  };
}

function stopUnhandledErrorTelemetry(scopeId: string): void {
  if (activeScope?.id === scopeId) {
    activeScope = null;
    recentSignatures.clear();
    detachListeners();
  }
}

function attachListeners(): void {
  if (isListening || typeof window === 'undefined') {
    return;
  }

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  isListening = true;
}

function detachListeners(): void {
  if (!isListening || typeof window === 'undefined') {
    return;
  }

  window.removeEventListener('error', handleWindowError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  isListening = false;
}

function handleWindowError(event: ErrorEvent): void {
  const normalized = normalizeError(
    event.error || event.message || 'Unhandled browser error',
    'UNHANDLED_ERROR'
  );

  reportToActiveScopes(normalized, {
    event_type: 'error',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  const normalized = normalizeError(
    event.reason || 'Unhandled promise rejection',
    'UNHANDLED_REJECTION'
  );

  reportToActiveScopes(normalized, {
    event_type: 'unhandledrejection',
  });
}

function reportToActiveScopes(
  error: NormalizedError,
  eventContext: Record<string, TelemetryPrimitive>
): void {
  if (!activeScope) {
    return;
  }

  if (!canReport(error, eventContext.event_type)) {
    return;
  }

  try {
    const context = activeScope.getContext();
    getErrorImage(activeScope.orgId, {
      baseUrl: activeScope.baseUrl,
      message: `${error.name}: ${error.message}`,
      code: error.code,
      context: {
        ...eventContext,
        order_id: context.orderId,
        price_id: context.priceId,
        page_url: getPageUrl(),
      },
    });
  } catch {
    // Telemetry must never affect checkout behavior.
  }
}

function canReport(
  error: NormalizedError,
  eventType: TelemetryPrimitive
): boolean {
  const now = Date.now();
  pruneExpiredSignatures(now);
  const signature = buildSignature(error, eventType);

  const previousReportTime = recentSignatures.get(signature);
  if (
    typeof previousReportTime === 'number' &&
    now - previousReportTime < DEDUPE_WINDOW_MS
  ) {
    return false;
  }

  recentSignatures.set(signature, now);
  return true;
}

function pruneExpiredSignatures(now: number): void {
  recentSignatures.forEach((timestamp, signature) => {
    if (now - timestamp >= DEDUPE_WINDOW_MS) {
      recentSignatures.delete(signature);
    }
  });
}

function buildSignature(
  error: NormalizedError,
  eventType: TelemetryPrimitive
): string {
  const firstStackLine = error.stack?.split('\n')[0] || '';
  return [
    eventType || '',
    error.code || '',
    error.message || '',
    firstStackLine,
  ].join('|');
}

function normalizeError(
  reason: unknown,
  fallbackCode: string
): NormalizedError {
  if (reason instanceof Error) {
    return {
      name: reason.name || 'Error',
      message: reason.message || 'Unknown error',
      code: getErrorCode(reason, fallbackCode),
      stack: reason.stack,
    };
  }

  if (typeof reason === 'object' && reason !== null) {
    const record = reason as Record<string, unknown>;
    return {
      name: toSafeString(record.name) || 'Error',
      message: toSafeString(record.message) || safeStringify(reason),
      code: toSafeString(record.code) || fallbackCode,
      stack: toSafeString(record.stack),
    };
  }

  return {
    name: 'Error',
    message: toSafeString(reason) || 'Unknown error',
    code: fallbackCode,
  };
}

function getErrorCode(error: Error, fallbackCode: string): string {
  const record = error as Error & { code?: unknown };
  return typeof record.code === 'string' && record.code
    ? record.code
    : fallbackCode;
}

function toSafeString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unserializable error';
  }
}

function getPageUrl(): string {
  if (typeof window === 'undefined' || !window.location) {
    return '';
  }

  const location = window.location;
  if (location.origin && location.pathname) {
    return `${location.origin}${location.pathname}`;
  }

  return (location.href || '').split(/[?#]/)[0];
}
