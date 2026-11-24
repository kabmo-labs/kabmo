/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Speak the final answer of a run when it settles.
 *
 * Only a run that was OPEN when this page watched it: the transition
 * `generating → idle` is the trigger, so loading a session with history never
 * starts talking, and a run that finished on another device is not replayed on
 * mount. A short debounce absorbs the queue's own flip (a queued follow-up
 * starts a new run immediately), and `lastSpoken` makes a re-render harmless.
 *
 * Browser policy is the other half: `audio.play()` outside a user gesture is
 * blocked. The player reports `NotAllowedError` in words, and the speaker button
 * is the manual way in.
 */

import { useEffect, useRef } from 'preact/hooks';
import { readTtsConfig } from '@/client/lib/tts/player';
import { speakTts, stopTts } from '@/client/hooks/tts/use-tts-player';
import { resolveRunFooters, type RunFooterSlot } from '@/shared/lib/chat/timeline/run-footer';
import type { ChatMessageData } from '@/shared/types';

const SETTLE_DEBOUNCE_MS = 450;

interface AutoplayOptions {
  messages: ChatMessageData[];
  isGenerating: boolean;
  sessionId?: string | null;
  /** Test seams; the provider uses the module player. */
  speak?: typeof speakTts;
  stop?: typeof stopTts;
}

function lastUserMessageId(messages: ChatMessageData[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index].id;
  }
  return null;
}

function lastRun(messages: ChatMessageData[]): RunFooterSlot | null {
  const footers = resolveRunFooters(messages, false);
  for (let index = footers.length - 1; index >= 0; index -= 1) {
    const slot = footers[index];
    if (slot) return slot;
  }
  return null;
}

export function useSpeechAutoplay({
  messages,
  isGenerating,
  sessionId,
  speak = speakTts,
  stop = stopTts,
}: AutoplayOptions): void {
  const previousGenerating = useRef(isGenerating);
  const generatingNow = useRef(isGenerating);
  const previousSession = useRef(sessionId ?? null);
  const previousUser = useRef<string | null>(lastUserMessageId(messages));
  const lastSpoken = useRef<string | null>(null);

  useEffect(() => {
    generatingNow.current = isGenerating;
    const user = lastUserMessageId(messages);
    const session = sessionId ?? null;

    if (previousSession.current !== session) {
      previousSession.current = session;
      previousGenerating.current = isGenerating;
      previousUser.current = user;
      lastSpoken.current = null;
      stop();
      return;
    }

    if (previousUser.current !== user) {
      previousUser.current = user;
      stop();
    }

    const wasGenerating = previousGenerating.current;
    previousGenerating.current = isGenerating;
    if (!wasGenerating && isGenerating) {
      stop();
      return;
    }
    if (!wasGenerating || isGenerating) return;

    const config = readTtsConfig();
    if (!config.autoplay) return;

    const timer = setTimeout(() => {
      if (generatingNow.current) return;
      const slot = lastRun(messages);
      if (!slot || !slot.answerText.trim()) return;
      if (slot.msg.id === lastSpoken.current) return;
      lastSpoken.current = slot.msg.id;
      speak(slot.answerText, slot.msg.id, config);
    }, SETTLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isGenerating, messages, sessionId, speak, stop]);
}
