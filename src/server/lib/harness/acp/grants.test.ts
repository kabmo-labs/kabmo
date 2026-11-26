/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Always allow" is the operator's standing decision about one CALL, keyed by
 * what the dialog showed — not by a tool-call id that differs on every
 * invocation. A grant that outlived a process is the point; a grant that leaked
 * across kinds (a write covering an exec) would be a security hole.
 */

import { describe, expect, test } from 'bun:test';
import { permissionGrantKey, PermissionGrants } from '@kabmo-labs/kabmo-acp-client/grants';
import { ensureAcpGrantSchema, loadAcpGrants, saveAcpGrant } from '@/server/lib/harness/acp/grants.server';
import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

describe('permissionGrantKey', () => {
  test('keys on the command the dialog shows', () => {
    expect(permissionGrantKey({ kind: 'execute', rawInput: { command: 'rm -rf build' } })).toBe('execute\u0000rm -rf build');
  });

  test('keeps kinds apart so a write grant never covers an exec', () => {
    const write = permissionGrantKey({ kind: 'edit', rawInput: { path: '/a.ts' } });
    const read = permissionGrantKey({ kind: 'read', rawInput: { path: '/a.ts' } });
    expect(write).not.toBe(read);
  });

  test('a call with nothing identifying earns no key', () => {
    expect(permissionGrantKey({ kind: 'execute', title: '   ' })).toBeNull();
    expect(permissionGrantKey(undefined)).toBeNull();
  });
});

describe('PermissionGrants', () => {
  test('hydrated keys answer without a dialog', () => {
    const grants = new PermissionGrants();
    grants.hydrate(['execute\u0000make']);
    expect(grants.has('execute\u0000make')).toBe(true);
    expect(grants.has(null)).toBe(false);
  });

  test('adding a key twice reports the first as the new grant', () => {
    const grants = new PermissionGrants();
    expect(grants.add('k')).toBe(true);
    expect(grants.add('k')).toBe(false);
    expect(grants.snapshot()).toEqual(['k']);
  });
});

describe('grant persistence', () => {
  test('a saved grant is read back for the same session, and only that one', async () => {
    await isolateDb();
    try {
      await ensureAcpGrantSchema(await getDb());
      await saveAcpGrant('chat-1', 'execute\u0000make test');
      await saveAcpGrant('chat-1', 'execute\u0000make test');
      expect(await loadAcpGrants('chat-1')).toEqual(['execute\u0000make test']);
      expect(await loadAcpGrants('chat-2')).toEqual([]);
    } finally {
      await releaseDb();
    }
  });
});
