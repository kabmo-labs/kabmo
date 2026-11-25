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
 * While a run is being read it offers PAUSE and STOP as separate actions: stop
 * drops the rest of the answer, pause keeps the sample it stopped on so the
 * reader can resume mid-sentence (the player then never starts the next chunk).
 *
 * A footer with no TTS provider renders nothing: a control that cannot act is
 * worse than an absent one.
 */

import { Loader2, Pause, Play, Square, Volume2 } from 'lucide-preact';
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

  const isReading = tts.activeKey === speechKey
    && (tts.status === 'playing' || tts.status === 'loading' || tts.status === 'paused');
  const isPaused = isReading && tts.status === 'paused';
  const isStarting = isReading && tts.status === 'loading';
  const canRead = /[A-Za-z0-9]/.test(text);
  const label = isReading ? 'Stop reading' : 'Read answer aloud';
  const title = !canRead
    ? 'Nothing to read aloud — this run produced no text'
    : isReading ? 'Stop reading' : 'Read answer aloud';

  const togglePause = () => {
    if (isPaused) tts.resume();
    else tts.pause();
  };

  const start = () => {
    tts.speak(text, speechKey);
    onStarted?.();
  };

  const pauseLabel = isPaused ? 'Resume reading' : 'Pause reading';
  const pauseIcon = isStarting
    ? <Loader2 size={variant === 'desktop' ? 12 : variant === 'mobile' ? 16 : 20} className="animate-spin" />
    : isPaused
      ? <Play size={variant === 'desktop' ? 12 : variant === 'mobile' ? 15 : 18} />
      : <Pause size={variant === 'desktop' ? 12 : variant === 'mobile' ? 15 : 18} />;

  if (variant === 'sheet') {
    if (isReading) {
      return (
        <>
          <button
            type="button"
            aria-label={pauseLabel}
            aria-pressed={isPaused}
            title={pauseLabel}
            onClick={togglePause}
            className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer"
          >
            <span className="shrink-0 text-ink/55">{pauseIcon}</span>
            <span>{pauseLabel}</span>
          </button>
          <button
            type="button"
            aria-label="Stop reading"
            title="Stop reading"
            onClick={tts.stop}
            className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer"
          >
            <Square size={18} className="shrink-0 text-ink/55" />
            <span>Stop reading</span>
          </button>
        </>
      );
    }
    return (
      <button
        type="button"
        disabled={!canRead}
        aria-label={label}
        title={title}
        onClick={start}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <Volume2 size={20} className="shrink-0 text-ink/55" />
        <span>Read answer aloud</span>
      </button>
    );
  }

  if (variant === 'mobile') {
    if (isReading) {
      return (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label={pauseLabel}
            aria-pressed={isPaused}
            title={pauseLabel}
            onClick={togglePause}
            className="rounded-md p-2 text-ink transition-colors hover:bg-ink/5 cursor-pointer"
          >
            {pauseIcon}
          </button>
          <button
            type="button"
            aria-label="Stop reading"
            title="Stop reading"
            onClick={tts.stop}
            className="rounded-md p-2 text-ink transition-colors hover:bg-ink/5 cursor-pointer"
          >
            <Square size={15} />
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        disabled={!canRead}
        aria-label={label}
        title={title}
        onClick={start}
        className="shrink-0 rounded-md p-2 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Volume2 size={16} />
      </button>
    );
  }

  if (isReading) {
    return (
      <span className="flex items-center">
        <button
          type="button"
          aria-label={pauseLabel}
          aria-pressed={isPaused}
          title={pauseLabel}
          onClick={togglePause}
          className="flex items-center rounded p-1 text-ink transition-colors hover:bg-ink/5 cursor-pointer"
        >
          {pauseIcon}
        </button>
        <button
          type="button"
          aria-label="Stop reading"
          title="Stop reading"
          onClick={tts.stop}
          className="flex items-center rounded p-1 text-ink transition-colors hover:bg-ink/5 cursor-pointer"
        >
          <Square size={11} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={!canRead}
      aria-label={label}
      title={title}
      onClick={start}
      className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <Volume2 size={12} />
    </button>
  );
}
