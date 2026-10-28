/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Editor exceptions: reported once, and never silently.
 *
 * The suppression is the part with a bug in it if it is wrong in either
 * direction — a plugin that throws per viewport update would either bury the
 * editor in toasts or say nothing at all, and both look like "the editor is
 * fine" until the missing feature is noticed.
 *
 * The event is read through a real `window` (happy-dom) rather than a stub: the
 * name and the `detail` shape are the contract the two shells subscribe to.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  EDITOR_ERROR_EVENT,
  EDITOR_ERROR_WINDOW_MS,
  reportEditorError,
  resetEditorErrorReports,
} from '@/client/lib/editor-errors';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

interface Captured {
  message: string;
}

let captured: Captured[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  window.addEventListener(EDITOR_ERROR_EVENT, (event) => {
    captured.push((event as CustomEvent<Captured>).detail);
  });
});

afterAll(() => {
  restoreDomGlobals();
});

beforeEach(() => {
  resetEditorErrorReports();
  captured = [];
});

describe('reportEditorError', () => {
  test('an Error is reported with its message', () => {
    expect(reportEditorError(new Error('decoration failed'), 1000)).toBe(true);
    expect(captured).toEqual([{ message: 'decoration failed' }]);
  });

  test('the same message inside the window is suppressed', () => {
    reportEditorError(new Error('boom'), 1000);
    expect(reportEditorError(new Error('boom'), 1000 + EDITOR_ERROR_WINDOW_MS - 1)).toBe(false);
    expect(captured).toHaveLength(1);
  });

  test('the same message is reported again after the window', () => {
    reportEditorError(new Error('boom'), 1000);
    expect(reportEditorError(new Error('boom'), 1000 + EDITOR_ERROR_WINDOW_MS)).toBe(true);
    expect(captured).toHaveLength(2);
  });

  test('a different message is not suppressed by its neighbour', () => {
    reportEditorError(new Error('one'), 1000);
    expect(reportEditorError(new Error('two'), 1001)).toBe(true);
    expect(captured.map((entry) => entry.message)).toEqual(['one', 'two']);
  });

  test('a thrown non-Error still has a sentence', () => {
    expect(reportEditorError('plain string', 1000)).toBe(true);
    expect(captured[0].message).toBe('plain string');
    expect(reportEditorError(undefined, 2000)).toBe(true);
    expect(captured[1].message).toBe('The editor hit an internal error');
  });

  test('the event name is the one the shells subscribe to', () => {
    expect(EDITOR_ERROR_EVENT).toBe('kabmo:editor-error');
  });
});
