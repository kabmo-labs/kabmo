/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The argv Kabmo hands the omp binary, and the cwd it spawns it in.
 *
 * Split from the pure protocol constants (`@kabmo-labs/kabmo-omp-rpc-protocol`)
 * because this half touches the filesystem: it asks whether a recorded cwd still
 * exists and writes the title-model overlay before naming it. The contract half
 * is importable by a package; this half belongs to the app that owns the disk.
 */

import { homedir } from 'os';
import { pathExists } from '@kabmo-labs/kabmo-omp-paths';
import { kabmoExtensionArgs } from '@kabmo-labs/kabmo-omp-extensions';
import type { ApprovalMode } from '@kabmo-labs/kabmo-omp-access-mode';
import type { SelectedModel } from '@kabmo-labs/kabmo-model-contracts/models';
import type { SessionPromptArgs } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';
import { ensureTitleModelOverlay, titleModelOverlayPath } from '@kabmo-labs/kabmo-omp-session-runtime/title-model-overlay.server';

export type { SessionPromptArgs };

/** Pick a spawn cwd that actually exists. A session records the directory it
 * was created in, but that directory may have been deleted since: spawn()
 * would fail with ENOENT and `omp --cwd <missing>` throws in setProjectDir. */
export async function resolveSpawnCwd(recordedCwd?: string | null): Promise<string> {
  if (recordedCwd && (await pathExists(recordedCwd))) return recordedCwd;
  try {
    const serverCwd = process.cwd();
    if (serverCwd && (await pathExists(serverCwd))) return serverCwd;
  } catch {
    // process.cwd() itself throws when the server's own cwd was removed.
  }
  return homedir();
}

/** Extra CLI args for spawning `omp --mode rpc-ui` for a session.
 *
 *  `-e <extensions/kabmo-modes/index.ts>` is always appended when the file is
 *  present: Kabmo's plan/goal toggles are driven from inside the child
 *  (omp has no RPC verb for either mode), so the extension is not optional
 *  equipment for a session that happens to have a mode on — it is how the
 *  composer's controls reach the agent at all.
 *
 *  `--config <overlay>` points the child at Kabmo's title-model overlay,
 *  which exists (empty) before this runs. It is how a session's own model
 *  reaches omp's title generation: the child watches that path, so
 *  `rename-with-ai` rewrites the `tiny` role for the duration of one request.
 *  See `session/title-model-overlay.server.ts`. */
export function buildSessionSpawnArgs(
  sessionFile: string,
  approvalMode?: ApprovalMode,
  resumeModel?: SelectedModel,
  promptArgs?: SessionPromptArgs,
): string[] {
  const args: string[] = [];
  ensureTitleModelOverlay();
  args.push('--config', titleModelOverlayPath());
  if (sessionFile) {
    // An absolute path resolves deterministically: omp's createSessionManager
    // opens it directly via SessionManager.open without any interactive
    // resume/fork prompts.
    args.push('--resume', sessionFile);
  }
  // The model the session is RESTORED with. omp restores the model its
  // transcript's last `model_change` names, and it does NOT fall back when
  // that model is no longer in the registry: the child exits(1) with
  // "Could not restore model <provider>/<id>" and every command to the
  // session fails with it. `--model` names a model that DOES resolve, so a
  // session whose recorded model is gone still starts.
  if (resumeModel?.provider && resumeModel.modelId) {
    args.push('--model', `${resumeModel.provider}/${resumeModel.modelId}`);
  }
  if (approvalMode) {
    // Spawn-time only: omp exposes no RPC command to change the tool-approval
    // mode, so the flag is the sole lever. It works with or without --resume.
    args.push('--approval-mode', approvalMode);
  }
  // A stage's system prompt is APPENDED, not substituted: omp's own coding
  // prompt carries the tool contract, and replacing it is how an agent stops
  // using its tools correctly. Measured on omp 19.1.0: both flags are accepted
  // in `--mode rpc-ui` and the child reaches `ready`.
  if (promptArgs?.systemPrompt) {
    args.push('--append-system-prompt', promptArgs.systemPrompt);
  }
  if (promptArgs?.skills && promptArgs.skills.length > 0) {
    args.push(`--skills=${promptArgs.skills.join(',')}`);
  }
  args.push(...kabmoExtensionArgs());
  return args;
}
