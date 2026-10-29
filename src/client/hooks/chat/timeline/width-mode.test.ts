/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat column's width mode, on the document.
 *
 * The attribute is the ONLY thing CSS reads, so the cases that matter are the
 * two a wrong implementation gets silently: the default must be REMOVED (a
 * document carrying `wide` and a document carrying nothing must be one state),
 * and an unreadable stored value must not leave a stale attribute behind.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { applyChatWidthMode, initChatWidthMode } from '@/client/hooks/chat/timeline/width-mode';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { CHAT_WIDTH_ATTRIBUTE } from '@/shared/lib/chat/timeline/width-mode';

const DOM_GLOBALS = ['window', 'document'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = nativeGlobals[key];
});

afterEach(() => {
  document.documentElement.removeAttribute(CHAT_WIDTH_ATTRIBUTE);
});

const attribute = () => document.documentElement.getAttribute(CHAT_WIDTH_ATTRIBUTE);

describe('applyChatWidthMode', () => {
  test('writes a non-default mode', () => {
    applyChatWidthMode('compact');
    expect(attribute()).toBe('compact');
  });

  test('the default is REMOVED, not written', () => {
    applyChatWidthMode('full');
    applyChatWidthMode('wide');
    expect(attribute()).toBeNull();
  });

  test('a value this build cannot draw clears a stale attribute', () => {
    applyChatWidthMode('compact');
    applyChatWidthMode('ultra');
    expect(attribute()).toBeNull();
  });
});

describe('initChatWidthMode', () => {
  test('applies the stored mode from the boot payload', () => {
    primeKabmoSettings({ chatWidthMode: 'full' });
    initChatWidthMode();
    expect(attribute()).toBe('full');
  });

  test('a fresh install writes nothing — CSS `:root` is the default', () => {
    primeKabmoSettings({});
    initChatWidthMode();
    expect(attribute()).toBeNull();
  });

  test('a stored value from another build lands on the default column', () => {
    primeKabmoSettings({ chatWidthMode: 'gigantic' });
    initChatWidthMode();
    expect(attribute()).toBeNull();
  });
});
