import { useMemo, useState } from 'preact/hooks';
import { Ban, Bot, CheckCircle2, ChevronDown, FileText, Loader2, Target, XCircle } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';
import { JsonCodeBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/JsonCodeBlock';
import { formatCompactTokens, formatCost } from '@/shared/lib/format/number';

interface TaskRow {
  id?: unknown;
  agent?: unknown;
  status?: unknown;
  task?: unknown;
  name?: unknown;
  assignment?: unknown;
  exitCode?: unknown;
  error?: unknown;
  aborted?: unknown;
  tokens?: unknown;
  cost?: unknown;
  durationMs?: unknown;
  resolvedModel?: unknown;
}

interface InputTask {
  name?: string;
  agent?: string;
  task?: string;
  assignment?: string;
}

function rowStatus(row: TaskRow): 'running' | 'done' | 'failed' | 'aborted' {
  if (row.aborted === true) return 'aborted';
  if (typeof row.error === 'string' && row.error) return 'failed';
  if (typeof row.exitCode === 'number') return row.exitCode === 0 ? 'done' : 'failed';
  if (row.status === 'done' || row.status === 'completed' || row.status === 'success') return 'done';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'aborted') return 'aborted';
  return 'running';
}

const STATUS_STYLES = {
  running: { icon: <Loader2 size={11} className="animate-spin text-ink/50" />, label: 'running' },
  done: { icon: <CheckCircle2 size={11} className="text-success" />, label: 'done' },
  failed: { icon: <XCircle size={11} className="text-error" />, label: 'failed' },
  aborted: { icon: <Ban size={11} className="text-ink/35" />, label: 'aborted' },
} as const;

function tokenLabel(n: unknown): string {
  return typeof n === 'number' ? formatCompactTokens(n) ?? '' : '';
}

function costLabel(n: unknown): string {
  return typeof n === 'number' ? formatCost(n, 3) : '';
}

function formatMs(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1000) return '';
  return `${Math.floor(n / 1000)}s`;
}

/** Rich panel for the `task` subagent spawner and result coordinator. */
export function TaskResult({ tool }: { tool: ToolCallData }) {
  const [contextExpanded, setContextExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(true);

  const details = tool.details ?? {};
  const results = Array.isArray(details.results) ? (details.results as TaskRow[]) : [];
  const progress = Array.isArray(details.progress) ? (details.progress as TaskRow[]) : [];

  const jsonOutput = useMemo(
    () => (tool.output ? tryParseJson(tool.output) : { isValid: false }),
    [tool.output]
  );

  const inputObj = typeof tool.input === 'object' && tool.input !== null ? (tool.input as Record<string, any>) : undefined;
  const inputContext = typeof inputObj?.context === 'string' ? inputObj.context.trim() : '';
  const inputTasks = Array.isArray(inputObj?.tasks) ? (inputObj.tasks as InputTask[]) : [];

  const rows: TaskRow[] = useMemo(() => {
    if (results.length > 0) return results;
    if (progress.length > 0) return progress;
    if (inputTasks.length > 0) {
      return inputTasks.map((t, idx) => ({
        id: `task-sub-${idx}`,
        name: t.name,
        agent: t.agent || 'scout',
        task: t.task,
        status: tool.status === 'success' ? 'done' : 'running',
      }));
    }
    return [];
  }, [results, progress, inputTasks, tool.status]);

  if (rows.length === 0 && !tool.output && !inputContext) return null;

  const totalTokens = rows.reduce((sum, r) => sum + (typeof r.tokens === 'number' ? r.tokens : 0), 0);
  const totalCost = rows.reduce((sum, r) => sum + (typeof r.cost === 'number' ? r.cost : 0), 0);

  return (
    <div className="space-y-2.5">
      {/* 1. Subagent Status Bar */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="flex items-center gap-2 border-b border-ink/8 px-2.5 py-1.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <Bot size={11} className="text-ink/60" />
              Subagents
            </span>
            <span className="ml-auto font-mono text-[10px] text-ink/45">
              {rows.length} {rows.length > 1 ? 'agents' : 'agent'}
              {totalTokens ? ` · ${tokenLabel(totalTokens)} tok` : ''}
              {totalCost ? ` · ${costLabel(totalCost)}` : ''}
            </span>
          </div>
          <div className="divide-y divide-ink/6 px-2.5 py-1">
            {rows.map((row, index) => {
              const status = rowStatus(row);
              const style = STATUS_STYLES[status];
              const name = typeof row.name === 'string' && row.name ? row.name : null;
              const agent = typeof row.agent === 'string' ? row.agent : 'scout';
              const right = [
                tokenLabel(row.tokens),
                costLabel(row.cost),
                status !== 'running' ? formatMs(row.durationMs) : '',
              ].filter(Boolean).join(' · ');

              return (
                <div key={typeof row.id === 'string' ? row.id : `row-${index}`} className="flex items-center gap-2 py-1.5 text-[11.5px]">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink/[0.04]">
                    {style.icon}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] font-semibold text-ink">
                    {name || agent}
                  </span>
                  {name && (
                    <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/50">
                      {agent}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-ink/40">
                    {right || (status === 'done' ? 'settled' : 'running')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Target Goal & Context (Collapsible) */}
      {inputContext && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <button
            type="button"
            onClick={() => setContextExpanded(prev => !prev)}
            className="flex w-full cursor-pointer items-center justify-between px-2.5 py-1.5 text-left transition-colors hover:bg-ink/[0.02]"
          >
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <Target size={11} className="text-ink/60" />
              Goal & Constraints
            </span>
            <ChevronDown
              size={12}
              className={`text-ink/40 transition-transform duration-150 ${contextExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          {contextExpanded && (
            <div className="border-t border-ink/8 bg-canvas/30 px-3 py-2 text-[11.5px] text-ink/80 select-text leading-relaxed">
              <MarkdownRenderer content={inputContext} />
            </div>
          )}
        </div>
      )}

      {/* 3. Task Specifications (Target, Change, Acceptance) */}
      {inputTasks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <button
            type="button"
            onClick={() => setTasksExpanded(prev => !prev)}
            className="flex w-full cursor-pointer items-center justify-between px-2.5 py-1.5 text-left transition-colors hover:bg-ink/[0.02]"
          >
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <FileText size={11} className="text-ink/60" />
              Task Brief & Specification
            </span>
            <ChevronDown
              size={12}
              className={`text-ink/40 transition-transform duration-150 ${tasksExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          {tasksExpanded && (
            <div className="divide-y divide-ink/8 border-t border-ink/8 bg-canvas/30">
              {inputTasks.map((t, idx) => (
                <div key={idx} className="p-3 space-y-1.5 text-[11.5px] text-ink/80 select-text">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink text-[12px]">{t.name || `Task #${idx + 1}`}</span>
                    {t.agent && (
                      <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/60">
                        {t.agent}
                      </span>
                    )}
                  </div>
                  {t.task && (
                    <div className="text-ink/85 leading-relaxed font-sans">
                      <MarkdownRenderer content={t.task} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. Output / Spawn Resolution */}
      {tool.output && (
        jsonOutput.isValid && jsonOutput.pretty ? (
          <JsonCodeBlock
            jsonString={jsonOutput.pretty}
            title="Yield Output"
            maxHeightClass="max-h-72"
            showHeader={true}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
            <div className="flex items-center gap-1.5 border-b border-ink/8 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <Bot size={11} className="text-ink/60" />
              <span>Yield Output</span>
            </div>
            <div className="bg-canvas/30 px-3 py-2 text-[11px] font-sans leading-relaxed text-ink/80 select-text">
              <MarkdownRenderer content={tool.output} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
