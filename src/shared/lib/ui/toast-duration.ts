/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How long a toast stays on screen, as arithmetic.
 *
 * One flat 4000 ms was wrong in both directions, and the two complaints were the
 * same number. A one-word confirmation ("Setting was saved") hung around, while
 * a refusal carrying the server's own sentence vanished before it could be read:
 * the messages this app actually pushes run 24–89 characters, median 54.
 *
 * The budget is therefore per TONE and per LENGTH. Reading is not free: at a
 * comfortable ~20 characters a second a 54-character line needs 2.7 s of eyes
 * before the reader has even noticed the card. So each tone pays a fixed base
 * for "notice me", then a per-character rate, and the sum is clamped — an error
 * is re-read, a confirmation is skimmed, so the error starts higher, grows
 * faster and is allowed to stay longer.
 *
 * This is a POLICY module, not a component concern: the queue resolves a
 * toast's delay once, at push time, so every host renders the same number and a
 * caller overriding it does so in one place.
 */

export type ToastTone = 'success' | 'error';

/** How long the fade-out runs. The timer and the class that animates agree here. */
export const TOAST_EXIT_MS = 180;

/** Notice-me base, per tone. */
const BASE_MS: Record<ToastTone, number> = { success: 2500, error: 4000 };

/** Reading rate per tone: an error is re-read, a confirmation is skimmed. */
const PER_CHAR_MS: Record<ToastTone, number> = { success: 45, error: 55 };

/** Floor and ceiling per tone: nothing flickers, nothing sits for a minute. */
const BOUNDS_MS: Record<ToastTone, { min: number; max: number }> = {
  success: { min: 3000, max: 8000 },
  error: { min: 5000, max: 12000 },
};

export interface ToastDurationInput {
  tone: ToastTone;
  message: string;
  /**
   * The caller's own delay, in ms. `null` means "wait for a dismissal".
   * Honoured verbatim: a site that names a number knows its own content.
   */
  explicit?: number | null;
  /** A toast carrying a button waits for that decision instead of timing out. */
  sticky?: boolean;
}

/**
 * The auto-dismiss delay in ms, or `null` for a toast that stays until it is
 * dismissed.
 *
 * A toast with an action is sticky by default — a "Send now" that disappears
 * mid-reach is the same defect as a message that cannot be read — while an
 * explicit duration still wins, because that caller knows whether the action is
 * optional.
 */
export function toastDurationMs({ tone, message, explicit, sticky }: ToastDurationInput): number | null {
  if (explicit !== undefined) return explicit;
  if (sticky) return null;
  const { min, max } = BOUNDS_MS[tone];
  const byLength = BASE_MS[tone] + PER_CHAR_MS[tone] * message.trim().length;
  return Math.round(Math.min(max, Math.max(min, byLength)));
}
