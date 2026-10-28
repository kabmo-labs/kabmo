/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * The topic transcript and its promotion are file surgery on a format omp
 * owns, and every failure mode here is silent: a title slot that is not the
 * fixed width stops omp rewriting it in place, a stale session id makes two
 * sessions claim one identity, and a torn tail line makes the side child fail
 * to load the transcript at all. These cases pin those invariants.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildTitleLine, createBtwWorkspace, getBtwRoot, promoteBtwTopic, readTranscriptLeaf } from '@/server/lib/btw/session-copy.server';

const timestamp = '2026-09-23T08:41:10.683Z';
const createdDirs: string[] = [];
const createdSessions: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'btw-test-'));
  createdDirs.push(dir);
  return dir;
}

function sessionLine(id: string, cwd = '/tmp'): string {
  return JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd });
}

function userLine(id: string, parentId: string | null, text: string): string {
  return JSON.stringify({ type: 'message', id, parentId, timestamp, message: { role: 'user', content: [{ type: 'text', text }] } });
}

function assistantLine(id: string, parentId: string | null, text: string): string {
  return JSON.stringify({ type: 'message', id, parentId, timestamp, message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const dir of createdSessions.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildTitleLine', () => {
  test('pads the title record to the fixed slot omp rewrites in place', () => {
    const line = buildTitleLine('Which codeword did we agree on?', 'user', timestamp);
    expect(Buffer.byteLength(line, 'utf8')).toBe(255);
    const record = JSON.parse(line);
    expect(record.type).toBe('title');
    expect(record.title).toBe('Which codeword did we agree on?');
    expect(record.source).toBe('user');
  });

  test('fits a title the model wrote in multi-byte characters', () => {
    // A 60-character topic label is 180 UTF-8 bytes in CJK: the slot holds
    // ~158, so the title is truncated rather than thrown — otherwise promoting
    // a perfectly ordinary question fails the whole request.
    const title = 'この質問は日本語で書かれています。プロモートできるか確認します。ここから先は切り詰められます';
    const line = buildTitleLine(title, 'user', timestamp);
    expect(Buffer.byteLength(line, 'utf8')).toBe(255);
    const record = JSON.parse(line);
    expect(record.title.length).toBeGreaterThan(0);
    expect(title.startsWith(record.title)).toBe(true);
  });
});

describe('createBtwWorkspace', () => {
  test('snapshots the parent transcript and reports its leaf', async () => {
    const sessionId = crypto.randomUUID();
    const parentDir = tempDir();
    const parentFile = join(parentDir, 'parent.jsonl');
    createdSessions.push(join(await getBtwRoot(), sessionId));
    writeFileSync(
      parentFile,
      [buildTitleLine('parent', 'auto', timestamp), sessionLine(sessionId), userLine('a1', null, 'hello'), assistantLine('a2', 'a1', 'hi')].join('\n') + '\n',
    );

    const workspace = await createBtwWorkspace({ parentSessionId: sessionId, topicId: 'topic-1', parentSessionFile: parentFile });

    expect(workspace.leafId).toBe('a2');
    expect(existsSync(workspace.sessionFile)).toBe(true);
    const copied = readFileSync(workspace.sessionFile, 'utf8');
    expect(copied).toBe(readFileSync(parentFile, 'utf8'));
  });

  test('drops a torn tail line from a parent caught mid-append', async () => {
    const sessionId = crypto.randomUUID();
    const parentDir = tempDir();
    const parentFile = join(parentDir, 'parent.jsonl');
    createdSessions.push(join(await getBtwRoot(), sessionId));
    const torn = '{"type":"message","id":"torn';
    writeFileSync(
      parentFile,
      [buildTitleLine('parent', 'auto', timestamp), sessionLine(sessionId), userLine('a1', null, 'hello')].join('\n') + '\n' + torn,
    );

    const workspace = await createBtwWorkspace({ parentSessionId: sessionId, topicId: 'topic-2', parentSessionFile: parentFile });

    const copied = readFileSync(workspace.sessionFile, 'utf8');
    expect(copied.endsWith('\n')).toBe(true);
    expect(copied).not.toContain('torn');
    expect(workspace.leafId).toBe('a1');
  });
});

describe('promoteBtwTopic', () => {
  function topicFile(dir: string): { path: string; parentFile: string } {
    const parentFile = join(dir, 'parent.jsonl');
    const path = join(dir, 'topic.jsonl');
    writeFileSync(parentFile, [buildTitleLine('parent', 'auto', timestamp), sessionLine('parent-session').replace('parent-session', 'aaaa1111')].join('\n') + '\n');
    writeFileSync(
      path,
      [
        buildTitleLine('side question', 'user', timestamp),
        sessionLine('parent-id'),
        userLine('u1', null, 'remember ORANGE-TAPIR'),
        assistantLine('a1', 'u1', 'ok'),
        userLine('u2', 'a1', '<btw>\nEphemeral side question for current interactive session.\nAnswer briefly, directly; use conversation context already provided.\nNEVER use tools.\nNEVER ask follow-up questions.\nQuestion:\nWhat is the codeword?\n</btw>'),
        assistantLine('a2', 'u2', 'ORANGE-TAPIR'),
      ].join('\n') + '\n',
    );
    return { path, parentFile };
  }

  test('writes a branch session beside the parent under a fresh identity', async () => {
    const dir = tempDir();
    const { path, parentFile } = topicFile(dir);

    const created = await promoteBtwTopic({ parentSessionFile: parentFile, topicSessionFile: path, title: 'What is the codeword?' });

    const promotedFiles = readdirSync(dir).filter((name) => name.endsWith(`_${created}.jsonl`));
    expect(promotedFiles.length).toBe(1);
    // omp names session files `<ISO with [:. ] → ->_<id>.jsonl`.
    expect(promotedFiles[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f-]{36}\.jsonl$/);
    const promoted = join(dir, promotedFiles[0]);
    const lines = readFileSync(promoted, 'utf8').trimEnd().split('\n');

    expect(Buffer.byteLength(lines[0], 'utf8')).toBe(255);
    expect(JSON.parse(lines[0]).title).toBe('What is the codeword?');

    const header = JSON.parse(lines[1]);
    expect(header.id).toBe(created);
    expect(header.id).not.toBe('parent-id');
    expect(header.parentSession).toBe(parentFile);
    expect(header.title).toBe('What is the codeword?');
    expect(header.cwd).toBe('/tmp');

    // Exactly one title record, at the top: a second one would confuse the slot.
    expect(lines.filter((line) => line.includes('"type":"title"')).length).toBe(1);
    // The promoted chat shows the question the user asked, not the template.
    expect(readFileSync(promoted, 'utf8')).toContain('"text":"What is the codeword?"');
    expect(readFileSync(promoted, 'utf8')).not.toContain('NEVER use tools');
    expect(await readTranscriptLeaf(promoted)).toBe('a2');
  });

  test('refuses a transcript with no session header instead of guessing one', async () => {
    const dir = tempDir();
    const topicPath = join(dir, 'headerless.jsonl');
    writeFileSync(topicPath, userLine('u1', null, 'no header here') + '\n');

    expect(
      promoteBtwTopic({ parentSessionFile: join(dir, 'parent.jsonl'), topicSessionFile: topicPath, title: 'x' }),
    ).rejects.toThrow('no session header');
  });
});
