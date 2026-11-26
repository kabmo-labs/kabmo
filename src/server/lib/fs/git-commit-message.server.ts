/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Generate a commit message from the staged change set, through the agent the
 * user actually runs.
 *
 * The target is a HARNESS, not a provider. An ACP user (Claude Code, Codex,
 * opencode) authenticates through the agent's own CLI or subscription; Kabmo
 * holds no API key for it, and a direct provider call would answer 401. The
 * one-shot helpers already used by the goal auditor are the transport:
 * `omp -p --no-session --no-tools` for omp, a disposable ACP session for every
 * other harness.
 *
 * `auto` follows the active chat's harness and falls back to omp when there is
 * no chat. It is deterministic, not a fallback chain: a chosen harness that
 * cannot start reports its own failure instead of silently answering from a
 * different model.
 */

import { readModelRoles } from '@kabmo-labs/kabmo-omp/config-doc/roles';
import { loadHarnessSession } from '@kabmo-labs/kabmo-harness/session/session-store.server';
import { loadHarnessConfig } from '@kabmo-labs/kabmo-harness/config-store/config.server';
import { harnessProbeModels } from '@kabmo-labs/kabmo-harness/config-store/probe-cache.server';
import { modelProvider, resolveDefaultModel } from '@kabmo-labs/kabmo-harness/config';
import { harnessDescriptor, type HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { validateCommitPrompt } from '@/shared/lib/git/commit-prompt';
import { runOmpPrint, type OmpPrintOutcome } from '@kabmo-labs/kabmo-omp/install/print.server';
import { runAcpOneShot, type AcpOneShotOutcome } from '@kabmo-labs/kabmo-acp/session-core/one-shot.server';
import { limitCommitContext, readCommitContext } from '@/server/lib/fs/git-commit-context';
import { buildCommitMessagePrompt, cleanCommitMessage } from '@/server/lib/fs/git-commit-prompt';

export type CommitMessageMode = 'auto' | 'omp' | 'harness' | 'off';

export interface CommitMessageSettings {
  mode: CommitMessageMode;
  /** Harness id for `harness` mode; empty means none. */
  harness: string;
  /** `provider/model` override; empty means the target's default. */
  model: string;
  /** Custom prompt template; empty means the built-in one. */
  prompt: string;
}

export interface CommitMessageTarget {
  kind: 'omp' | 'acp';
  harness: HarnessId;
  /** The omp selector or the ACP `provider/model` value, when one is pinned. */
  model: string | null;
}

export type CommitMessageResult =
  | { ok: true; message: string; target: CommitMessageTarget }
  | { ok: false; status: number; error: string; code?: string };

export interface GenerateCommitMessageRequest {
  targetDir: string;
  sessionId?: string | null;
  amend?: boolean;
  settings: CommitMessageSettings;
}

/** Test seams: the target lookup and the two transports. */
export interface CommitMessageDeps {
  loadHarnessSession?: typeof loadHarnessSession;
  readModelRoles?: typeof readModelRoles;
  loadHarnessConfig?: typeof loadHarnessConfig;
  harnessProbeModels?: typeof harnessProbeModels;
  readContext?: typeof readCommitContext;
  runOmp?: typeof runOmpPrint;
  runAcp?: typeof runAcpOneShot;
}

async function ompModel(deps: CommitMessageDeps): Promise<string | null> {
  const { roles } = await (deps.readModelRoles ?? readModelRoles)();
  return roles.commit?.trim() || roles.tiny?.trim() || roles.default?.trim() || null;
}

async function acpModel(
  harness: HarnessId,
  override: string,
  deps: CommitMessageDeps,
): Promise<{ provider: string; modelId: string } | null> {
  const value = override.trim()
    || resolveDefaultModel(
      await (deps.loadHarnessConfig ?? loadHarnessConfig)(harness),
      await (deps.harnessProbeModels ?? harnessProbeModels)(harness),
    );
  if (!value) return null;
  return { provider: modelProvider(value), modelId: value };
}

export async function resolveCommitMessageTarget(
  settings: CommitMessageSettings,
  sessionId?: string | null,
  deps: CommitMessageDeps = {},
): Promise<CommitMessageTarget | null> {
  if (settings.mode === 'off') return null;

  if (settings.mode === 'omp') {
    return { kind: 'omp', harness: 'omp-rpc', model: settings.model.trim() || await ompModel(deps) };
  }

  if (settings.mode === 'harness') {
    const harness = settings.harness.trim();
    if (!harness || !harnessDescriptor(harness)) return null;
    if (harness === 'omp-rpc') {
      return { kind: 'omp', harness: 'omp-rpc', model: settings.model.trim() || await ompModel(deps) };
    }
    return { kind: 'acp', harness, model: settings.model.trim() || null };
  }

  // auto: the chat the user is in decides the agent; no chat means omp.
  if (sessionId) {
    const row = await (deps.loadHarnessSession ?? loadHarnessSession)(sessionId);
    const harness = row?.harness && harnessDescriptor(row.harness) ? row.harness as HarnessId : null;
    if (harness && harness !== 'omp-rpc') {
      return { kind: 'acp', harness, model: settings.model.trim() || null };
    }
  }
  return { kind: 'omp', harness: 'omp-rpc', model: settings.model.trim() || await ompModel(deps) };
}

function ompFailure(outcome: Extract<OmpPrintOutcome, { ok: false }>): CommitMessageResult {
  switch (outcome.reason) {
    case 'no-binary':
      return {
        ok: false,
        status: 409,
        error: 'omp is not installed. Pick a harness in Settings → Chats → Commit messages.',
        code: 'omp_missing',
      };
    case 'timeout':
      return { ok: false, status: 504, error: 'The commit message model timed out.', code: 'timeout' };
    case 'exit':
      return {
        ok: false,
        status: 502,
        error: `omp could not generate a commit message${outcome.detail ? `: ${outcome.detail}` : '.'}`,
        code: 'model_failed',
      };
    default:
      return { ok: false, status: 500, error: 'Could not start omp.', code: 'spawn_failed' };
  }
}

function acpFailure(
  harness: HarnessId,
  outcome: Extract<AcpOneShotOutcome, { ok: false }>,
): CommitMessageResult {
  const label = harnessDescriptor(harness)?.label ?? harness;
  switch (outcome.reason) {
    case 'launch':
      return {
        ok: false,
        status: 409,
        error: `${label} cannot start. Check Settings → Harnesses.`,
        code: 'harness_unavailable',
      };
    case 'timeout':
      return {
        ok: false,
        status: 504,
        error: `${label} timed out while writing the commit message.`,
        code: 'timeout',
      };
    case 'no-reply':
      return {
        ok: false,
        status: 502,
        error: `${label} did not return a commit message.`,
        code: 'empty_reply',
      };
    default:
      return {
        ok: false,
        status: 502,
        error: `${label} could not generate a commit message.`,
        code: 'model_failed',
      };
  }
}

export async function generateCommitMessage(
  request: GenerateCommitMessageRequest,
  deps: CommitMessageDeps = {},
): Promise<CommitMessageResult> {
  const target = await resolveCommitMessageTarget(request.settings, request.sessionId, deps);
  if (!target) {
    const off = request.settings.mode === 'off';
    return {
      ok: false,
      status: 409,
      error: off
        ? 'Commit message generation is off. Choose a model in Settings → Chats → Commit messages.'
        : 'Choose a harness in Settings → Chats → Commit messages.',
      code: off ? 'commit_message_off' : 'commit_harness_missing',
    };
  }

  const context = limitCommitContext(
    await (deps.readContext ?? readCommitContext)(request.targetDir, request.amend === true),
  );
  if (context.files.length === 0 && !context.diff.trim()) {
    return {
      ok: false,
      status: 409,
      error: request.amend ? 'There is no commit to amend.' : 'Stage changes first.',
      code: 'nothing_staged',
    };
  }

  const customPrompt = request.settings.prompt.trim();
  if (customPrompt) {
    const validation = validateCommitPrompt(customPrompt);
    if (!validation.ok) {
      return { ok: false, status: 409, error: validation.error, code: 'prompt_missing_diff' };
    }
  }

  const prompt = buildCommitMessagePrompt(context, customPrompt);

  if (target.kind === 'omp') {
    const outcome = await (deps.runOmp ?? runOmpPrint)({
      prompt,
      cwd: request.targetDir,
      ...(target.model ? { model: target.model } : {}),
    });
    if (!outcome.ok) return ompFailure(outcome);
    const message = cleanCommitMessage(outcome.text);
    if (!message) {
      return { ok: false, status: 502, error: 'The model returned an empty commit message.', code: 'empty_reply' };
    }
    return { ok: true, message, target };
  }

  const outcome = await (deps.runAcp ?? runAcpOneShot)({
    harness: target.harness,
    cwd: request.targetDir,
    model: await acpModel(target.harness, target.model ?? '', deps),
    prompt,
  });
  if (!outcome.ok) return acpFailure(target.harness, outcome);
  const message = cleanCommitMessage(outcome.text);
  if (!message) {
    return { ok: false, status: 502, error: 'The agent returned an empty commit message.', code: 'empty_reply' };
  }
  return { ok: true, message, target };
}
