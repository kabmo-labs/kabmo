import { CheckCircle2, FileText, XCircle } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';

/** Panel untuk tool `resolve` dan `reject` (AST proposal resolution via xd://resolve / xd://reject). */
export function Resolve({ tool }: { tool: ToolCallData }) {
  const details = (tool.details ?? {}) as Record<string, any>;
  const xdev = (details.xdev ?? {}) as Record<string, any>;
  const inner = (xdev.inner ?? {}) as Record<string, any>;
  const input = typeof tool.input === 'object' && tool.input !== null ? (tool.input as Record<string, any>) : undefined;

  const isReject =
    tool.name === 'reject' ||
    tool.target?.includes('reject') ||
    xdev.tool === 'reject' ||
    inner.action === 'reject' ||
    inner.action === 'discard';

  const reason =
    inner.reason ||
    xdev.args?.reason ||
    (typeof input?.content === 'string' ? input.content : '') ||
    (typeof tool.input === 'string' ? tool.input : '');

  const sourceTool = inner.sourceToolName || 'ast_edit';
  const label = inner.label || tool.output || (isReject ? 'Proposal discarded' : 'Proposal applied');
  const files: string[] = Array.isArray(inner.sourceResultDetails?.files)
    ? inner.sourceResultDetails.files
    : [];
  const replacements = inner.sourceResultDetails?.totalReplacements ?? inner.totalReplacements;

  return (
    <div className="space-y-2 select-text">
      <div className="rounded-lg border border-ink/10 bg-paper p-3">
        <div className="flex items-center justify-between gap-2 border-b border-ink/6 pb-2">
          <div className="flex items-center gap-2">
            {isReject ? (
              <XCircle size={14} className="text-warning shrink-0" />
            ) : (
              <CheckCircle2 size={14} className="text-success shrink-0" />
            )}
            <span className="font-mono text-[11px] font-semibold text-ink">
              {isReject ? 'Proposal Discarded' : 'Proposal Applied'}
            </span>
            <span className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink/50">
              {sourceTool}
            </span>
          </div>

          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
              isReject ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
            }`}
          >
            {isReject ? 'REJECTED' : 'RESOLVED'}
          </span>
        </div>

        {reason && (
          <div className="pt-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
              Reason
            </span>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink/85 italic">
              &ldquo;{reason}&rdquo;
            </p>
          </div>
        )}

        {label && (
          <div className="mt-2 text-[11.5px] font-medium text-ink/80">
            {label}
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-2.5 space-y-1 border-t border-ink/6 pt-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink/40">
              <span>Touched Files ({files.length})</span>
              {typeof replacements === 'number' && (
                <span>{replacements} replacement{replacements === 1 ? '' : 's'}</span>
              )}
            </div>
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink/70">
                  <FileText size={11} className="shrink-0 text-ink/40" />
                  <span className="truncate">{f}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
