import { Eye, EyeOff } from 'lucide-preact';

interface InstructionsEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  showLineNumbers: boolean;
  onToggleLineNumbers: () => void;
}

/**
 * The SKILL.md body editor.
 *
 * The gutter and the textarea are the same monospace face at the same line height
 * and the same row count, so a line number sits beside ITS line — the pane used to
 * render every gutter row at `text-xs` next to a `leading-relaxed` body, which put
 * the numbers a line or two out by the bottom of a long skill.
 *
 * The row budget is capped: a 400-line skill should not push the form's own
 * controls off the screen, and the textarea scrolls once past the cap.
 */
const MIN_ROWS = 10;
const MAX_ROWS = 24;

export function InstructionsEditor({
  value,
  onChange,
  readOnly,
  showLineNumbers,
  onToggleLineNumbers,
}: InstructionsEditorProps) {
  const lineCount = value.split('\n').length;
  const rows = Math.max(MIN_ROWS, Math.min(lineCount + 1, MAX_ROWS));
  const chars = value.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">Instructions</h3>
          <span className="text-[10px] text-ink/45 font-mono">
            {lineCount} line{lineCount === 1 ? '' : 's'} · {chars} chars
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleLineNumbers}
          title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
          aria-label={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
          className="p-1 rounded-md text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          {showLineNumbers ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>

      <div className="rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/[0.02] overflow-hidden flex font-mono text-[11px] leading-5 focus-within:border-ink transition-colors">
        {showLineNumbers ? (
          <div
            aria-hidden="true"
            className="w-9 flex-shrink-0 py-2 pr-1.5 select-none text-right font-mono text-[11px] leading-5 text-ink/30 border-r border-ink/10 overflow-hidden"
          >
            {Array.from({ length: rows }, (_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
        ) : null}
        <textarea
          value={value}
          onInput={(event) => onChange(event.currentTarget.value)}
          readOnly={readOnly}
          spellcheck={false}
          rows={rows}
          style={{ height: `${rows * 1.25}rem` }}
          className="flex-1 px-2.5 py-2 bg-transparent text-ink font-mono text-[11px] leading-5 resize-none focus:outline-none overflow-auto disabled:opacity-60 read-only:opacity-70"
          placeholder="---&#10;description: &quot;What this skill does&quot;&#10;---&#10;&#10;Instructions…"
        />
      </div>
      <p className="text-[10px] text-ink/40 leading-relaxed">
        The body of <span className="font-mono">SKILL.md</span>. The pane writes the frontmatter
        {readOnly ? '' : ' (name, description, hidden) — do not repeat those keys here'}.
      </p>
    </div>
  );
}
