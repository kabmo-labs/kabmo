/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The skill-turn bubble, and the two properties that make it agree with the
 * rest of the app.
 *
 * A `/skill:<name>` turn is stored as a `custom_message` with `customType:
 * "skill-prompt"` and no user message, so the bubble is reconstructed from that
 * entry. Two things were wrong with the reconstruction:
 *
 *   - it dropped the operator's args, showing `/skill:red-engineer` for a turn
 *     the user had typed `/skill:red-engineer why is this query slow` — omp's
 *     own title input keeps them (`skillPromptTitleInput`), so the timeline
 *     disagreed with the model's idea of the turn;
 *   - its name recovery read the prompt with plain quotes, while the JSONL
 *     escapes them (`\"red-engineer\"`), so the details-less path never matched.
 *
 * Split from `messages-map.test.ts` (which is at the repo's per-file ceiling).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSessionMessages } from '@/server/lib/omp/session/messages';

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** One entry per second, so ordering assertions are readable. */
const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();

function writeSession(entries: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'omp-skill-bubble-'));
  tempDirs.push(dir);
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n'));
  return file;
}

describe('a /skill: turn rendered as a bubble', () => {
  test('carries the args the operator typed, as omp\u2019s own chip does', async () => {
    const messages = await loadSessionMessages(writeSession([
      {
        type: 'custom_message',
        id: 'sk',
        customType: 'skill-prompt',
        attribution: 'user',
        timestamp: at(1),
        content: '[IMPORTANT: User invoked the \\"red-engineer\\" skill; follow its instructions.]',
        details: { name: 'red-engineer', args: 'why is this query slow' },
      },
    ]));
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('/skill:red-engineer why is this query slow');
  });

  test('recovers the name from the prompt when details are absent', async () => {
    // The escaped-quote spelling is what the file actually holds; a plain-quote
    // pattern matched nothing.
    const messages = await loadSessionMessages(writeSession([
      {
        type: 'custom_message',
        id: 'sk',
        customType: 'skill-prompt',
        attribution: 'user',
        timestamp: at(1),
        content: '[IMPORTANT: User invoked the \\"diagnose\\" skill; follow its instructions.]',
      },
    ]));
    expect(messages[0]?.content).toBe('/skill:diagnose');
  });

  test('an agent-attributed skill entry never becomes a user bubble', async () => {
    const messages = await loadSessionMessages(writeSession([
      {
        type: 'custom_message',
        id: 'sk',
        customType: 'skill-prompt',
        attribution: 'agent',
        timestamp: at(1),
        content: 'User invoked the "red-engineer" skill',
        details: { name: 'red-engineer' },
      },
    ]));
    expect(messages[0]?.role).not.toBe('user');
  });
});
