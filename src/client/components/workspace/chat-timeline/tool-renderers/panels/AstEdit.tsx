import { useMemo } from 'preact/hooks';
import { ArrowRight, CheckCircle2, Clock, Wand2 } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';

interface AstEditItem {
  file?: unknown;
  path?: unknown;
  nodeKind?: unknown;
  changes?: unknown;
  message?: unknown;
}

function parseAstChanges(output: string): AstEditItem[] {
  if (!output) return [];
  try {
    const data = JSON.parse(output);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.changes)) return data.changes;
      if (Array.isArray(data.edits)) return data.edits;
    }
  } catch {}
  return [];
}

/** Panel untuk tool `ast_edit` — perubahan AST terstruktur dan staged proposals. */
export function AstEdit({ tool }: { tool: ToolCallData }) {
  const details = (tool.details ?? {}) as Record<string, any>;
  const xdev = (details.xdev ?? {}) as Record<string, any>;
  const inner = (xdev.inner ?? {}) as Record<string, any>;
  const args = (xdev.args ?? {}) as Record<string, any>;
  const output = tool.output ?? '';

  const isStaged =
    inner.applied === false ||
    output.toLowerCase().includes('staged as a proposal') ||
    output.toLowerCase().includes('files not modified yet');

  const ops: Array<{ pat: string; out: string }> = Array.isArray(args.ops) ? args.ops : [];
  const paths: string[] = Array.isArray(args.paths) ? args.paths : inner.scopePath ? [inner.scopePath] : [];

  const displayDiff = inner.displayContent || (output.includes('-') && output.includes('+') ? output : '');
  const diffLines = displayDiff
    ? displayDiff.split(/\r?\n/).filter((l: string) => !l.startsWith('Staged as a proposal') && Boolean(l.trim()))
    : [];

  const structuredItems: AstEditItem[] = Array.isArray(details.changes)
    ? details.changes
    : parseAstChanges(output);

  const diffLang = getLanguageFromPath(paths[0]);
  const diffCode = useMemo(
    () =>
      diffLines
        .map((line: string) =>
          line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') ? line.slice(1) : line
        )
        .join('\n'),
    [diffLines],
  );
  const diffHtml = useDeferredHighlightLines(diffCode, diffLang);

  // If Staged Proposal Mode (oh-my-pi xd://ast_edit)
  if (isStaged || ops.length > 0 || diffLines.length > 0) {
    return (
      <div className="space-y-2 select-text">
        <div className="overflow-hidden rounded-lg border border-ink/10 bg-paper">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Wand2 size={13} className="text-ink/60" />
              <span className="font-mono text-[11px] font-semibold text-ink">AST Edit</span>
              {paths.length > 0 && (
                <span className="font-mono text-[10px] text-ink/50 truncate max-w-[200px]">
                  {paths[0]}
                </span>
              )}
            </div>

            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold ${
                isStaged ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
              }`}
            >
              {isStaged ? <Clock size={10} /> : <CheckCircle2 size={10} />}
              {isStaged ? 'STAGED PROPOSAL' : 'APPLIED'}
            </span>
          </div>

          {/* Operations: Pattern -> Replacement */}
          {ops.length > 0 && (
            <div className="border-b border-ink/6 p-2.5 bg-canvas/20">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">
                Pattern Transformation
              </span>
              <div className="mt-1 space-y-1">
                {ops.map((op, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded border border-ink/6 bg-paper px-2 py-1 font-mono text-[10.5px]"
                  >
                    <span className="text-error/90 line-through truncate">{op.pat}</span>
                    <ArrowRight size={10} className="shrink-0 text-ink/35" />
                    <span className="text-success/90 font-medium truncate">
                      {op.out || '/* removed */'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diff Output */}
          {diffLines.length > 0 && (
            <div className="p-2.5 font-mono text-[10.5px] leading-relaxed bg-canvas/30 space-y-0.5">
              {diffLines.map((line: string, i: number) => {
                const isDel = line.startsWith('-');
                const isAdd = line.startsWith('+');
                const html = diffHtml[i] || '';
                return (
                  <div
                    key={i}
                    className={`rounded px-1.5 py-0.5 ${
                      isDel
                        ? 'bg-error/10 text-error font-medium'
                        : isAdd
                          ? 'bg-success/10 text-success font-medium'
                          : 'text-ink/70'
                    }`}
                  >
                    {(isDel || isAdd) && line[0]}
                    {html ? (
                      <span className="shiki" dangerouslySetInnerHTML={{ __html: html }} />
                    ) : (
                      (isDel || isAdd) ? line.slice(1) : line
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Staged helper instruction */}
          {isStaged && (
            <div className="border-t border-ink/6 bg-paper px-3 py-1.5 text-[10px] text-ink/50">
              Proposal staged in memory. Apply with <code className="font-mono text-ink/75">xd://resolve</code> or discard with <code className="font-mono text-ink/75">xd://reject</code>.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Structured Items View
  if (structuredItems.length > 0) {
    return (
      <div className="overflow-hidden rounded-lg border border-ink/8 select-text">
        <div className="border-b border-ink/8 bg-paper px-2.5 py-1.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">AST Changes</span>
          <span className="ml-2 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[9.5px] text-ink/45">
            {structuredItems.length}
          </span>
        </div>
        <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
          {structuredItems.map((item, index) => {
            const file = typeof item.file === 'string' ? item.file : typeof item.path === 'string' ? item.path : '';
            const msg = typeof item.message === 'string' ? item.message : '';
            const kind = typeof item.nodeKind === 'string' ? item.nodeKind : '';
            const changes = typeof item.changes === 'number' ? item.changes : undefined;
            return (
              <div key={index} className="flex items-start gap-2 px-2.5 py-1.5 text-[11.5px]">
                <Wand2 size={11} className="mt-0.5 shrink-0 text-ink/40" />
                <span className="min-w-0 flex-1 break-words">
                  {file && <span className="font-mono text-[10px] text-ink/45">{file}: </span>}
                  <span className="text-ink/80">{msg}</span>
                  {kind && <span className="ml-1 font-mono text-[9.5px] text-ink/35">({kind})</span>}
                </span>
                {changes !== undefined && (
                  <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[9px] text-ink/45">
                    {changes} changes
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className="divide-y divide-ink/6 overflow-hidden rounded-lg border border-ink/8 bg-canvas/40 select-text">
      {lines.map((line, i) => (
        <li key={i} className="px-2.5 py-1.5 font-mono text-[11px] break-words text-ink/75">
          {line}
        </li>
      ))}
    </ul>
  );
}
