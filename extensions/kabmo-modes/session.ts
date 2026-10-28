/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Live-session access for Kabmo's mode extension.
 *
 * omp exposes no RPC verb for plan or goal mode — the command union has none,
 * `mode_change` entries are not restored under `--mode rpc-ui`, and
 * `plan.defaultOnStartup` is read only by the interactive TUI. An extension
 * loaded into the child process is the one surface that reaches the live
 * `AgentSession`, and it reaches it through `AgentRegistry.global()`: the
 * registry holds the entry for the session this process is running, whose
 * `session` field is the very object the TUI drives.
 *
 * Every call is feature-detected. `setPlanModeState` / `getGoalModeState` /
 * `goalRuntime` are not part of omp's public extension contract, so a build
 * that renames or drops one must degrade to a reported refusal rather than a
 * half-enabled toggle that silently does nothing.
 *
 * All omp types here are structural and optional: the extension is loaded by a
 * child process that may be older or newer than the one this was written
 * against, so every field is `?` and every call site checks before invoking.
 */

import { KABMO_PLAN_STATE_ENTRY } from './protocol';

/** Minimal shape of the fields this module touches. */
export interface ModeSession {
  getPlanModeState?(): { enabled: boolean; planFilePath: string; workflow?: string } | undefined;
  setPlanModeState?(state: { enabled: boolean; planFilePath: string; workflow?: string } | undefined): void;
  setPlanProposalHandler?(handler: ((title: string) => Promise<unknown>) | null): void;
  getPlanReferencePath?(): string;
  setPlanReferencePath?(path: string): void;
  /** omp's own plan validation: normalizes the model-supplied title and
   *  resolves the plan file the proposal names. */
  preparePlanForReview?(title: string): Promise<{ details: { planFilePath: string; title: string; planExists: boolean } }>;
  getGoalModeState?(): { enabled: boolean; goal: { id: string; status: string; objective: string } } | undefined;
  goalRuntime?: {
    createGoal(input: { objective: string; tokenBudget?: number }): Promise<unknown>;
    resumeGoal(): Promise<unknown>;
    pauseGoal(): Promise<unknown>;
    dropGoal(): Promise<unknown>;
    onBudgetMutated(budget: number | undefined): Promise<unknown>;
  };
  getEnabledToolNames?(): string[];
  setActiveToolsByName?(names: string[]): Promise<void>;
  compact?(instructions?: string, options?: unknown): Promise<unknown>;
  prompt?(text: string, options?: Record<string, unknown>): Promise<unknown>;
  sessionManager?: {
    getSessionId?(): string;
    getSessionFile?(): string | null;
    appendModeChange?(mode: string, data?: unknown): string;
  };
  isStreaming?: boolean;
}

/** The extension API surface this module uses. Loose by design: the shape is
 *  omp's, and a narrow local interface would need editing on every upstream
 *  addition. */
export interface ModeApi {
  /** Append a non-LLM custom entry to the session branch (persistence only). */
  pi?: {
    AgentRegistry?: {
      global?(): { list?(): Array<{ id?: string; parentId?: string; session?: ModeSession }> };
    };
  };
  getActiveTools?(): string[];
  setActiveTools?(names: string[]): Promise<void>;
  sendMessage?<T = unknown>(
    message: { customType: string; content: string; display?: boolean; details?: T },
    options?: { triggerTurn?: boolean; deliverAs?: string },
  ): void;
  appendEntry?<T = unknown>(customType: string, data?: T): void;
  on?(event: string, handler: (event: unknown, ctx: ExtensionCtx) => unknown): void;
  registerCommand?(name: string, options: { description?: string; handler: (args: string, ctx: ExtensionCtx) => Promise<void> | void }): void;
}

/** The slice of omp's extension context the mode commands read. */
export interface ExtensionCtx {
  ui?: {
    notify?(message: string, type?: string): void;
    select?(title: string, options: string[]): Promise<string | undefined>;
    editor?(title: string, prefill?: string): Promise<string | undefined>;
  };
  cwd?: string;
  /** The session's `local://` root mapping, needed to read a plan artifact. */
  localProtocolOptions?: unknown;
  /** Start a new session (command context only). */
  newSession?(options?: { parentSession?: string }): Promise<{ cancelled: boolean }>;
  /** Compact the session context (command context only). */
  compact?(instructionsOrOptions?: string): Promise<void>;
  sessionManager?: { getSessionId?(): string; getSessionFile?(): string | null };
}

/**
 * The extension API instance, bound once at load.
 *
 * The registry lives on `api.pi.AgentRegistry`, so every helper needs the API
 * object rather than a session — but the session itself is resolved per call,
 * because the registry entry is created during session start and a value
 * captured at load time would be undefined.
 */
let boundApi: ModeApi | null = null;

export function bindApi(api: ModeApi): void {
  boundApi = api;
}

export function getBoundApi(): ModeApi | null {
  return boundApi;
}

/**
 * The live session for this process.
 *
 * A subagent's registry entry carries a `parentId`; the top-level session is
 * the one without it, and it is the one whose mode flags this feature owns.
 * Falling back to the first entry keeps a single-entry registry (the common
 * case) working even if omp stops stamping `parentId`.
 */
export function activeSession(api: ModeApi): ModeSession | undefined {
  const registry = api.pi?.AgentRegistry?.global?.();
  const entries = registry?.list?.() ?? [];
  const top = entries.find((entry) => !entry.parentId) ?? entries[0];
  return top?.session;
}

/** Whether the installed omp build exposes everything a mode toggle needs. */
export function modeCapabilities(session: ModeSession | undefined): { plan: boolean; goal: boolean } {
  if (!session) return { plan: false, goal: false };
  const plan =
    typeof session.setPlanModeState === 'function' &&
    typeof session.getPlanModeState === 'function' &&
    typeof session.setPlanProposalHandler === 'function';
  const goal =
    typeof session.getGoalModeState === 'function' && typeof session.goalRuntime?.createGoal === 'function';
  return { plan, goal };
}

/**
 * Add `goal` to the active tool set when it is missing.
 *
 * `goal` is a HIDDEN tool: it lives in omp's `HIDDEN_TOOLS`, is excluded from
 * `BUILTIN_TOOL_NAMES`, and `isToolAllowed` refuses it unless goal mode is
 * already active — so `--tools goal` cannot force it and neither can a settings
 * write. `setActiveTools` is the only lever, and omp registers the tool lazily
 * on demand (`ensureGoalRegistered`).
 */
export async function ensureGoalTool(api: ModeApi, session: ModeSession): Promise<boolean> {
  const current = session.getEnabledToolNames?.() ?? api.getActiveTools?.() ?? [];
  if (current.includes('goal')) return true;
  if (typeof api.setActiveTools !== 'function') return false;
  await api.setActiveTools([...current, 'goal']);
  return true;
}

/**
 * Enter plan mode the way the TUI does: publish the state BEFORE widening the
 * tool set, because plan mode's read-only guarantee is enforced by the built-in
 * write/edit guard reading exactly that state — and the model needs `write` to
 * draft its plan file and to submit it through `xd://propose`.
 */
export async function enterPlanMode(session: ModeSession, planFilePath: string): Promise<boolean> {
  if (typeof session.setPlanModeState !== 'function') return false;
  const previous = session.getEnabledToolNames?.() ?? [];
  session.setPlanModeState({ enabled: true, planFilePath, workflow: 'parallel' });
  if (typeof session.setActiveToolsByName === 'function') {
    try {
      await session.setActiveToolsByName([...new Set([...previous, 'write'])]);
    } catch (error) {
      session.setPlanModeState(undefined);
      throw error;
    }
  }
  session.sessionManager?.appendModeChange?.('plan', { planFilePath });
  return true;
}

/** Leave plan mode. Clears the proposal handler first so a late `xd://propose`
 *  cannot reach a handler whose review surface is gone. */
export function exitPlanMode(session: ModeSession): void {
  session.setPlanProposalHandler?.(null);
  session.setPlanModeState?.(undefined);
  session.sessionManager?.appendModeChange?.('none');
}

/**
 * Persist the plan-mode flag on the session branch.
 *
 * Plan mode has no omp-side event to mirror (unlike goal mode, whose every
 * transition arrives as `goal_updated`), so Kabmo's own transition is
 * what gets recorded. The record is what a respawned child reads to restore the
 * toggle, and what the console reads after a reload.
 */
export function recordPlanState(api: ModeApi, enabled: boolean): void {
  api.appendEntry?.(KABMO_PLAN_STATE_ENTRY, { enabled });
}
