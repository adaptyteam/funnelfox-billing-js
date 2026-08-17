/**
 * @fileoverview Decides when a deferred client session should be created.
 *
 * Fires on whichever comes first: the visitor's first interaction, or a short
 * dwell once the page is actually visible. The dwell is what makes the
 * deferral safe — ApplePaySession must be constructed inside the tap gesture,
 * so the session has to exist *before* the first tap. A human cannot read a
 * price and tap in under ~800ms, whereas prerenders, background tabs, crawlers
 * and instant bounces never reach the dwell at all and so never cost a
 * session (nor the order row behind it).
 */

const INTERACTION_EVENTS = [
  'pointerdown',
  'touchstart',
  'keydown',
  'wheel',
  'scroll',
] as const;

/** Long enough to filter prerenders and instant bounces, far shorter than
 * any realistic time-to-tap on a paywall. */
export const DEFAULT_WARMUP_DWELL_MS = 800;

export type WarmupCleanup = () => void;
export type WarmupSource = 'dwell' | 'interaction';

/** True while the page is prerendering or not visible to the user. */
export function isPageHidden(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  if ((document as Document & { prerendering?: boolean }).prerendering) {
    return true;
  }
  return document.visibilityState === 'hidden';
}

/**
 * Invokes `handler` once — on first interaction, or after `dwellMs` of visible
 * time, whichever happens first. Returns a cleanup for the un-fired case.
 */
export function onSessionWarmup(
  handler: (source: WarmupSource) => void,
  dwellMs: number = DEFAULT_WARMUP_DWELL_MS
): WarmupCleanup {
  if (typeof document === 'undefined') {
    return () => {};
  }

  let fired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanup: WarmupCleanup = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    for (const event of INTERACTION_EVENTS) {
      document.removeEventListener(event, onInteraction, true);
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('prerenderingchange', onVisibilityChange);
  };

  const fire = (source: WarmupSource) => {
    if (fired) {
      return;
    }
    fired = true;
    cleanup();
    handler(source);
  };

  function onInteraction() {
    if (!isPageHidden()) {
      fire('interaction');
    }
  }

  function startDwell() {
    if (fired || timer !== undefined) {
      return;
    }
    timer = setTimeout(() => fire('dwell'), dwellMs);
  }

  function onVisibilityChange() {
    if (!isPageHidden()) {
      startDwell();
    }
  }

  for (const event of INTERACTION_EVENTS) {
    document.addEventListener(event, onInteraction, {
      capture: true,
      passive: true,
    });
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('prerenderingchange', onVisibilityChange);

  if (!isPageHidden()) {
    startDwell();
  }

  return cleanup;
}
