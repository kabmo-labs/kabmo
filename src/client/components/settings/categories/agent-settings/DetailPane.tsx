import { useEffect, useState } from 'preact/hooks';
import type { FormEvent, FunctionComponent } from 'preact/compat';
import { Check, Copy, Info, Minus, PenTool, Plus, Trash2 } from 'lucide-preact';
import type { AgentItem, AgentMode, AgentScope } from '@/shared/types';

interface AgentDetailPaneProps {
  agent: AgentItem;
  isNew?: boolean;
  onSave: (updatedAgent: AgentItem) => void;
  onDelete?: (agentId: string) => void;
}

const AVAILABLE_MODELS = [
  'Not selected',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'gpt-4o',
  'gpt-4o-mini',
  'o3-mini',
  'gemini-2.5-pro-preview-03-25',
  'gemini-2.5-flash',
  'deepseek-chat-v3',
  'deepseek-reasoner-r1',
];

export const AgentDetailPane: FunctionComponent<AgentDetailPaneProps> = ({
  agent,
  isNew = false,
  onSave,
  onDelete,
}) => {
  const [formData, setFormData] = useState<AgentItem>(agent);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    setFormData(agent);
    setSavedSuccess(false);
  }, [agent]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    onSave(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(formData.systemPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
  };

  const adjustTemp = (delta: number) => {
    setFormData((prev) => {
      const current = prev.temperature ?? 0.7;
      const next = Math.max(0, Math.min(2.0, parseFloat((current + delta).toFixed(2))));
      return { ...prev, temperature: next };
    });
  };

  const adjustTopP = (delta: number) => {
    setFormData((prev) => {
      const current = prev.topP ?? 0.95;
      const next = Math.max(0, Math.min(1.0, parseFloat((current + delta).toFixed(2))));
      return { ...prev, topP: next };
    });
  };

  return (
    <form onSubmit={handleSave} className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      {/* SECTION 1: Identity & Role */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
            Identity & Role
          </h2>
          {formData.isBuiltIn && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-ink/5 border border-ink/10 text-ink/60">
              Built-in System Agent (Read-only System Core)
            </span>
          )}
        </div>

        {/* Name and Scope row */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Agent Name
            </label>
            <div className="flex items-center border border-ink/20 hover:border-ink/40 focus-within:border-ink rounded-lg bg-paper transition-colors">
              <span className="px-3 py-2 font-mono text-xs text-ink/40 border-r border-ink/15 select-none">
                @
              </span>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.currentTarget.value })}
                required
                placeholder="agent-name"
                disabled={formData.isBuiltIn}
                className="w-full text-xs font-mono px-3 py-2 bg-transparent focus:outline-none disabled:opacity-60 text-ink"
              />
            </div>
          </div>

          <div className="w-40">
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Scope
            </label>
            <select
              value={formData.scope}
              onChange={(e) => setFormData({ ...formData, scope: e.currentTarget.value as AgentScope })}
              disabled={formData.isBuiltIn}
              className="w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink disabled:opacity-60 text-ink transition-colors cursor-pointer"
            >
              <option value="user">user</option>
              <option value="project">project</option>
              <option value="system">system</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-ink/80 mb-1.5">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.currentTarget.value })}
            placeholder="What does this agent do?"
            rows={2}
            className="w-full text-xs p-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink placeholder:text-ink/30 text-ink transition-colors"
          />
        </div>

        {/* Mode Segmented Pills */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <label className="text-xs font-semibold text-ink/80">Mode</label>
            <span title="Defines agent delegation context (primary, subagent, or all)">
              <Info className="w-3.5 h-3.5 text-ink/40" />
            </span>
          </div>
          <div className="inline-flex rounded-lg border border-ink/15 p-0.5 bg-ink/5">
            {(['primary', 'subagent', 'all'] as AgentMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => setFormData({ ...formData, mode })}
                className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer capitalize ${
                  formData.mode === mode
                    ? 'bg-paper text-ink shadow-xs font-semibold'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-ink/10" />

      {/* SECTION 2: Model & Parameters */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
          Model & Parameters
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Override Model */}
          <div>
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Override Model
            </label>
            <div className="flex items-center border border-ink/20 hover:border-ink/40 focus-within:border-ink rounded-lg bg-paper transition-colors">
              <span className="px-2.5 text-ink/40">
                <PenTool className="w-3.5 h-3.5" />
              </span>
              <select
                value={formData.overrideModel || 'Not selected'}
                onChange={(e) => setFormData({ ...formData, overrideModel: e.currentTarget.value })}
                className="w-full text-xs font-mono py-2 pr-3 bg-transparent focus:outline-none cursor-pointer text-ink"
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Thinking Variant */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="text-xs font-semibold text-ink/80">Thinking Variant</label>
              <span title="Controls chain-of-thought token depth">
                <Info className="w-3.5 h-3.5 text-ink/40" />
              </span>
            </div>
            <input
              type="text"
              value={formData.thinkingVariant || 'default'}
              onChange={(e) => setFormData({ ...formData, thinkingVariant: e.currentTarget.value })}
              placeholder="default"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
            />
          </div>

          {/* Temperature Stepper */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="text-xs font-semibold text-ink/80">Temperature</label>
              <span title="Higher values make output more random, lower values more deterministic">
                <Info className="w-3.5 h-3.5 text-ink/40" />
              </span>
            </div>
            <div className="flex items-center border border-ink/20 rounded-lg max-w-[150px] bg-paper overflow-hidden">
              <button
                type="button"
                onClick={() => adjustTemp(-0.05)}
                className="px-3 py-1.5 text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="flex-1 text-center font-mono text-xs font-medium text-ink">
                {formData.temperature != null ? formData.temperature.toFixed(2) : '—'}
              </span>
              <button
                type="button"
                onClick={() => adjustTemp(0.05)}
                className="px-3 py-1.5 text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Top P Stepper */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="text-xs font-semibold text-ink/80">Top P</label>
              <span title="Nucleus sampling cutoff">
                <Info className="w-3.5 h-3.5 text-ink/40" />
              </span>
            </div>
            <div className="flex items-center border border-ink/20 rounded-lg max-w-[150px] bg-paper overflow-hidden">
              <button
                type="button"
                onClick={() => adjustTopP(-0.05)}
                className="px-3 py-1.5 text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="flex-1 text-center font-mono text-xs font-medium text-ink">
                {formData.topP != null ? formData.topP.toFixed(2) : '—'}
              </span>
              <button
                type="button"
                onClick={() => adjustTopP(0.05)}
                className="px-3 py-1.5 text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-ink/10" />

      {/* SECTION 3: System Prompt */}
      <div className="space-y-2 flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-ink">
            System Prompt
          </label>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="flex items-center gap-1.5 text-xs text-ink/60 hover:text-ink transition-colors cursor-pointer"
          >
            {copiedPrompt ? <Check className="w-3.5 h-3.5 text-ink" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedPrompt ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <textarea
          value={formData.systemPrompt}
          onChange={(e) => setFormData({ ...formData, systemPrompt: e.currentTarget.value })}
          rows={7}
          placeholder="You are an expert coding assistant..."
          className="w-full flex-1 min-h-[140px] text-xs font-mono p-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 focus:outline-none focus:border-ink leading-relaxed transition-colors"
        />
      </div>

      {/* Footer Controls */}
      <div className="pt-3 border-t border-ink/10 flex items-center justify-between">
        <div>
          {!formData.isBuiltIn && !isNew && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(formData.id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-xs font-medium transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Agent
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {savedSuccess && (
            <span className="flex items-center gap-1 text-xs text-ink font-medium">
              <Check className="w-3.5 h-3.5" />
              Saved successfully
            </span>
          )}
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer"
          >
            {isNew ? 'Create Agent' : 'Save Agent'}
          </button>
        </div>
      </div>
    </form>
  );
};
