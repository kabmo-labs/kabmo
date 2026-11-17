/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone dock's body props.
 *
 * A built-in view can now be placed on the left dock, and the phone's drawer
 * draws the same catalog. Its body therefore has to carry the same
 * `requiresWorkspace` rule the desktop column and the right drawer apply: a
 * tree-reading view with no folder is INERT rather than reading `undefined` as
 * a root, while a session view (todos, plan, usage, either browser) stays
 * drawable.
 */

import { describe, expect, test } from 'bun:test';
import { dockBodyProps } from '@/client/components/mobile/mobile-session-sidebar/use-dock';

const base = { sessionId: 's1', refreshKey: 0, onClose: () => {} };

describe('dockBodyProps', () => {
  test('a tree-reading built-in is disabled with no workspace', () => {
    expect(dockBodyProps({ ...base, requiresWorkspace: true, hasActiveContext: false }).enabled).toBe(false);
  });

  test('a tree-reading built-in is enabled once a folder is open', () => {
    expect(dockBodyProps({ ...base, requiresWorkspace: true, hasActiveContext: true }).enabled).toBe(true);
  });

  test('a session view stays enabled without a workspace', () => {
    expect(dockBodyProps({ ...base, requiresWorkspace: false, hasActiveContext: false }).enabled).toBe(true);
  });

  test('the session is handed over as a string, and the phone layout is named', () => {
    const body = dockBodyProps({ ...base, sessionId: 7 });
    expect(body.sessionId).toBe('7');
    expect(body.layout).toBe('phone');
    expect(body.showHeader).toBe(false);
  });
});
