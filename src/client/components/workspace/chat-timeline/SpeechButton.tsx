/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one speaker control, in the two shapes the footer needs.
 *
 * It follows the player's snapshot rather than owning local state, so the icon
 * under a run reflects playback started anywhere else (autoplay, another
 * button), and the run's own id keeps two answers from sharing a state.
 *
 * A footer with no TTS provider renders nothing: a control that cannot act is
 * worse than an absent one.
 */

import { Loader2, Square, Volume2 } from 'lucide-preact';
import { useTts } from '@/client/hooks/tts/tts-context';

interface SpeechButtonProps {
  text: string;
  /** The run's stable id; the button follows this, not the footer's own id. */
  speechKey: string;
  variant: 'desktop' | 'mobile' | 'sheet';
  /** Called after a sheet-started read, so the modal can close behind it. */
  onStarted?: () => void;
}

export function SpeechButton({ text, speechKey, variant, onStarted }: SpeechButtonProps) {
  const tts = useTts();
  if (!tts.enabled) return null;

  const isReading = tts.activeKey === speechKey && (tts.status === 'playing' || tts.status === 'loading');
  const canRead = /[A-Za-z0-9]/.test(text);
  const label = isReading ? 'Stop reading' : 'Read answer aloud';
  const title = !canRead
    ? 'Nothing to read aloud — this run produced no text'
    : isReading ? 'Stop reading' : 'Read answer aloud';

  const toggle = () => {
    if (isReading) {
      tts.stop();
      return;
    }
    if (!canRead) return;
    tts.speak(text, speechKey);
    onStarted?.();
  };

  if (variant === 'mobile') {
    return (
      <button
        type="button"
        disabled={!canRead}
        aria-pressed={isReading}
        aria-label={label}
        title={title}
        onClick={toggle}
        className={`shrink-0 rounded-md p-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          isReading ? 'text-ink bg-ink/10' : 'text-ink/50 hover:bg-ink/5 hover:text-ink'
        }`}
      >
        {isReading && tts.status === 'loading'
          ? <Loader2 size={16} className="animate-spin" />
          : isReading
            ? <Square size={15} />
            : <Volume2 size={16} />}
      </button>
    );
  }

  if (variant === 'sheet') {
    return (
      <button
        type="button"
        disabled={!canRead}
        aria-pressed={isReading}
        aria-label={label}
        title={title}
        onClick={toggle}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        {isReading && tts.status === 'loading'
          ? <Loader2 size={20} className="shrink-0 animate-spin text-ink/55" />
          : isReading
            ? <Square size={18} className="shrink-0 text-ink/55" />
            : <Volume2 size={20} className="shrink-0 text-ink/55" />}
        <span>{isReading ? 'Stop reading' : 'Read answer aloud'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={!canRead}
      aria-pressed={isReading}
      aria-label={label}
      title={title}
      onClick={toggle}
      className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {isReading && tts.status === 'loading'
        ? <Loader2 size={12} className="animate-spin" />
        : isReading
          ? <Square size={11} />
          : <Volume2 size={12} />}
    </button>
  );
}
