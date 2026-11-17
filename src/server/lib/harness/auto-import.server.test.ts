/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The automatic discovery pass.
 *
 * Two properties matter and both are the user's trust: the switch is the ONLY
 * consent (an id nobody enabled is never spawned), and one broken agent does not
 * stop the others. The pass takes its import function as a seam, so this suite
 * never starts a process.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureHarnessSchema } from '@/server/lib/harness/schema.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import {
  autoImportEnabled,
  loadAutoImportDisabled,
  runAutoImport,
  saveAutoImportEnabled,
} from '@/server/lib/harness/auto-import.server';

beforeEach(async () => {
  await isolateDb();
  await ensureHarnessSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

describe('the auto-import switch', () => {
  test('is ON by default; disabling writes an exclusion and enabling clears it', async () => {
    expect(await loadAutoImportDisabled()).toEqual([]);
    expect(autoImportEnabled('codex', new Set())).toBe(true);
    expect(autoImportEnabled('omp-acp', new Set())).toBe(false);
    await saveAutoImportEnabled('codex', false);
    expect(await loadAutoImportDisabled()).toEqual(['codex']);
    expect(autoImportEnabled('codex', new Set(await loadAutoImportDisabled()))).toBe(false);
    await saveAutoImportEnabled('codex', true);
    expect(await loadAutoImportDisabled()).toEqual([]);
  });

  test('an enabled-list row from the first cut is migrated to the exclusion list', async () => {
    const db = await getDb();
    await writeSettingsJson(db, 'harness_auto_import', ['codex']);
    const disabled = await loadAutoImportDisabled();
    expect(disabled).toContain('claude');
    expect(disabled).not.toContain('codex');
    expect(await db.get("SELECT 1 AS present FROM app_settings WHERE key = 'harness_auto_import'")).toBeNull();
  });

  test('the built-in transport and omp (ACP) are refused by name', async () => {
    await expect(saveAutoImportEnabled('omp-rpc', true)).rejects.toThrow('built in');
    await expect(saveAutoImportEnabled('omp-acp', true)).rejects.toThrow('already scans');
  });
});

describe('one pass', () => {
  test('reports counts, and a failed agent does not stop the next one', async () => {
    const calls: string[] = [];
    const outcome = await runAutoImport({
      targets: ['codex', 'claude'],
      importFn: async (id) => {
        calls.push(id);
        if (id === 'claude') throw new Error('Authentication required');
        return { harness: id, imported: 2, known: 1, outside: 0, empty: 0 };
      },
    });
    expect(calls).toEqual(['codex', 'claude']);
    expect(outcome.imported).toEqual(['codex']);
    expect(outcome.failed).toEqual([{ id: 'claude', error: 'Authentication required' }]);
    expect(outcome.counts.codex?.imported).toBe(2);
  });

  test('an empty target list spawns nothing', async () => {
    let called = false;
    const outcome = await runAutoImport({
      targets: [],
      importFn: async (id) => {
        called = true;
        return { harness: id, imported: 0, known: 0, outside: 0, empty: 0 };
      },
    });
    expect(called).toBe(false);
    expect(outcome.imported).toEqual([]);
  });
});
