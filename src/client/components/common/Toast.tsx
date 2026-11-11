import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AlertCircle, AlertTriangle, CheckCircle2, X, type LucideIcon } from 'lucide-preact';
import { TOAST_EXIT_MS } from '@/shared/lib/ui/toast-duration';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

/**
 * What each tone looks like.
 *
 * The tone owns ALL three signals — the icon, its colour and the card's border —
 * so a success cannot draw an alert, and the tint is never decided at a call
 * site. `text-*-text` (not the raw fill token) is the contrast-solved half of
 * the palette: the raw signal colours drop under 2:1 on the light themes.
 */
const TONES: Record<ToastTone, { Icon: LucideIcon; icon: string; border: string }> = {
  success: { Icon: CheckCircle2, icon: 'text-success-text', border: 'border-success/35' },
  warning: { Icon: AlertTriangle, icon: 'text-warning-text', border: 'border-warning/40' },
  error: { Icon: AlertCircle, icon: 'text-error-text', border: 'border-error/40' },
};

export interface ToastData {
  id: number;
  message: string;
  type: ToastTone;
  /** Optional action button (e.g. "Send now") shown beside the message. */
  action?: { label: string; onClick: () => void };
  /**
   * Auto-dismiss delay in ms, resolved by the queue at push time. `null` means
   * the card waits for a dismissal — a toast with an action, or an explicit
   * override from a caller that wants the user to decide.
   */
  duration: number | null;
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: number) => void;
}

/**
 * One toast card. The container and the stacking order live in `ToastStack`;
 * this owns the card's own lifecycle.
 *
 * ## The timer pauses while the pointer or the keyboard is on the card
 *
 * A message that vanishes under the cursor is unreadable. `pointerenter` and
 * focus freeze the countdown, and leaving resumes it from exactly where it
 * stopped — the remaining time is kept as a number, not recomputed from a
 * start time, so any number of pauses is exact.
 *
 * ## The timer is what dismisses, not a mount-time `setTimeout`
 *
 * The card reads no parent render state: `duration` is fixed on the toast when
 * it is pushed and `onDismiss` is a stable module function, so a parent that
 * re-renders (the chat timeline does, on every streamed frame) cannot restart
 * the countdown and keep a toast on screen indefinitely.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);

  const duration = toast.duration;
  /** What is left of the countdown, in ms; `null` while the timer is running. */
  const remainingRef = useRef<number>(duration ?? 0);
  const startedAtRef = useRef<number | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // The enter frame and the exit deadline are independent of each other: one
  // runs once, the other once per pause/resume cycle.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (duration === null) return;
    if (paused) {
      if (startedAtRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        startedAtRef.current = null;
      }
      return;
    }
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => setLeaving(true), remainingRef.current);
    return () => {
      clearTimeout(timer);
      if (startedAtRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        startedAtRef.current = null;
      }
    };
  }, [duration, paused]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => dismissRef.current(toast.id), TOAST_EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, toast.id]);

  const close = useCallback(() => setLeaving(true), []);

  const hold = useCallback(() => setPaused(true), []);
  const release = useCallback(() => setPaused(false), []);

  const tone = TONES[toast.type];
  const isError = toast.type === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      data-tone={toast.type}
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={(event) => {
        // Focus moving BETWEEN the card's own controls (the action button, the
        // close button) is not the reader leaving; only focus landing outside
        // resumes the countdown.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        release();
      }}
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-paper px-3.5 py-2.5 text-xs font-sans shadow-xl transition-all ${tone.border} ${
        entered && !leaving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
      style={{ transitionDuration: `${TOAST_EXIT_MS}ms` }}
    >
      <tone.Icon size={15} className={`mt-px flex-shrink-0 ${tone.icon}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 whitespace-pre-line break-words leading-relaxed text-ink">
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            close();
          }}
          className="flex-shrink-0 rounded bg-ink px-2 py-0.5 text-[11px] font-semibold text-paper transition-opacity hover:opacity-80"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={close}
        className="flex-shrink-0 text-ink/40 transition-colors hover:text-ink"
        title="Dismiss"
        aria-label="Dismiss notification"
      >
        <X size={13} />
      </button>
    </div>
  );
}
