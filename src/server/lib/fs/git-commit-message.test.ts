/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  generateCommitMessage,
  resolveCommitMessageTarget,
  type CommitMessageDeps,
  type CommitMessageSettings,
} from '@/server/lib/fs/git-commit-message.server';

const SETTINGS: CommitMessageSettings = { mode: 'auto', harness: '', model: '', prompt: '' };

const DEPS: CommitMessageDeps = {
  readModelRoles: async () => ({ path: '', roles: { tiny: 'p/tiny' } }),
  loadHarnessSession: async (id) => (id === 's1'
    ? { sessionId: 's1', harness: 'claude', agentSessionId: '', cwd: '/ws' }
    : null),
  loadHarnessConfig: async () => ({
    command: '',
    env: '',
    provider: '',
    model: 'anthropic/claude-sonnet',
    thinking: '',
    mode: '',
  }),
  harnessProbeModels: async () => [{ value: 'anthropic/claude-sonnet', name: 'Sonnet' }],
  readContext: async () => ({
    branch: 'main',
    files: ['a.ts'],
    diff: '+a',
    recentCommits: ['base'],
    truncated: false,
    amend: false,
  }),
  runOmp: async () => ({ ok: true, text: 'feat: add a' }),
  runAcp: async () => ({ ok: true, text: 'fix: correct b' }),
};

describe('resolveCommitMessageTarget', () => {
  test('off has no target', async () => {
    expect(await resolveCommitMessageTarget({ ...SETTINGS, mode: 'off' }, null, DEPS)).toBeNull();
  });

  test('omp uses the explicit model, else the tiny role', async () => {
    expect(await resolveCommitMessageTarget({ ...SETTINGS, mode: 'omp', model: 'x/y' }, null, DEPS))
      .toEqual({ kind: 'omp', harness: 'omp-rpc', model: 'x/y' });
    expect(await resolveCommitMessageTarget({ ...SETTINGS, mode: 'omp' }, null, DEPS))
      .toEqual({ kind: 'omp', harness: 'omp-rpc', model: 'p/tiny' });
  });

  test('omp prefers the commit role over tiny', async () => {
    const target = await resolveCommitMessageTarget(
      { ...SETTINGS, mode: 'omp' },
      null,
      {
        ...DEPS,
        readModelRoles: async () => ({ path: '', roles: { commit: 'p/commit', tiny: 'p/tiny' } }),
      },
    );
    expect(target).toEqual({ kind: 'omp', harness: 'omp-rpc', model: 'p/commit' });
  });

  test('harness pins an ACP agent, and refuses an unknown id', async () => {
    expect(await resolveCommitMessageTarget({ ...SETTINGS, mode: 'harness', harness: 'claude', model: 'a/b' }, null, DEPS))
      .toEqual({ kind: 'acp', harness: 'claude', model: 'a/b' });
    expect(await resolveCommitMessageTarget({ ...SETTINGS, mode: 'harness', harness: 'nope' }, null, DEPS))
      .toBeNull();
  });

  test('auto follows the active chat, and falls back to omp without one', async () => {
    expect(await resolveCommitMessageTarget(SETTINGS, 's1', DEPS))
      .toEqual({ kind: 'acp', harness: 'claude', model: null });
    expect(await resolveCommitMessageTarget(SETTINGS, 's2', DEPS))
      .toEqual({ kind: 'omp', harness: 'omp-rpc', model: 'p/tiny' });
    expect(await resolveCommitMessageTarget(SETTINGS, null, DEPS))
      .toEqual({ kind: 'omp', harness: 'omp-rpc', model: 'p/tiny' });
  });
});

describe('generateCommitMessage', () => {
  test('returns the omp answer', async () => {
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'omp' } },
      DEPS,
    );
    expect(result).toEqual({
      ok: true,
      message: 'feat: add a',
      target: { kind: 'omp', harness: 'omp-rpc', model: 'p/tiny' },
    });
  });

  test('maps a missing omp binary to an actionable 409', async () => {
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'omp' } },
      { ...DEPS, runOmp: async () => ({ ok: false, reason: 'no-binary' }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('omp_missing');
    }
  });

  test('refuses an empty change set before calling a model', async () => {
    let called = false;
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'omp' } },
      {
        ...DEPS,
        readContext: async () => ({
          branch: 'main',
          files: [],
          diff: '',
          recentCommits: [],
          truncated: false,
          amend: false,
        }),
        runOmp: async () => {
          called = true;
          return { ok: true, text: 'feat: x' };
        },
      },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('nothing_staged');
  });

  test('runs the ACP one-shot with the harness default model', async () => {
    const seen: Array<{ provider: string; modelId: string } | null> = [];
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'harness', harness: 'claude' } },
      {
        ...DEPS,
        runAcp: async (request) => {
          seen.push(request.model);
          return { ok: true, text: 'fix: correct b' };
        },
      },
    );
    expect(seen).toEqual([{ provider: 'anthropic', modelId: 'anthropic/claude-sonnet' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe('fix: correct b');
  });

  test('maps an empty ACP reply to a 502', async () => {
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'harness', harness: 'claude' } },
      { ...DEPS, runAcp: async () => ({ ok: false, reason: 'no-reply' }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.code).toBe('empty_reply');
    }
  });

  test('off refuses before reading the repository', async () => {
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'off' } },
      DEPS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('commit_message_off');
  });

  test('a harness mode with no harness names the setting to fix', async () => {
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'harness', harness: '' } },
      DEPS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('commit_harness_missing');
    }
  });

  test('a custom prompt without {{diff}} is refused', async () => {
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'omp', prompt: 'Write a commit message.' } },
      DEPS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('prompt_missing_diff');
    }
  });

  test('a custom prompt with {{diff}} is sent to the model', async () => {
    const prompts: string[] = [];
    const result = await generateCommitMessage(
      { targetDir: '/ws', settings: { ...SETTINGS, mode: 'omp', prompt: 'CUSTOM MARKER\n\n{{diff}}' } },
      {
        ...DEPS,
        runOmp: async (request) => {
          prompts.push(request.prompt);
          return { ok: true, text: 'feat: x' };
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(prompts[0]).toContain('CUSTOM MARKER');
    expect(prompts[0]).toContain('+a');
  });
});
