/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The session-delete blast radius.
 *
 * `DELETE /api/sessions/:sessionId` removes a directory under the sessions root
 * and another under the btw root, both by joining the id onto the root. The
 * case that shipped broken was `.`: `join(root, '.')` is `root` itself, so the
 * btw purge's unconditional workspace removal deleted EVERY session's side
 * questions and the route still answered 404 — an invisible, root-wide wipe
 * from a request that looked like a miss.
 *
 * These tests pin the two properties that made it possible: the guard rejects
 * every value that is not one segment, and the btw purge refuses a non-segment
 * even when called directly (the route is not the only entry point).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'node:os';
import path from 'path';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { purgeBtwForSession } from '@/server/lib/btw/purge.server';

describe('isSinglePathSegment', () => {
  test('accepts the id shapes the app actually produces', () => {
    // omp session ids are UUIDs; mock ids are integers; pending chats are `new-…`.
    expect(isSinglePathSegment('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isSinglePathSegment('3')).toBe(true);
    expect(isSinglePathSegment('new-1758800000000')).toBe(true);
    // A dot INSIDE a name is fine — only a name that resolves to a directory is not.
    expect(isSinglePathSegment('session.v2')).toBe(true);
  });

  test('refuses the values that resolve somewhere other than one child', () => {
    // The shipped bug: join(root, '.') === root.
    expect(isSinglePathSegment('.')).toBe(false);
    expect(isSinglePathSegment('..')).toBe(false);
    expect(isSinglePathSegment('a/b')).toBe(false);
    expect(isSinglePathSegment('..\\a')).toBe(false);
    expect(isSinglePathSegment('')).toBe(false);
    // A NUL byte truncates at the syscall boundary.
    expect(isSinglePathSegment('a\0b')).toBe(false);
  });

  test('the guard agrees with the join it is guarding', () => {
    // The property that matters: whenever the guard says yes, joining onto a
    // root stays directly inside it. Asserted against `path.join` itself rather
    // than a restatement of the rule.
    const root = path.join(tmpdir(), 'omc-path-segment-root');
    for (const id of ['11111111-2222-3333-4444-555555555555', '3', 'new-1', 'session.v2']) {
      expect(isSinglePathSegment(id)).toBe(true);
      expect(path.join(root, id).startsWith(`${root}${path.sep}`)).toBe(true);
      expect(path.dirname(path.join(root, id))).toBe(root);
    }
    for (const id of ['.', '..', 'a/b', '../x']) {
      expect(isSinglePathSegment(id)).toBe(false);
    }
  });
});

describe('purgeBtwForSession refuses a non-segment id', () => {
  const root = '/tmp/omc-path-segment-test';
  const btwRoot = path.join(root, 'btw');
  const seeded = [
    path.join(btwRoot, 'sessA', 'topicA', 'session.jsonl'),
    path.join(btwRoot, 'sessB', 'topicB', 'session.jsonl'),
  ];

  beforeAll(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
    // Two unrelated sessions' side questions, exactly as the bug destroyed them.
    // The btw root is derived from the database path, so pointing that at this
    // tree is what puts them where the purge would look.
    for (const file of seeded) {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await Bun.write(file, '{"type":"session"}\n');
    }
    Bun.env.OMPCHAMBER_DB_PATH = path.join(root, 'db.sqlite');
  });

  afterAll(async () => {
    delete Bun.env.OMPCHAMBER_DB_PATH;
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  test('`.` does not remove the btw root', async () => {
    // The guard returns before `listBtwTopics`, so no database is touched.
    expect(await purgeBtwForSession('.')).toBe(0);
    // Both sessions' transcripts must survive — this is the regression.
    for (const file of seeded) expect(fs.existsSync(file)).toBe(true);
  });

  test('a separator does not reach outside the root', async () => {
    expect(await purgeBtwForSession('../btw')).toBe(0);
    for (const file of seeded) expect(fs.existsSync(file)).toBe(true);
  });
});
