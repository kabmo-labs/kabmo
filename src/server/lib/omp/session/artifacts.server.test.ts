/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading the raw stream behind an `artifact://<id>` reference.
 *
 * omp spills a long tool result to `<sessionDir>/<sessionId>/<id>.<kind>.log`
 * and leaves only a truncated body in the transcript. Nothing in Kabmo
 * read it, so 65 real results (the longest in the corpus) stopped at the 768
 * bytes the transcript kept.
 *
 * The id and kind reach this module from a session transcript — a document the
 * Kabmo reads, not one it wrote — so the guards ARE the test: a crafted id
 * must not escape the session directory, and an unknown kind must not be
 * probed. The session dir is redirected through `PI_CODING_AGENT_DIR`, the same
 * seam the blob tests use.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ARTIFACT_KINDS, isArtifactKind, readArtifact } from '@/server/lib/omp/session/artifacts.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

const SESSION_ID = '01a0cc50-fd62-7417-899c-e24ff8c8608c';
let agentDir = '';
let sessionDir = '';

beforeAll(async () => {
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omp-artifact-test-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sessionsDir = path.join(agentDir, 'sessions');
  const cwdDir = path.join(sessionsDir, '-tmp-project');
  await fsp.mkdir(cwdDir, { recursive: true });
  const sessionFile = path.join(cwdDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
  // A real session file: the locator reads its header line for the id.
  await fsp.writeFile(
    sessionFile,
    `${JSON.stringify({ type: 'session', version: 3, id: SESSION_ID, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/tmp/project' })}\n`,
  );
  // omp's sibling dir is the session file's full basename without `.jsonl`
  // (verified on a real install: `…Z_<uuid>/420.bash.log`), not the bare uuid.
  sessionDir = path.join(cwdDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}`);
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(path.join(sessionDir, '420.bash.log'), 'full build log\nsecond line\n');
  await fsp.writeFile(path.join(sessionDir, '213.eval.log'), 'eval output\n');
  await fsp.writeFile(path.join(sessionDir, '420.read.log'), 'read output\n');
  clearSessionFileCaches();
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  clearSessionFileCaches();
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('isArtifactKind', () => {
  test('accepts every kind omp writes', () => {
    for (const kind of ARTIFACT_KINDS) expect(isArtifactKind(kind)).toBe(true);
  });

  test('refuses anything else', () => {
    expect(isArtifactKind('passwd')).toBe(false);
    expect(isArtifactKind('')).toBe(false);
  });
});

describe('readArtifact', () => {
  test('reads the stream omp spilled for the id', async () => {
    const artifact = await readArtifact(SESSION_ID, '420', 'bash');
    expect(artifact?.text).toBe('full build log\nsecond line\n');
    expect(artifact?.kind).toBe('bash');
    expect(artifact?.truncated).toBe(false);
  });

  test('probes kinds when the caller does not know which produced it', async () => {
    expect((await readArtifact(SESSION_ID, '213'))?.text).toBe('eval output\n');
  });

  test('distinguishes two artifacts that share an id', async () => {
    expect((await readArtifact(SESSION_ID, '420', 'bash'))?.kind).toBe('bash');
    expect((await readArtifact(SESSION_ID, '420', 'read'))?.kind).toBe('read');
  });

  test('returns null for an id that was never written', async () => {
    expect(await readArtifact(SESSION_ID, '999', 'bash')).toBeNull();
  });

  test('returns null for an unknown session', async () => {
    expect(await readArtifact('no-such-session', '420')).toBeNull();
  });

  test('refuses a path-traversal id before touching the filesystem', async () => {
    expect(await readArtifact(SESSION_ID, '../../../../etc/passwd')).toBeNull();
    expect(await readArtifact(SESSION_ID, '420/../../x')).toBeNull();
  });

  test('refuses a kind outside the table', async () => {
    // Falls back to probing the real kinds rather than opening `420.passwd.log`.
    const artifact = await readArtifact(SESSION_ID, '420', 'passwd');
    expect(artifact?.kind).toBe('bash');
  });
});

describe('readArtifact size cap', () => {
  test('keeps the tail and reports the cut when the file is too large', async () => {
    const big = `${'x'.repeat(4 * 1024 * 1024 + 64)}TAIL`;
    await fsp.writeFile(path.join(sessionDir, '77.bash.log'), big);
    const artifact = await readArtifact(SESSION_ID, '77', 'bash');
    expect(artifact?.truncated).toBe(true);
    expect(artifact?.size).toBe(Buffer.byteLength(big));
    expect(artifact?.text.endsWith('TAIL')).toBe(true);
  });
});
