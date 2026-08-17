/**
 * @fileoverview Deferred-session warm-up trigger.
 *
 * The contract that matters: the session must exist before the visitor can
 * tap, because ApplePaySession has to be constructed inside the gesture. So
 * the dwell must fire on its own for anyone who simply looks at the page,
 * while prerendered and hidden pages must never warm up at all.
 */

import {
  DEFAULT_WARMUP_DWELL_MS,
  onSessionWarmup,
} from '../src/utils/session-warmup';
import {
  WARMUP_HEADER,
  setWarmupTag,
  takeWarmupTag,
} from '../src/utils/warmup-telemetry';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('onSessionWarmup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setVisibility('visible');
    delete (document as Document & { prerendering?: boolean }).prerendering;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('fires on dwell alone, so a visitor who never interacts is still warm before any tap', () => {
    const handler = jest.fn();
    onSessionWarmup(handler);

    expect(handler).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DEFAULT_WARMUP_DWELL_MS);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('dwell');
  });

  it('fires immediately on interaction, well before the dwell elapses', () => {
    const handler = jest.fn();
    onSessionWarmup(handler);

    jest.advanceTimersByTime(50);
    document.dispatchEvent(new Event('pointerdown'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('interaction');

    // the pending dwell must not fire a second time
    jest.advanceTimersByTime(DEFAULT_WARMUP_DWELL_MS);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never warms up a hidden or prerendered page', () => {
    setVisibility('hidden');
    const handler = jest.fn();
    onSessionWarmup(handler);

    jest.advanceTimersByTime(DEFAULT_WARMUP_DWELL_MS * 5);
    document.dispatchEvent(new Event('scroll'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('starts the dwell once a prerendered page becomes visible', () => {
    setVisibility('hidden');
    const handler = jest.fn();
    onSessionWarmup(handler);

    jest.advanceTimersByTime(DEFAULT_WARMUP_DWELL_MS * 2);
    expect(handler).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(DEFAULT_WARMUP_DWELL_MS);

    expect(handler).toHaveBeenCalledWith('dwell');
  });

  it('cleanup prevents a later warm-up and detaches listeners', () => {
    const handler = jest.fn();
    const cleanup = onSessionWarmup(handler);

    cleanup();
    jest.advanceTimersByTime(DEFAULT_WARMUP_DWELL_MS * 3);
    document.dispatchEvent(new Event('touchstart'));

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('warm-up telemetry tag', () => {
  it('reports trigger and elapsed time, and is consumed exactly once', () => {
    setWarmupTag('interaction', 412.6);

    expect(takeWarmupTag()).toBe('interaction;413');
    expect(takeWarmupTag()).toBeNull();
  });

  it('never emits a negative elapsed time', () => {
    setWarmupTag('dwell', -5);
    expect(takeWarmupTag()).toBe('dwell;0');
  });

  it('uses a header name the backend already logs', () => {
    expect(WARMUP_HEADER).toBe('X-FF-Warmup');
  });
});
