import type { ReactNode } from 'preact/compat';
import { BookOpen, Brain, Database, GraduationCap, Wrench } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

interface MemoryItem {
  text?: unknown;
  content?: unknown;
  query?: unknown;
  score?: unknown;
  id?: unknown;
}

function itemText(m: MemoryItem): string {
  if (typeof m.text === 'string' && m.text) return m.text;
  return typeof m.content === 'string' ? m.content : '';
}

function itemScore(m: MemoryItem): number | undefined {
  return typeof m.score === 'number' && Number.isFinite(m.score) ? m.score : undefined;
}

const TOOL_META: Record<string, { label: string; icon: ReactNode }> = {
  memory_edit: { label: 'Memory Edit', icon: <Wrench size={11} /> },
  retain: { label: 'Retained', icon: <BookOpen size={11} /> },
  recall: { label: 'Recalled', icon: <Brain size={11} /> },
  reflect: { label: 'Reflections', icon: <Brain size={11} /> },
  learn: { label: 'Learned', icon: <GraduationCap size={11} /> },
};

function parseMemoryItems(output: string): MemoryItem[] {
  if (!output) return [];
  try {
    const data = JSON.parse(output);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.memories)) return data.memories;
      if (Array.isArray(data.results)) return data.results;
    }
  } catch {}
  return [];
}

/** Panel untuk tool memory — retain/recall/reflect/learn/memory_edit. */
export function Memory({ tool }: { tool: ToolCallData }) {
  const details = tool.details ?? {};
  const items: MemoryItem[] = Array.isArray(details.items)
    ? details.items
    : parseMemoryItems(tool.output ?? '');
  const meta = TOOL_META[tool.type] ?? { label: 'Memory', icon: <Brain size={11} /> };

  if (items.length === 0) {
    if (!tool.output) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2.5 text-[11.5px] text-ink/45">
          <Database size={13} className="shrink-0" />
          <span>No memories</span>
        </div>
      );
    }
    return <FallbackOutput text={tool.output} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8">
      <div className="border-b border-ink/8 bg-paper px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">{meta.label}</span>
        <span className="ml-2 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
        {items.map((item, index) => {
          const text = itemText(item);
          if (!text) return null;
          const score = itemScore(item);
          return (
            <div key={typeof item.id === 'string' ? item.id : `mem-${index}`} className="flex items-start gap-2 px-2.5 py-1.5 text-[11.5px]">
              <span className="mt-0.5 shrink-0 text-ink/40">{meta.icon}</span>
              <span className="min-w-0 flex-1 break-words text-ink/80">{text}</span>
              {score !== undefined && (
                <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">
                  {Math.round(score * 100)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
