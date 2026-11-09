/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A reopened ACP chat must name the model it is ACTUALLY running.
 *
 * A non-omp ACP agent writes no transcript Kabmo can read, and its stored row
 * carries no model. Before this, the composer fell back to omp's catalog and
 * claimed a model the agent had never heard of; the live session's own selector
 * (or, after a restart, the last run's stream row) is the only truthful source.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loader } from '@/server/routes/chat/session';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { claimHarness } from '@/server/lib/harness/registry';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import type { HarnessSession } from '@/server/lib/harness/session';

/** The temp agent dir an on-disk transcript needs, since `findSessionFileById`
 *  resolves through the real sessions root. */
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const previousXdg = Bun.env.XDG_DATA_HOME;
let agentRoot = '';
let sessionsRoot = '';

beforeEach(async () => {
  agentRoot = await fs.promises.mkdtemp(join(tmpdir(), 'kabmo-acp-session-'));
  sessionsRoot = join(agentRoot, 'sessions');
  await fs.promises.mkdir(sessionsRoot, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agentRoot;
  // An existing XDG root redirects the sessions dir away from the temp one.
  delete Bun.env.XDG_DATA_HOME;
  clearSessionFileCaches();
  delete Bun.env.MOCK;
  await isolateDb();
});

afterEach(async () => {
  clearSessionFileCaches();
  await fs.promises.rm(agentRoot, { recursive: true, force: true });
  await releaseDb();
});

afterAll(() => {
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousXdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = previousXdg;
});

/** Write `<id>.jsonl` under the sessions root, with omp's own header line. */
async function writeSessionFile(id: string, entries: Array<Record<string, unknown>>): Promise<string> {
  const dir = join(sessionsRoot, 'project');
  await fs.promises.mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  const lines = [
    JSON.stringify({ type: 'session', id, cwd: '/work', timestamp: '2026-11-09T00:00:00.000Z' }),
    ...entries.map((entry) => JSON.stringify(entry)),
  ];
  await Bun.write(path, `${lines.join('\n')}\n`);
  clearSessionFileCaches();
  return path;
}

function registerAgent(id: string, state: Record<string, unknown>): () => void {
  let release: (() => void) | null = null;
  const session = {
    sessionId: id,
    harness: 'claude',
    sessionFile: '',
    cwd: '/tmp',
    isStreaming: false,
    isPromptRunning: false,
    runModel: null,
    capabilities: {},
    configOptions: [],
    isAlive: () => true,
    isRunning: () => false,
    isBusy: () => false,
    send: async (command: Record<string, unknown>) => (command.type === 'get_state' ? state : {}),
    getPendingUiDialogs: () => [],
    resolvePendingUiDialog: () => {},
    onEvent: () => () => {},
    emit: () => {},
    destroy: () => {},
    destroyAndWait: async () => {},
    onDestroy: (callback: () => void) => {
      release = callback;
    },
  };
  registerAcpSession(session as unknown as HarnessSession, id);
  claimHarness(session as unknown as HarnessSession, 'claude');
  return () => release?.();
}

function load(sessionId: string): Promise<Response> {
  return loader({
    request: new Request(`http://localhost/api/chat/${sessionId}`),
    params: { sessionId },
  } as never) as Promise<Response>;
}

describe('chat session loader on a live ACP chat', () => {
  test('reports the session model and thinking level from get_state', async () => {
    const release = registerAgent('acp-live-chat', {
      model: { provider: 'claude', id: 'opus' },
      thinkingLevel: 'high',
    });
    try {
      const body = (await (await load('acp-live-chat')).json()) as {
        session: { model?: { provider: string; modelId: string }; thinkingLevel?: string };
      };
      expect(body.session.model).toEqual({ provider: 'claude', modelId: 'opus' });
      expect(body.session.thinkingLevel).toBe('high');
    } finally {
      release();
    }
  });

  test('reports the selectors the LIVE session published, not a probe', async () => {
    // codex refuses a probe spawn while a chat is already running, yet that chat
    // offers its models — so the session's own lists are the only honest ones.
    const release = registerAgent('acp-live-selectors', {
      model: { provider: 'openai', id: 'gpt-5' },
      thinkingLevel: 'medium',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'gpt-5',
          options: [
            { value: 'gpt-5', name: 'GPT-5' },
            { value: 'gpt-5-mini', name: 'GPT-5 mini' },
          ],
        },
        {
          id: 'thought_level',
          name: 'Thinking',
          category: 'thought_level',
          currentValue: 'medium',
          options: [{ value: 'medium', name: 'Medium' }],
        },
      ],
    });
    try {
      const body = (await (await load('acp-live-selectors')).json()) as {
        session: {
          harness?: string;
          liveModels?: {
            models: { value: string; name: string }[];
            thinking?: { value: string; name: string }[];
          };
        };
      };
      expect(body.session.harness).toBe('claude');
      expect(body.session.liveModels).toEqual({
        models: [
          { value: 'gpt-5', name: 'GPT-5' },
          { value: 'gpt-5-mini', name: 'GPT-5 mini' },
        ],
        thinking: [{ value: 'medium', name: 'Medium' }],
      });
    } finally {
      release();
    }
  });

  /**
   * An ACP harness can own an on-disk transcript: omp's own ACP server writes
   * the same JSONL omp RPC does. The file branch used to return without the live
   * session's fields, so that tab published NO selectors — the picker for it
   * could only ever list a probe snapshot instead of the list the running agent
   * offers, and the composer named whatever model the file last recorded.
   */
  test('a live ACP chat with an on-disk transcript still publishes its own selectors', async () => {
    const id = 'acp-live-on-disk';
    const release = registerAgent(id, {
      model: { provider: 'claude', id: 'opus' },
      thinkingLevel: 'high',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'opus',
          options: [{ value: 'opus', name: 'Opus 5.5' }],
        },
      ],
    });
    try {
      await writeSessionFile(id, [
        { id: 'm1', parentId: null, type: 'model_change', model: 'omp/deepseek-v4.1-flash' },
        { id: 'm2', parentId: 'm1', type: 'thinking_level_change', thinkingLevel: 'low' },
        { id: 'm3', parentId: 'm2', type: 'message', message: { role: 'user', content: 'halo' } },
      ]);

      const body = (await (await load(id)).json()) as {
        session: {
          harness?: string;
          model?: { provider: string; modelId: string };
          thinkingLevel?: string;
          liveModels?: { models: { value: string; name: string }[] };
        };
        source?: string;
      };

      // The file-backed branch, and the live halves still win over the file's.
      expect(body.source).toBe('omp-jsonl');
      expect(body.session.harness).toBe('claude');
      expect(body.session.model).toEqual({ provider: 'claude', modelId: 'opus' });
      expect(body.session.thinkingLevel).toBe('high');
      expect(body.session.liveModels?.models).toEqual([{ value: 'opus', name: 'Opus 5.5' }]);
    } finally {
      release();
    }
  });

  test('once the live session is gone the file answers for it', async () => {
    const id = 'acp-dead-on-disk';
    await writeSessionFile(id, [
      { id: 'm1', parentId: null, type: 'model_change', model: 'claude/sonnet' },
      { id: 'm2', parentId: 'm1', type: 'thinking_level_change', thinkingLevel: 'medium' },
    ]);

    const body = (await (await load(id)).json()) as {
      session: { harness?: string; model?: { provider: string; modelId: string }; liveModels?: unknown };
    };
    expect(body.session.harness).toBeUndefined();
    expect(body.session.liveModels).toBeUndefined();
    expect(body.session.model).toEqual({ provider: 'claude', modelId: 'sonnet' });
  });
});
