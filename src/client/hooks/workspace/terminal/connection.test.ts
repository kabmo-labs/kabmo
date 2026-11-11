/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When a terminal may hold a PTY.
 *
 * The bug these pin: the terminal panel is mounted while hidden, so an attach
 * on mount spawned one idle shell per session the user visited. The other half
 * is just as load-bearing — once opened, a session keeps its shell when the
 * view is hidden or the page reloads.
 */

import { describe, expect, test } from 'bun:test';

import { terminalConnection } from '@/client/hooks/workspace/terminal/connection';

describe('terminalConnection', () => {
  test('a mounted but never-opened session connects nothing', () => {
    expect(terminalConnection({ visible: false, ready: true, opened: false })).toEqual({
      connect: false,
      persist: false,
    });
  });

  test('a never-opened session whose blob has not loaded still connects nothing', () => {
    expect(terminalConnection({ visible: false, ready: false, opened: false })).toEqual({
      connect: false,
      persist: false,
    });
  });

  test('the first on-screen render connects and records the opening', () => {
    expect(terminalConnection({ visible: true, ready: true, opened: false })).toEqual({
      connect: true,
      persist: true,
    });
  });

  test('an on-screen terminal does not record the opening before the blob loads', () => {
    // The write is deferred: the blob may already say opened, and overwriting a
    // restored session's own value with a fresh "true" is not needed.
    expect(terminalConnection({ visible: true, ready: false, opened: false })).toEqual({
      connect: true,
      persist: false,
    });
  });

  test('an opened session keeps its socket while the view is hidden', () => {
    expect(terminalConnection({ visible: false, ready: true, opened: true })).toEqual({
      connect: true,
      persist: false,
    });
  });

  test('an opened session on screen writes nothing', () => {
    expect(terminalConnection({ visible: true, ready: true, opened: true })).toEqual({
      connect: true,
      persist: false,
    });
  });
});
