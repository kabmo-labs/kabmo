/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The text a banner can draw, and the guard on the wire that carries it.
 *
 * A session title is arbitrary text: operators paste Nerd Font icons, Powerline
 * separators and emoji into names because a terminal-wide font draws them. The
 * Android shade uses the system font, which covers none of the Private Use
 * Areas, so a Nerd Font glyph arrives as a tofu box — in the title AND in a
 * failure body. The strip therefore happens where the event is built, once.
 */

import { describe, expect, test } from 'bun:test';

import {
  asNotificationEvent,
  notificationTag,
  notificationText,
} from '@/shared/lib/notifications/events';

describe('notificationText', () => {
  test('removes Nerd Font icons from a title', () => {
    // U+F07B is the classic folder icon, U+E0B0 a Powerline separator.
    expect(notificationText('\uF07B Fix the build \uE0B0')).toBe('Fix the build');
  });

  test('removes plane-15 and plane-16 icons', () => {
    expect(notificationText('Deploy \u{F0001} staging')).toBe('Deploy staging');
    expect(notificationText('Deploy \u{100000} staging')).toBe('Deploy staging');
  });

  test('removes variation selectors a stripped icon would leave behind', () => {
    expect(notificationText('Build \uFE0F\u{E0100} done')).toBe('Build done');
  });

  test('collapses the whitespace an icon between two words leaves', () => {
    expect(notificationText('Fix   the\n\nbuild')).toBe('Fix the build');
    expect(notificationText('  spaced  ')).toBe('spaced');
  });

  test('keeps text that has real glyphs', () => {
    // Emoji, CJK and punctuation are drawn by the system font.
    expect(notificationText('Deploy 🚀 部署 (v2)')).toBe('Deploy 🚀 部署 (v2)');
  });

  test('an icon-only title becomes empty, so the caller can fall back', () => {
    expect(notificationText('\uF07B\uE0B0')).toBe('');
    expect(notificationText('')).toBe('');
  });
});

describe('the event guard', () => {
  test('accepts a delta payload and normalises absent text', () => {
    expect(asNotificationEvent({ id: 3, kind: 'finish', sessionId: 's-1' })).toEqual({
      id: 3,
      kind: 'finish',
      sessionId: 's-1',
      title: '',
      body: '',
      at: 0,
    });
  });

  test('refuses a payload that cannot advance a cursor or open a session', () => {
    expect(asNotificationEvent(null)).toBeNull();
    expect(asNotificationEvent({ kind: 'finish', sessionId: 's-1' })).toBeNull();
    expect(asNotificationEvent({ id: 1, kind: 'finish' })).toBeNull();
    expect(asNotificationEvent({ id: 1, kind: 'other', sessionId: 's-1' })).toBeNull();
  });

  test('the tag is one banner per session per kind', () => {
    expect(notificationTag({ kind: 'error', sessionId: 's-1' })).toBe('error:s-1');
  });
});
