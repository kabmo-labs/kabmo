import { AlertTriangle, CheckCircle2, CircleDot, FileText, Flag, Hand, Target } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { GoalRecordPanel } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/GoalRecord';
import { isRecord } from '@/shared/lib/util/guards';

interface GoalItem {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  progress?: unknown;
  id?: unknown;
}

interface YieldFileItem {
  path: string;
  description?: string;
}

interface YieldPayload {
  summary?: string;
  report?: string;
  architecture?: string;
  files?: (YieldFileItem | string)[];
  status?: string;
  error?: string | null;
}

function itemLabel(item: GoalItem): string {
  if (typeof item.title === 'string' && item.title) return item.title;
  return typeof item.description === 'string' ? item.description : '';
}

function itemProgress(item: GoalItem): number | undefined {
  return typeof item.progress === 'number' && Number.isFinite(item.progress) ? item.progress : undefined;
}

function itemStatus(item: GoalItem): 'active' | 'done' | 'paused' {
  const s = typeof item.status === 'string' ? item.status.toLowerCase() : '';
  if (s === 'done' || s === 'completed') return 'done';
  if (s === 'paused' || s === 'yielded') return 'paused';
  return 'active';
}

const STATUS_STYLES = {
  active: 'bg-ink/8 text-ink/60',
  done: 'bg-success/10 text-success',
  paused: 'bg-warning/10 text-warning',
} as const;

function extractYieldPayload(tool: ToolCallData): YieldPayload | null {
  const details = isRecord(tool.details) ? tool.details : undefined;
  const input = isRecord(tool.input) ? tool.input : undefined;

  const data = (details && isRecord(details.data) ? details.data : undefined)
    ?? (input && isRecord(input.data) ? input.data : undefined)
    ?? details
    ?? input;

  if (!data) return null;

  const summary = typeof data.summary === 'string' ? data.summary : undefined;
  const report = typeof data.report === 'string' ? data.report : undefined;
  const architecture = typeof data.architecture === 'string' ? data.architecture : undefined;
  const rawFiles = Array.isArray(data.files) ? data.files : undefined;
  const files: (YieldFileItem | string)[] = [];
  if (rawFiles) {
    for (const f of rawFiles) {
      if (typeof f === 'string' && f) {
        files.push(f);
      } else if (isRecord(f) && typeof f.path === 'string') {
        files.push({ path: f.path, description: typeof f.description === 'string' ? f.description : undefined });
      }
    }
  }

  const status = typeof details?.status === 'string' ? details.status : (typeof data.status === 'string' ? data.status : undefined);
  const error = typeof data.error === 'string' ? data.error : null;

  if (!summary && !report && !architecture && files.length === 0 && !error) {
    return null;
  }

  return { summary, report, architecture, files: files.length > 0 ? files : undefined, status, error };
}

/** Panel untuk tool `goal` / `yield` — status goal + progress atau structured yield result. */
export function Goal({ tool }: { tool: ToolCallData }) {
  const details = tool.details ?? {};
  const items: GoalItem[] = Array.isArray(details.items) ? details.items : [];
  const isYield = tool.type === 'yield' || tool.name === 'yield';
  const isError = tool.status === 'error';

  // omp's OWN goal record (`GoalTool` answers `{op, goal, remainingTokens, …}`)
  // takes precedence: it shares this tool's name but not its shape, and the
  // list view below would render nothing for it.
  const recordPanel = GoalRecordPanel({ tool });
  if (recordPanel) return recordPanel;

  // Structured yield view (common in subagent result submissions)
  if (isYield) {
    const payload = extractYieldPayload(tool);
    if (payload) {
      return (
        <div className="overflow-hidden rounded-lg border border-ink/10 bg-paper text-[12px] text-ink select-text">
          <div className="flex items-center justify-between border-b border-ink/8 bg-canvas/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-md ${isError || payload.error ? 'bg-error/10 text-error' : 'bg-success/10 text-success'}`}>
                {isError || payload.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/70">
                {isError || payload.error ? 'Yield Error' : 'Yield Result'}
              </span>
            </div>
            {(payload.status || (isError ? 'error' : 'success')) && (
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${isError || payload.error ? 'bg-error/10 text-error' : 'bg-success/10 text-success'}`}>
                {payload.status || (isError ? 'failed' : 'success')}
              </span>
            )}
          </div>

          <div className="space-y-2.5 p-3">
            {(payload.error || (isError && tool.output)) && (
              <div className="flex items-start gap-2 rounded-md bg-error/10 p-2.5 text-error text-[11.5px]">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span className="font-mono leading-relaxed">{payload.error || tool.output}</span>
              </div>
            )}

            {payload.summary && (
              <div>
                <span className="text-[10px] font-mono text-ink/45 uppercase tracking-wider">Summary</span>
                <div className="mt-0.5 rounded border border-ink/6 bg-ink/[0.03] p-2">
                  <MarkdownRenderer content={payload.summary} className="font-medium" />
                </div>
              </div>
            )}

            {payload.report && payload.report !== payload.summary && (
              <div className="rounded-md border border-ink/8 bg-canvas/30 p-2.5">
                <span className="text-[10px] font-mono text-ink/45 uppercase tracking-wider">Report</span>
                <div className="mt-1 text-[11.5px] text-ink/85 leading-relaxed">
                  <MarkdownRenderer content={payload.report} />
                </div>
              </div>
            )}

            {payload.architecture && (
              <div>
                <span className="text-[10px] font-mono text-ink/45 uppercase tracking-wider">Evidence / Architecture</span>
                <div className="mt-0.5 text-[11px] text-ink/75 leading-relaxed bg-ink/[0.03] p-2 rounded border border-ink/6">
                  <MarkdownRenderer content={payload.architecture} />
                </div>
              </div>
            )}

            {payload.files && payload.files.length > 0 && (
              <div>
                <span className="text-[10px] font-mono text-ink/45 uppercase tracking-wider">
                  Files Inspected ({payload.files.length})
                </span>
                <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {payload.files.map((file, i) => {
                    const filePath = typeof file === 'string' ? file : file.path;
                    const desc = typeof file === 'string' ? undefined : file.description;
                    return (
                      <div
                        key={i}
                        className="flex flex-col justify-between rounded border border-ink/6 bg-canvas/40 p-1.5"
                      >
                        <span className="inline-flex items-center gap-1 font-mono text-[10.5px] font-medium text-ink truncate">
                          <FileText size={10} className="shrink-0 text-ink/50" />
                          <span className="truncate">{filePath}</span>
                        </span>
                        {desc && (
                          <span className="text-[10px] text-ink/60 leading-tight mt-0.5 truncate">
                            {desc}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
  }

  if (items.length === 0) {
    if (!tool.output) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2.5 text-[11.5px] text-ink/45">
          <Target size={13} className="shrink-0" />
          <span>{isYield ? 'No yield' : 'No goals'}</span>
        </div>
      );
    }
    return <FallbackOutput text={tool.output} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8">
      <div className="border-b border-ink/8 bg-paper px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
          {isYield ? 'Yield' : 'Goals'}
        </span>
        <span className="ml-2 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
        {items.map((item, index) => {
          const label = itemLabel(item);
          if (!label) return null;
          const progress = itemProgress(item);
          const status = itemStatus(item);
          return (
            <div key={typeof item.id === 'string' ? item.id : `goal-${index}`} className="px-2.5 py-1.5">
              <div className="flex items-start gap-2 text-[11.5px]">
                {isYield ? (
                  <Hand size={11} className="mt-0.5 shrink-0 text-ink/40" />
                ) : (
                  <Flag size={11} className="mt-0.5 shrink-0 text-ink/40" />
                )}
                <span className="min-w-0 flex-1 break-words text-ink/80">{label}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] ${STATUS_STYLES[status]}`}>
                  {status}
                </span>
              </div>
              {progress !== undefined && (
                <div className="mt-1.5 flex items-center gap-1.5 pl-[18px]">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/8">
                    <div
                      className="h-full rounded-full bg-ink/60 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, Math.round(progress * 100)))}%` }}
                    />
                  </div>
                  <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-ink/45">
                    <CircleDot size={8} />
                    {Math.round(progress * 100)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
