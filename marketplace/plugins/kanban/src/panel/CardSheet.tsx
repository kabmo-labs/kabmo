/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The card sheet: the task composer, the resolved agent, and the session.
 *
 * It is a side sheet on a wide panel and a full-height one on a phone; the
 * difference is one class, so both layouts draw the same fields.
 *
 * Two rules are the whole point of this file:
 *
 * - **An inherited value says so.** Every picker renders the value that WON and
 *   the level it came from ("stage: in_progress"), because a board whose
 *   fallback chain is invisible makes an override impossible to reason about.
 * - **The stage prompt's delivery is stated.** omp appends it to its own system
 *   prompt at spawn; an ACP harness has no such field, so the text rides the
 *   first turn instead. A reader who is about to write "do not edit code" needs
 *   to know which of those they are getting.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { experimental_useSidebarThreadActions } from '@kabmo-labs/kabmo-ui';

import { MAX_IMAGES, type AgentOrigin, type Card, type ResolvedAgent, type Stage } from '../protocol';
import { resolveAgent } from '../store/resolve';
import type { WriteOutcome } from './use-writes';
import type { Catalogs } from './catalogs';

export interface CardSheetProps {
  card: Card;
  stages: Stage[];
  /** The board's defaults, for the resolution the sheet reports. */
  board: { defaults: Record<string, unknown>; stages: Stage[] };
  catalogs: Catalogs;
  /** The active chat, for "Link this chat". */
  activeSessionId: string | null;
  sessionState: 'running' | 'needs-you' | 'idle' | 'none';
  onClose: () => void;
  onSave: (patch: Record<string, unknown>, baseUpdatedAt: string) => Promise<WriteOutcome<unknown>>;
  onMove: (status: string, baseUpdatedAt: string) => Promise<WriteOutcome<unknown>>;
  onDelete: () => Promise<WriteOutcome<unknown>>;
  onStartWork: (card: Card, resolved: ResolvedAgent) => Promise<WriteOutcome<unknown>>;
  onLinkSession: (sessionId: string | null) => Promise<WriteOutcome<unknown>>;
}

/** How a picker names where its value came from. */
export function originLabel(origin: AgentOrigin, stage: Stage | undefined): string {
  if (origin === 'card') return 'this card';
  if (origin === 'stage') return stage ? `stage: ${stage.label}` : 'stage';
  if (origin === 'defaults') return 'board default';
  return 'host default';
}

/** The inherited-vs-overridden marker a picker shows. */
export function isOverridden(origin: AgentOrigin): boolean {
  return origin === 'card';
}

/** A stage's label by id, for the header. */
function stageLabel(stages: readonly Stage[], id: string): string {
  return stages.find((stage) => stage.id === id)?.label ?? id;
}

/** The card sheet. */
export function CardSheet(props: CardSheetProps) {
  const { card, stages, board, catalogs, activeSessionId, sessionState } = props;
  const [title, setTitle] = useState(card.title);
  const [prompt, setPrompt] = useState(card.task.prompt);
  const [priority, setPriority] = useState(card.priority);
  const [workspace, setWorkspace] = useState(card.workspace ?? '');
  const [harness, setHarness] = useState(card.task.agent?.harness ?? '');
  const [thinking, setThinking] = useState(card.task.agent?.thinking ?? '');
  const actions = experimental_useSidebarThreadActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The sheet follows the card: a write answered a fresh snapshot, and the
  // fields must not keep the previous card's text after a move.
  useEffect(() => {
    setTitle(card.title);
    setPrompt(card.task.prompt);
    setPriority(card.priority);
    setWorkspace(card.workspace ?? '');
    setHarness(card.task.agent?.harness ?? '');
    setThinking(card.task.agent?.thinking ?? '');
  }, [card]);

  const stage = stages.find((entry) => entry.id === card.status);
  const resolved = useMemo(() => resolveAgent(card, stage, board as never), [card, stage, board]);
  const models = catalogs.modelsFor(resolved.harness);
  const thinkingLevels = catalogs.thinkingFor(resolved.harness);
  const blocked = catalogs.blockedFor(resolved.harness);

  const run = async (label: string, work: () => Promise<WriteOutcome<unknown>>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    const outcome = await work();
    setBusy(null);
    if (outcome.ok) setNotice(`${label} saved.`);
    else setError(outcome.error);
  };

  const patch = () => {
    // Spread the card's EXISTING agent first: saving a title must not wipe a
    // model, an access mode or a skill filter the sheet has no input for.
    const agent: Record<string, unknown> = { ...(card.task.agent ?? {}) };
    if (harness) agent.harness = harness;
    else delete agent.harness;
    if (thinking) agent.thinking = thinking;
    else delete agent.thinking;
    return {
      title,
      priority,
      workspace: workspace.trim() || null,
      task: { prompt, ...(Object.keys(agent).length ? { agent } : {}) },
    };
  };

  const startDisabled = busy !== null || !card.workspace || !prompt.trim();

  return (
    <aside class="flex flex-col h-full min-h-0 w-full md:w-[420px] md:flex-none border-l border-ink/10 bg-paper">
      <header class="flex items-center gap-2 px-3 h-10 flex-none border-b border-ink/10">
        <span class="text-[10px] font-mono text-ink/45">{card.id}</span>
        <span class="text-xs text-ink/70 truncate">{stageLabel(stages, card.status)}</span>
        <span class="ml-auto text-[10px] font-mono text-ink/60">P{priority}</span>
        <button type="button" class="text-ink/50 hover:text-ink px-1" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>

      <div class="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-[10px] uppercase font-mono text-ink/40">Title</span>
          <input
            class="w-full rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
            value={title}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </label>

        <div class="flex gap-2">
          <label class="flex-1 flex flex-col gap-1">
            <span class="text-[10px] uppercase font-mono text-ink/40">Stage</span>
            <select
              class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
              value={card.status}
              onChange={(event) => void run('Stage', () => props.onMove(event.currentTarget.value, card.updatedAt))}
            >
              {stages.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label class="flex-1 flex flex-col gap-1">
            <span class="text-[10px] uppercase font-mono text-ink/40">Priority</span>
            <select
              class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
              value={String(priority)}
              onChange={(event) => setPriority(Number(event.currentTarget.value))}
            >
              {['P0 urgent', 'P1 high', 'P2 medium', 'P3 low', 'P4 backlog'].map((label, index) => (
                <option key={label} value={String(index)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] uppercase font-mono text-ink/40">Workspace</span>
          <input
            class="w-full rounded-md border border-ink/15 bg-paper px-2 py-1 text-[11px] font-mono text-ink"
            placeholder="absolute path, or empty for the global bucket"
            value={workspace}
            onInput={(event) => setWorkspace(event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] uppercase font-mono text-ink/40">Prompt — the task, like a queue message</span>
          <textarea
            class="w-full min-h-[96px] rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink resize-y"
            value={prompt}
            placeholder="What should the agent do?"
            onInput={(event) => setPrompt(event.currentTarget.value)}
          />
        </label>
        <span class="text-[10px] text-ink/40">
          {card.task.images.length} of {MAX_IMAGES} images · images are attached when work starts
        </span>

        <fieldset class="flex flex-col gap-2 border-t border-ink/10 pt-3">
          <legend class="text-[10px] uppercase font-mono text-ink/40">Agent</legend>
          <div class="flex gap-2">
            <label class="flex-1 flex flex-col gap-1">
              <span class="text-[10px] text-ink/45">Harness · {originLabel(resolved.origin.harness, stage)}</span>
              <select
                class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
                value={harness}
                onChange={(event) => setHarness(event.currentTarget.value)}
              >
                <option value="">inherit ({resolved.harness})</option>
                {catalogs.harnesses.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label class="flex-1 flex flex-col gap-1">
              <span class="text-[10px] text-ink/45">Thinking · {originLabel(resolved.origin.thinking, stage)}</span>
              <select
                class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
                value={thinking}
                onChange={(event) => setThinking(event.currentTarget.value)}
              >
                <option value="">inherit ({resolved.thinking ?? 'harness default'})</option>
                {thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p class="text-[10px] text-ink/40">
            Model: {resolved.model ? `${resolved.model.provider}/${resolved.model.modelId}` : 'host default'} ·{' '}
            {originLabel(resolved.origin.model, stage)} · {models.length} available
            {blocked ? ` · ${blocked}` : ''}
          </p>
          <p class="text-[10px] text-ink/40">
            Stage prompt: {resolved.prompt ? `${resolved.prompt.length} chars` : 'none'} ·{' '}
            {resolved.promptDelivery === 'appended' ? 'appended to omp’s system prompt' : 'prepended to the first turn'}
          </p>
        </fieldset>

        <fieldset class="flex flex-col gap-2 border-t border-ink/10 pt-3">
          <legend class="text-[10px] uppercase font-mono text-ink/40">Session</legend>
          {card.sessionId ? (
            <>
              <p class="text-[11px] font-mono text-ink/70">
                {card.sessionId.slice(0, 8)}… · {sessionState}
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="rounded-md border border-ink/15 px-2 py-1 text-[11px] text-ink"
                  onClick={() => {
                    if (card.sessionId) actions.open(card.sessionId);
                  }}
                >
                  Open chat
                </button>
                <button
                  type="button"
                  class="rounded-md border border-ink/15 px-2 py-1 text-[11px] text-ink"
                  disabled={busy !== null}
                  onClick={() => void run('Unlink', () => props.onLinkSession(null))}
                >
                  Unlink
                </button>
              </div>
            </>
          ) : (
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-md border border-ink/20 bg-ink/5 px-2 py-1 text-[11px] text-ink disabled:opacity-40"
                disabled={startDisabled}
                title={card.workspace ? undefined : 'Pick a workspace first'}
                onClick={() => void run('Start work', () => props.onStartWork(card, resolved))}
              >
                {busy === 'Start work' ? 'Starting…' : 'Start work'}
              </button>
              <button
                type="button"
                class="rounded-md border border-ink/15 px-2 py-1 text-[11px] text-ink disabled:opacity-40"
                disabled={!activeSessionId || busy !== null}
                onClick={() => void run('Link', () => props.onLinkSession(activeSessionId))}
              >
                Link this chat
              </button>
            </div>
          )}
        </fieldset>

        {error ? <p class="text-[11px] text-[var(--theme-error)]">{error}</p> : null}
        {notice ? <p class="text-[11px] text-ink/50">{notice}</p> : null}
      </div>

      <footer class="flex items-center gap-2 px-3 h-11 flex-none border-t border-ink/10">
        <button
          type="button"
          class="rounded-md border border-ink/20 bg-ink/5 px-2 py-1 text-[11px] text-ink disabled:opacity-40"
          disabled={busy !== null}
          onClick={() => void run('Card', () => props.onSave(patch(), card.updatedAt))}
        >
          {busy === 'Card' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          class="ml-auto rounded-md border border-ink/15 px-2 py-1 text-[11px] text-[var(--theme-error)]"
          disabled={busy !== null}
          onClick={() => void run('Delete', () => props.onDelete())}
        >
          Delete
        </button>
      </footer>
    </aside>
  );
}
