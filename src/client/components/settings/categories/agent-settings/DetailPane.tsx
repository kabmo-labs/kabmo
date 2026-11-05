import { useEffect, useState } from 'preact/hooks';
import type { FormEvent, FunctionComponent } from 'preact/compat';
import { AlertCircle, Check, Copy, Info, Loader2, Save, Trash2 } from 'lucide-preact';
import type { AgentItem, WriteOutcome } from '@/shared/types';
import { agentFileNameError } from '@/shared/lib/omp/config/agent-file';
import { useWriteFeedback } from '@/client/hooks/settings/write-feedback';
import { AgentModelPicker } from '@/client/components/settings/categories/agent-settings/ModelPicker';
import { AGENT_THINKING_DEFAULT, AGENT_THINKING_LEVELS } from '@/client/components/settings/categories/agent-settings/levels';

interface AgentDetailPaneProps {
  agent: AgentItem;
  isNew?: boolean;
  /** The file this definition replaced, when the name changed. */
  previousFileName?: string | null;
  onSave: (agent: AgentItem, previousFileName?: string | null) => Promise<WriteOutcome>;
  onDelete?: (agent: AgentItem) => Promise<WriteOutcome>;
}

/**
 * One agent definition, as the markdown file omp loads.
 *
 * Every control here corresponds to a key omp's own `parseAgentFields` reads
 * (`name`, `description`, `model`, `thinkingLevel`, `tools`, `spawns`) or to the
 * file body, which becomes the system prompt. That is deliberate: the pane used
 * to offer `mode`, `temperature` and `topP`, and omp ignores all three — editing
 * them changed a file to no effect, which is the worst kind of control.
 *
 * The file IS the agent, so creating one here writes it, and the tool allowlist
 * and `spawns` are edited as the CSV omp reads rather than re-serialized from a
 * record (that is what would drop a shipped agent's block-list `tools:`).
 *
 * Project agents stay read-only: that directory belongs to the workspace.
 */
export const AgentDetailPane: FunctionComponent<AgentDetailPaneProps> = ({
  agent,
  isNew = false,
  previousFileName = null,
  onSave,
  onDelete,
}) => {
  const [formData, setFormData] = useState<AgentItem>(agent);
  const [toolsText, setToolsText] = useState((agent.tools ?? []).join(', '));
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useWriteFeedback();

  const readOnly = agent.sourceRoot === 'project';

  useEffect(() => {
    setFormData(agent);
    setToolsText((agent.tools ?? []).join(', '));
    setConfirmDelete(false);
  }, [agent]);

  /** The name becomes the file name, and a blank prompt writes an agent that does nothing. */
  const validationError = (() => {
    if (readOnly) return null;
    const nameError = agentFileNameError(formData.name);
    if (nameError) return nameError;
    if (!formData.systemPrompt.trim()) return 'A system prompt is required — an empty agent does nothing.';
    return null;
  })();

  const dirty =
    formData.name !== agent.name
    || formData.description !== agent.description
    || (formData.model ?? '') !== (agent.model ?? '')
    || (formData.thinkingLevel ?? '') !== (agent.thinkingLevel ?? '')
    || (formData.spawns ?? '') !== (agent.spawns ?? '')
    || toolsText !== (agent.tools ?? []).join(', ')
    || formData.systemPrompt !== agent.systemPrompt;

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || validationError || feedback.saving) return;
    // An UNTOUCHED tools field sends `undefined`, so the file keeps its own
    // block-list form: re-sending the same names as CSV rewrote a shipped
    // agent's `tools:\n  - read` into one line for no reason.
    const toolsChanged = toolsText.trim() !== (agent.tools ?? []).join(', ');
    const tools = toolsChanged
      ? toolsText.split(',').map((name) => name.trim()).filter(Boolean)
      : undefined;
    void feedback.run(() => onSave({ ...formData, name: formData.name.trim(), tools }, previousFileName));
  };

  const handleDelete = () => {
    if (!onDelete) return;
    void feedback.run(async () => {
      const outcome = await onDelete(agent);
      if (!outcome.ok) setConfirmDelete(false);
      return outcome;
    });
  };

  return (
    <form onSubmit={handleSave} className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      {readOnly && (
        <div className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          This agent is defined by the workspace at{' '}
          <span className="font-mono text-ink/80">{agent.filePath}</span>. It is listed here and stays read-only:
          that <span className="font-mono">.omp/agents</span> directory belongs to the project.
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Identity &amp; Role</h2>
          {agent.fileName && (
            <span className="truncate font-mono text-[10px] text-ink/40" title={agent.filePath}>
              {agent.sourceRoot === 'project' ? '.omp/agents' : '~/.omp/agent/agents'}/{agent.fileName}.md
            </span>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink/80">Agent name</label>
          <input
            type="text"
            value={formData.name}
            onInput={(e) => setFormData({ ...formData, name: e.currentTarget.value })}
            required
            placeholder="agent-name"
            disabled={readOnly || feedback.saving}
            aria-invalid={agentFileNameError(formData.name) ? true : undefined}
            className="w-full rounded-lg border border-ink/20 bg-paper px-3 py-2 font-mono text-xs text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none disabled:opacity-60"
          />
          <p className="mt-1 text-[10px] text-ink/45">
            The file name omp loads it from — letters, numbers, dots, dashes, underscores.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink/80">Description</label>
          <textarea
            value={formData.description}
            onInput={(e) => setFormData({ ...formData, description: e.currentTarget.value })}
            placeholder="What does this agent do? Shown when omp lists it."
            rows={2}
            disabled={readOnly || feedback.saving}
            className="w-full rounded-lg border border-ink/20 bg-paper p-3 text-xs text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none placeholder:text-ink/35 disabled:opacity-60"
          />
          <p className="mt-1 text-[10px] text-ink/45">
            Required by omp: a definition without a description is not loaded at all.
          </p>
        </div>
      </div>

      <div className="border-t border-ink/10" />

      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Model &amp; Capabilities</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="text-xs font-semibold text-ink/80">Model</label>
              <span title="A provider/model selector from the live catalog. Leave it unselected to inherit the session model.">
                <Info className="h-3.5 w-3.5 text-ink/40" />
              </span>
            </div>
            <AgentModelPicker
              value={formData.model ?? ''}
              disabled={readOnly || feedback.saving}
              onChange={(selector) => setFormData({ ...formData, model: selector || undefined })}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="text-xs font-semibold text-ink/80">Thinking level</label>
              <span title="An omp thinking selector. “inherit” leaves the level to the session.">
                <Info className="h-3.5 w-3.5 text-ink/40" />
              </span>
            </div>
            <select
              aria-label="Thinking level"
              value={formData.thinkingLevel ?? AGENT_THINKING_DEFAULT}
              onChange={(e) => setFormData({ ...formData, thinkingLevel: e.currentTarget.value || undefined })}
              disabled={readOnly || feedback.saving}
              className="w-full cursor-pointer rounded-lg border border-ink/20 bg-paper py-2 pl-2 pr-3 font-mono text-xs text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none disabled:opacity-60"
            >
              <option value={AGENT_THINKING_DEFAULT}>inherit (session level)</option>
              {AGENT_THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="text-xs font-semibold text-ink/80">Tools</label>
              <span title="Comma-separated tool names. Empty means omp's default set for this kind of agent.">
                <Info className="h-3.5 w-3.5 text-ink/40" />
              </span>
            </div>
            <input
              type="text"
              value={toolsText}
              onInput={(e) => setToolsText(e.currentTarget.value)}
              placeholder="read, grep, glob, edit"
              disabled={readOnly || feedback.saving}
              className="w-full rounded-lg border border-ink/20 bg-paper px-3 py-2 font-mono text-xs text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none placeholder:text-ink/35 disabled:opacity-60"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="text-xs font-semibold text-ink/80">Spawns</label>
              <span title="Which agents this one may delegate to: * for any, or a comma-separated list.">
                <Info className="h-3.5 w-3.5 text-ink/40" />
              </span>
            </div>
            <input
              type="text"
              value={formData.spawns ?? ''}
              onInput={(e) => setFormData({ ...formData, spawns: e.currentTarget.value || undefined })}
              placeholder="*"
              disabled={readOnly || feedback.saving}
              className="w-full rounded-lg border border-ink/20 bg-paper px-3 py-2 font-mono text-xs text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none placeholder:text-ink/35 disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-ink/10" />

      <div className="flex flex-1 flex-col space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-ink">System prompt</label>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(formData.systemPrompt).then(() => {
                setCopiedPrompt(true);
                setTimeout(() => setCopiedPrompt(false), 1800);
              }).catch((err) => console.error('Failed to copy the system prompt:', err));
            }}
            className="flex items-center gap-1.5 text-xs text-ink/60 transition-colors hover:text-ink cursor-pointer"
          >
            {copiedPrompt ? <Check className="h-3.5 w-3.5 text-ink" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedPrompt ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <textarea
          value={formData.systemPrompt}
          onInput={(e) => setFormData({ ...formData, systemPrompt: e.currentTarget.value })}
          rows={7}
          disabled={readOnly || feedback.saving}
          placeholder="You are an expert coding assistant…"
          aria-invalid={validationError && !agentFileNameError(formData.name) ? true : undefined}
          className={`min-h-[140px] w-full flex-1 rounded-lg border bg-ink/5 p-3 font-mono text-xs leading-relaxed text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none disabled:opacity-60 ${
            validationError && !agentFileNameError(formData.name) ? 'border-error' : 'border-ink/20'
          }`}
        />
      </div>

      {feedback.error && (
        <div className="flex items-start gap-1.5 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          <AlertCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 break-words">{feedback.error}</span>
          <button type="button" onClick={feedback.dismissError} className="cursor-pointer text-error/60 hover:text-error" aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-3">
        <div className="flex items-center gap-2">
          {!readOnly && !isNew && onDelete && (
            confirmDelete ? (
              <>
                <span className="text-[11px] text-ink/70">Delete “{agent.name}”? The file is removed.</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={feedback.saving}
                  className="rounded-lg border border-error/40 px-2.5 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 cursor-pointer disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs text-ink/50 transition-colors hover:text-ink cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg border border-ink/20 px-3.5 py-2 text-xs font-medium text-ink/70 transition-colors hover:border-error hover:text-error cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete agent
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-3">
          {feedback.saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-ink">
              <Check className="h-3.5 w-3.5" /> Saved to the agent file
            </span>
          )}
          {validationError && !feedback.saved && (
            <span className="max-w-[16rem] text-right text-[11px] leading-snug text-error">{validationError}</span>
          )}
          {!readOnly && (
            <button
              type="submit"
              disabled={feedback.saving || Boolean(validationError) || (!isNew && !dirty)}
              title={!isNew && !dirty ? 'Nothing changed yet' : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-medium text-paper shadow-xs transition-colors hover:bg-ink/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              {feedback.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {isNew ? 'Create agent' : 'Save agent'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
};
