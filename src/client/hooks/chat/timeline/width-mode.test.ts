/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat column's width, on the document.
 *
 * The attribute is the ONLY thing CSS reads for the presets, and the inline
 * `--chat-column-max` is the ONLY thing it reads for `custom`. The cases that
 * matter are the ones a wrong implementation gets silently:
 *
 * - the default is REMOVED, not written (a document carrying `wide` and a
 *   document carrying nothing must be one state);
 * - an unreadable stored value leaves no stale attribute behind;
 * - the inline variable is removed for every preset, because an inline
 *   declaration outranks every stylesheet rule and a leftover one would make
 *   `compact` draw at the dragged width;
 * - a commit writes the mode AND the number in ONE patch, because a half-write
 *   makes the column jump on the next reload with no gesture to explain it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  applyChatWidthMode,
  commitChatColumnWidth,
  initChatWidthMode,
  previewChatColumnWidth,
  restoreChatColumnWidth,
} from '@/client/hooks/chat/timeline/width-mode';
import { primeKabmoSettings, readKabmoSetting } from '@/shared/lib/settings/client';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import {
  CHAT_COLUMN_MAX_VAR,
  CHAT_WIDTH_ATTRIBUTE,
  DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH,
  MIN_CHAT_COLUMN_WIDTH,
} from '@/shared/lib/chat/timeline/width-mode';

const DOM_GLOBALS = ['window', 'document', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** Every settings patch the module POSTed, in order. */
let posts: Record<string, unknown>[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = (async (_input: unknown, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body ?? '{}')));
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = nativeGlobals[key];
});

afterEach(() => {
  posts = [];
  primeKabmoSettings({});
  const root = document.documentElement;
  root.removeAttribute(CHAT_WIDTH_ATTRIBUTE);
  root.style.removeProperty(CHAT_COLUMN_MAX_VAR);
});

const attribute = () => document.documentElement.getAttribute(CHAT_WIDTH_ATTRIBUTE);
const variable = () => document.documentElement.style.getPropertyValue(CHAT_COLUMN_MAX_VAR);

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

  test('custom writes the attribute AND the inline width', () => {
    applyChatWidthMode('custom', 1234);
    expect(attribute()).toBe('custom');
    expect(variable()).toBe('1234px');
  });

  test('a preset removes the inline width, which would outrank its CSS rule', () => {
    applyChatWidthMode('custom', 1234);
    applyChatWidthMode('compact');
    expect(attribute()).toBe('compact');
    expect(variable()).toBe('');
  });
});

describe('previewChatColumnWidth', () => {
  test('paints the variable without touching the attribute or the stored mode', () => {
    primeKabmoSettings({ chatWidthMode: 'compact' });
    initChatWidthMode();
    previewChatColumnWidth(1500);
    expect(variable()).toBe('1500px');
    // The drag is a custom width, but a gesture that is abandoned must leave the
    // preset intact — the attribute is what the next render resolves against.
    expect(attribute()).toBe('compact');
  });
});

describe('commitChatColumnWidth', () => {
  test('stores the mode and the number in ONE patch', () => {
    commitChatColumnWidth(1400);
    expect(posts).toHaveLength(1);

    const blob = readSettingsBlob(posts[0]);
    expect(blob.chatWidthMode).toBe('custom');
    expect(blob.chatColumnWidth).toBe(1400);
  });

  test('clamps what it stores and what it draws', () => {
    commitChatColumnWidth(10);
    expect(variable()).toBe(`${MIN_CHAT_COLUMN_WIDTH}px`);
    expect(readKabmoSetting('chatColumnWidth')).toBe(MIN_CHAT_COLUMN_WIDTH);
  });

  test('a width that is not a number stores the default rather than NaN', () => {
    commitChatColumnWidth(Number.NaN);
    expect(readKabmoSetting('chatColumnWidth')).toBe(DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH);
  });
});

describe('initChatWidthMode', () => {
  test('applies the stored mode from the boot payload', () => {
    primeKabmoSettings({ chatWidthMode: 'full' });
    initChatWidthMode();
    expect(attribute()).toBe('full');
  });

  test('a stored custom width is drawn from the boot payload', () => {
    primeKabmoSettings({ chatWidthMode: 'custom', chatColumnWidth: 1180 });
    initChatWidthMode();
    expect(attribute()).toBe('custom');
    expect(variable()).toBe('1180px');
  });

  test('custom without a stored number draws the default width', () => {
    primeKabmoSettings({ chatWidthMode: 'custom' });
    initChatWidthMode();
    expect(variable()).toBe(`${DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH}px`);
  });

  test('a fresh install writes nothing — CSS `:root` is the default', () => {
    primeKabmoSettings({});
    initChatWidthMode();
    expect(attribute()).toBeNull();
    expect(variable()).toBe('');
  });

  test('a stored value from another build lands on the default column', () => {
    primeKabmoSettings({ chatWidthMode: 'gigantic', chatColumnWidth: 5000 });
    initChatWidthMode();
    expect(attribute()).toBeNull();
    expect(variable()).toBe('');
  });

  test('restore drops a live preview and returns to the stored width', () => {
    primeKabmoSettings({ chatWidthMode: 'wide' });
    previewChatColumnWidth(1600);
    restoreChatColumnWidth();
    expect(attribute()).toBeNull();
    expect(variable()).toBe('');
  });
});
