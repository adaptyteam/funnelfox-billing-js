/**
 * @fileoverview Tags the deferred session request so the warm-up trigger can
 * be measured without adding a single extra network call.
 *
 * The backend already logs every request header, so `X-FF-Warmup` lands in
 * Elasticsearch for free. That gives us, per session actually created:
 *   - which signal started it (dwell vs interaction vs a cold tap)
 *   - how long after mount it fired
 *
 * Which is what tells us whether the dwell can be lengthened (more savings)
 * or must stay short (cold-tap risk), instead of guessing at an interaction
 * rate nobody has measured.
 */

export type WarmupTrigger = 'dwell' | 'interaction' | 'tap';

export const WARMUP_HEADER = 'X-FF-Warmup';

let pendingTag: string | null = null;

/** Records the trigger for the session request that is about to be sent. */
export function setWarmupTag(trigger: WarmupTrigger, msSinceMount: number) {
  pendingTag = `${trigger};${Math.max(0, Math.round(msSinceMount))}`;
}

/** Consumes the tag — it describes one request only. */
export function takeWarmupTag(): string | null {
  const tag = pendingTag;
  pendingTag = null;
  return tag;
}
