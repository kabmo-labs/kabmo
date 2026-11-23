/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stages sheet: what each lane DOES, not just what it is called.
 *
 * A stage owns three facts the rest of the board obeys — whether it runs a
 * session, what agent a card landing there uses, and the system prompt that
 * agent gets. The last two are why this sheet exists at all: decision 6 and 7 are
 * configuration, and configuration that can only be edited by hand-editing
 * `board.json` is not a feature.
 *
 * Every field left on "inherit" falls back to the board's defaults and then to
 * the host, and the sheet says which level supplied the value it is showing.
 */

import { useState } from 'preact/hooks';

import { MAX_PROMPT_CHARS, type AgentSpec, type Board, type Stage } from '../protocol';
import type { Catalogs } from './catalogs';
import type { WriteOutcome } from './use-writes';

export interface StageSheetProps {
  board: Board;
  catalogs: Catalogs;
  onClose: () => void;
  onSave: (stages: Stage[]) => Promise<WriteOutcome<unknown>>;
  onSaveDefaults: (defaults: Record<string, unknown>) => Promise<WriteOutcome<unknown>>;
}

/** A spec's own text, for the form fields. Every field is a STRING: empty means inherit. */
interface SpecText {
  harness: string;
  thinking: string;
  access: string;
  prompt: string;
  model: string;
}

function specOf(stage: Stage): SpecText {
  return {
    harness: stage.agent?.harness ?? '',
    thinking: stage.agent?.thinking ?? '',
    access: stage.agent?.access ?? '',
    prompt: stage.agent?.prompt ?? '',
    model: stage.agent?.model ? `${stage.agent.model.provider}/${stage.agent.model.modelId}` : '',
  };
}

/** The stages sheet. */
export function StageSheet({ board, catalogs, onClose, onSave, onSaveDefaults }: StageSheetProps) {
  const [drafts, setDrafts] = useState<Stage[]>(board.stages.map((stage) => ({ ...stage })));
  const [defaults, setDefaults] = useState<Record<string, unknown>>({ ...board.defaults });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const edit = (id: string, change: (stage: Stage) => Stage) => {
    setDrafts((current) => current.map((stage) => (stage.id === id ? change(stage) : stage)));
  };

  const setAgentField = (id: string, key: 'harness' | 'thinking' | 'access' | 'prompt', value: string) => {
    edit(id, (stage) => {
      const agent: AgentSpec = { ...(stage.agent ?? {}) };
      if (value) {
        if (key === 'prompt') agent.prompt = value;
        else if (key === 'harness') agent.harness = value;
        else if (key === 'thinking') agent.thinking = value;
        else agent.access = value;
      } else if (key === 'prompt') delete agent.prompt;
      else if (key === 'harness') delete agent.harness;
      else if (key === 'thinking') delete agent.thinking;
      else delete agent.access;
      return { ...stage, ...(Object.keys(agent).length ? { agent } : { agent: undefined }) };
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const cleaned = drafts.map((stage) => ({ ...stage, agent: stage.agent && Object.keys(stage.agent).length ? stage.agent : undefined }));
    const stagesOutcome = await onSave(cleaned);
    if (!stagesOutcome.ok) {
      setBusy(false);
      setError(stagesOutcome.error);
      return;
    }
    const defaultsOutcome = await onSaveDefaults(defaults);
    setBusy(false);
    if (!defaultsOutcome.ok) setError(defaultsOutcome.error);
    else setNotice('Stages saved.');
  };

  return (
    <aside class="flex flex-col h-full min-h-0 w-full md:w-[460px] md:flex-none border-l border-ink/10 bg-paper">
      <header class="flex items-center gap-2 px-3 h-10 flex-none border-b border-ink/10">
        <span class="text-xs font-medium text-ink">Stages</span>
        <span class="text-[10px] text-ink/45">a hidden stage with cards keeps showing</span>
        <button type="button" class="ml-auto text-ink/50 hover:text-ink px-1" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div class="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        <fieldset class="flex flex-col gap-2">
          <legend class="text-[10px] uppercase font-mono text-ink/40">Board defaults</legend>
          <label class="flex flex-col gap-1">
            <span class="text-[10px] text-ink/45">Harness</span>
            <select
              class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
              value={typeof defaults.harness === 'string' ? defaults.harness : ''}
              onChange={(event) => setDefaults({ ...defaults, harness: event.currentTarget.value || undefined })}
            >
              <option value="">host default (omp-rpc)</option>
              {catalogs.harnesses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[10px] text-ink/45">System prompt every stage inherits</span>
            <textarea
              class="w-full min-h-[64px] rounded-md border border-ink/15 bg-paper px-2 py-1 text-[11px] text-ink resize-y"
              maxLength={MAX_PROMPT_CHARS}
              value={typeof defaults.prompt === 'string' ? defaults.prompt : ''}
              onInput={(event) => setDefaults({ ...defaults, prompt: event.currentTarget.value || undefined })}
            />
          </label>
        </fieldset>

        {drafts.map((stage) => {
          const spec = specOf(stage);
          return (
            <fieldset key={stage.id} class="flex flex-col gap-2 border-t border-ink/10 pt-3">
              <legend class="text-[10px] uppercase font-mono text-ink/40">{stage.id}</legend>
              <div class="flex gap-2 items-end">
                <label class="flex-1 flex flex-col gap-1">
                  <span class="text-[10px] text-ink/45">Label</span>
                  <input
                    class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
                    value={stage.label}
                    onInput={(event) => {
                      const label = event.currentTarget.value;
                      edit(stage.id, (entry) => ({ ...entry, label }));
                    }}
                  />
                </label>
                <label class="flex items-center gap-1 text-[11px] text-ink/60">
                  <input
                    type="checkbox"
                    checked={stage.hidden}
                    onChange={(event) => {
                      const hidden = event.currentTarget.checked;
                      edit(stage.id, (entry) => ({ ...entry, hidden }));
                    }}
                  />
                  hidden
                </label>
                <label class="flex items-center gap-1 text-[11px] text-ink/60">
                  <input
                    type="checkbox"
                    checked={stage.session}
                    onChange={(event) => {
                      const session = event.currentTarget.checked;
                      edit(stage.id, (entry) => ({ ...entry, session }));
                    }}
                  />
                  runs a session
                </label>
              </div>

              <div class="flex gap-2">
                <label class="flex-1 flex flex-col gap-1">
                  <span class="text-[10px] text-ink/45">Harness</span>
                  <select
                    class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
                    value={spec.harness}
                    onChange={(event) => setAgentField(stage.id, 'harness', event.currentTarget.value)}
                  >
                    <option value="">inherit</option>
                    {catalogs.harnesses.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="flex-1 flex flex-col gap-1">
                  <span class="text-[10px] text-ink/45">Thinking</span>
                  <input
                    class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
                    placeholder="inherit"
                    value={spec.thinking}
                    onInput={(event) => setAgentField(stage.id, 'thinking', event.currentTarget.value)}
                  />
                </label>
                <label class="flex-1 flex flex-col gap-1">
                  <span class="text-[10px] text-ink/45">Access</span>
                  <select
                    class="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink"
                    value={spec.access}
                    onChange={(event) => setAgentField(stage.id, 'access', event.currentTarget.value)}
                  >
                    <option value="">inherit</option>
                    <option value="always-ask">always-ask</option>
                    <option value="write">write</option>
                    <option value="yolo">yolo</option>
                  </select>
                </label>
              </div>

              <label class="flex flex-col gap-1">
                <span class="text-[10px] text-ink/45">
                  System prompt — appended on omp-rpc, prepended on an ACP harness
                </span>
                <textarea
                  class="w-full min-h-[72px] rounded-md border border-ink/15 bg-paper px-2 py-1 text-[11px] text-ink resize-y"
                  maxLength={MAX_PROMPT_CHARS}
                  value={spec.prompt}
                  placeholder="Leave empty to inherit."
                  onInput={(event) => setAgentField(stage.id, 'prompt', event.currentTarget.value)}
                />
              </label>
            </fieldset>
          );
        })}

        {error ? <p class="text-[11px] text-[var(--theme-error)]">{error}</p> : null}
        {notice ? <p class="text-[11px] text-ink/50">{notice}</p> : null}
      </div>

      <footer class="flex items-center gap-2 px-3 h-11 flex-none border-t border-ink/10">
        <button
          type="button"
          class="rounded-md border border-ink/20 bg-ink/5 px-2 py-1 text-[11px] text-ink disabled:opacity-40"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </aside>
  );
}
