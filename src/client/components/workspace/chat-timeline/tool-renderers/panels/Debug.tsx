import { Bug, BugOff, CheckCircle2, Target } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

interface DebugItem {
  action?: unknown;
  target?: unknown;
  pid?: unknown;
  state?: unknown;
  message?: unknown;
}

function itemLabel(item: DebugItem): string {
  if (typeof item.target === 'string' && item.target) return item.target;
  if (typeof item.pid === 'number') return `pid ${item.pid}`;
  return typeof item.message === 'string' ? item.message : '';
}

function itemState(item: DebugItem): 'attached' | 'running' | 'stopped' | 'detached' {
  const s = typeof item.state === 'string' ? item.state.toLowerCase() : '';
  if (s === 'attached' || s === 'running') return s as 'attached' | 'running';
  if (s === 'detached') return 'detached';
  return 'stopped';
}

const STATE_STYLES = {
  attached: 'bg-success/10 text-success',
  running: 'bg-ink/8 text-ink/60',
  stopped: 'bg-ink/5 text-ink/45',
  detached: 'bg-error/10 text-error',
} as const;

function countByState(items: DebugItem[]): Record<string, number> {
  const counts: Record<string, number> = { attached: 0, running: 0, stopped: 0, detached: 0 };
  for (const item of items) counts[itemState(item)]++;
  return counts;
}

/** Panel untuk tool `debug` — sesi debug + ringkasan state. */
export function Debug({ tool }: { tool: ToolCallData }) {
  const details = tool.details ?? {};
  const items: DebugItem[] = Array.isArray(details.items) ? details.items : [];

  if (items.length === 0) {
    if (!tool.output) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2.5 text-[11.5px] text-ink/45">
          <BugOff size={13} className="shrink-0" />
          <span>No debug session</span>
        </div>
      );
    }
    return <FallbackOutput text={tool.output} />;
  }

  const counts = countByState(items);

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8">
      <div className="flex items-center gap-2 border-b border-ink/8 bg-paper px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">Debug Session</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
          {counts.attached > 0 && <span className="rounded-full bg-success/10 px-1.5 py-px text-success">{counts.attached} attached</span>}
          {counts.running > 0 && <span className="rounded-full bg-ink/8 px-1.5 py-px text-ink/60">{counts.running} run</span>}
          {counts.detached > 0 && <span className="rounded-full bg-error/10 px-1.5 py-px text-error">{counts.detached} detach</span>}
        </span>
      </div>
      <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
        {items.map((item, index) => {
          const state = itemState(item);
          const label = itemLabel(item);
          return (
            <div key={`${label}-${index}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
              {state === 'attached' ? (
                <CheckCircle2 size={11} className="shrink-0 text-success" />
              ) : state === 'running' ? (
                <Bug size={11} className="shrink-0 animate-pulse text-ink/50" />
              ) : (
                <Target size={11} className="shrink-0 text-ink/40" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/75">{label}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] ${STATE_STYLES[state]}`}>
                {state}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
