import { useEffect, useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import { Check, Code, Copy, Info, RotateCcw, Save, ShieldCheck } from 'lucide-preact';
import type { InstructionFileKind, InstructionSaveResult } from '@/shared/types';

/** Per-file copy: what the file is, and how omp loads it. */
const FILE_COPY: Record<InstructionFileKind, { title: string; badge: string; tooltip: string; placeholder: string }> = {
  agents: {
    title: 'Global AGENTS.md',
    badge: 'context file',
    tooltip:
      'User context file omp loads when a session starts (~/.omp/agent/AGENTS.md, relocated by PI_CODING_AGENT_DIR). It shadows every other user-level context file, so it is the place for long-lived global rules. Recognizable permission directives are also mirrored into config.yml tools.approval. Saving empty content removes the file.',
    placeholder: 'Type instructions in <mandatory_rules> tags...',
  },
  rules: {
    title: 'Global RULES.md',
    badge: 'sticky rule',
    tooltip:
      'User sticky rule (~/.omp/agent/RULES.md). Its whole body is re-sent on every request and re-read when a session starts or after /clear and /new, so it keeps its hold in long conversations — keep it to a few hard requirements. Saving empty content removes the file.',
    placeholder: 'One hard requirement per line, e.g. Never commit or push unless asked.',
  },
};

interface BehaviorEditorProps {
  kind: InstructionFileKind;
  content: string;
  /** Native file this editor writes, or null in MOCK mode where nothing hits disk. */
  filePath: string | null;
  /** False when the native file does not exist yet — Save creates it. */
  exists: boolean;
  isMock: boolean;
  onSave: (newContent: string) => Promise<InstructionSaveResult>;
  /** Omitted for RULES.md, which has no shipped default to restore. */
  onReset?: () => Promise<InstructionSaveResult>;
}

export const BehaviorEditor: FunctionComponent<BehaviorEditorProps> = ({
  kind,
  content,
  filePath,
  exists,
  isMock,
  onSave,
  onReset,
}) => {
  const [editorValue, setEditorValue] = useState(content);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The gutter follows the textarea's own scroll. Without it the numbers stay
  // at line 1 while the body scrolls away, which reads as the wrong file.
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditorValue(content);
  }, [content]);

  const copy = FILE_COPY[kind];
  const lines = editorValue.split('\n');
  const lineCount = lines.length;
  const charCount = editorValue.length;
  const tokenEstimate = Math.round(charCount / 4);

  const statusLabel = isMock
    ? 'Demo preset — MOCK=true, nothing is written to disk'
    : filePath
      ? `${filePath}${exists ? '' : ' · not created yet'}`
      : 'Native path unavailable';

  const runPersist = async (persist: () => Promise<InstructionSaveResult>) => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const result = await persist();
      if (result.error) {
        setError(result.error);
        return;
      }
      setNote(result.note ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editorValue)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        // A refused clipboard is REPORTED: the button used to flip to "Copied"
        // whether or not anything reached it.
        setError(`The clipboard refused the copy: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  const handleSave = () => {
    void runPersist(() => onSave(editorValue));
  };

  const handleReset = async () => {
    if (!onReset) return;
    if (!window.confirm(`Replace ${filePath ?? 'the stored content'} with the shipped default rules?`)) return;
    await runPersist(onReset);
  };

  const handleInsertRule = (ruleSnippet: string) => {
    setEditorValue((prev) => `${prev.trim()}\n\n${ruleSnippet}\n`);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-paper text-ink p-6 md:p-8 overflow-hidden">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-4 border-b border-ink/10">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-ink flex items-center gap-2">
            <span className="truncate">{copy.title}</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink/15 text-ink/50 font-medium flex-shrink-0">
              {copy.badge}
            </span>
          </h2>
          <div className="group relative flex-shrink-0">
            <Info className="w-4 h-4 text-ink/40 cursor-help" />
            <div className="absolute left-0 top-6 hidden group-hover:block w-80 max-w-[80vw] p-2.5 rounded-lg bg-ink text-paper text-xs shadow-lg z-20 leading-relaxed pointer-events-none">
              {copy.tooltip}
            </div>
          </div>
        </div>

        {/* Action Buttons Top */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy to clipboard"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ink/20 hover:border-ink/40 hover:bg-ink/5 text-ink transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-ink" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          {onReset && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              title="Reset to default rules"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ink/20 hover:border-ink/40 hover:bg-ink/5 text-ink transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-ink text-paper hover:bg-ink/90 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saving ? 'Saving…' : saved ? 'Saved' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Persist Feedback */}
      {(error || note) && (
        <div className={`pt-3 text-xs font-mono break-words ${error ? 'text-error' : 'text-ink/60'}`}>
          {error ?? note}
        </div>
      )}

      {/* Quick Insert Snippet Chips */}
      <div className="py-3 flex items-center gap-2 overflow-x-auto text-xs border-b border-ink/10">
        <span className="text-ink/50 uppercase tracking-wider text-[10px] font-bold whitespace-nowrap">
          Quick Insert:
        </span>
        <button
          type="button"
          onClick={() =>
            handleInsertRule(
              `<mandatory_rules>\nALWAY USE CODEGRAPH (codegraph_codegraph_explore) TOOL MCP FIRST BEFORE OTHER TOOL BUILT-IN.\n</mandatory_rules>`
            )
          }
          className="px-2.5 py-1 text-xs font-mono rounded-md bg-ink/5 hover:bg-ink/10 border border-ink/15 whitespace-nowrap transition-colors flex items-center gap-1.5 text-ink cursor-pointer"
        >
          <Code className="w-3.5 h-3.5 text-ink/60" />
          + CodeGraph Rule
        </button>
        <button
          type="button"
          onClick={() =>
            handleInsertRule(
              `<mandatory_rules>\nIF SUBAGENT NOT DEFINE MODELID, DELEGATE TASK USING INHERIT WITH PARENT MODELID.\n</mandatory_rules>`
            )
          }
          className="px-2.5 py-1 text-xs font-mono rounded-md bg-ink/5 hover:bg-ink/10 border border-ink/15 whitespace-nowrap transition-colors flex items-center gap-1.5 text-ink cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-ink/60" />
          + Model Inheritance
        </button>
        <button
          type="button"
          onClick={() =>
            handleInsertRule(
              `<mandatory_rules>\nWHEN COMMIT, ALWAYS USE CONVENTIONAL COMMIT. JANGAN COMMIT SAMPAI AKU MINTA.\n</mandatory_rules>`
            )
          }
          className="px-2.5 py-1 text-xs font-mono rounded-md bg-ink/5 hover:bg-ink/10 border border-ink/15 whitespace-nowrap transition-colors flex items-center gap-1.5 text-ink cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-ink/60" />
          + Conventional Commit Guard
        </button>
      </div>

      {/* Code Editor Area with Line Numbers */}
      <div className="flex-1 min-h-0 mt-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 overflow-hidden flex flex-col font-mono text-xs focus-within:border-ink transition-colors">
        <div className="flex-1 flex overflow-hidden">
          {/* Line Numbers */}
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="w-10 py-3 pr-2 select-none text-right font-mono text-xs text-ink/30 border-r border-ink/10 bg-ink/[0.02] overflow-hidden leading-relaxed"
          >
            {Array.from({ length: Math.max(lineCount, 12) }).map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Text Area */}
          <textarea
            value={editorValue}
            onInput={(e) => setEditorValue(e.currentTarget.value)}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellcheck={false}
            aria-label={`${copy.title} content`}
            className="flex-1 p-3 bg-transparent text-ink font-mono text-xs leading-relaxed resize-none focus:outline-none overflow-y-auto"
            placeholder={copy.placeholder}
          />
        </div>

        {/* Editor Status Bar */}
        <div className="p-2.5 border-t border-ink/10 bg-paper flex items-center justify-between gap-4 text-xs font-mono text-ink/60">
          <div className="flex items-center gap-4 shrink-0">
            <span>{lineCount} lines</span>
            <span>{charCount} chars</span>
            <span>~{tokenEstimate} tokens</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${exists && !isMock ? 'bg-ink/60' : 'bg-ink/25'}`} />
            <span className="truncate" title={statusLabel}>{statusLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
