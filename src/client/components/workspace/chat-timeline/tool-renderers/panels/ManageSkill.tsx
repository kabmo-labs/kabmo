import { PackageCheck, PackageX } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

interface SkillItem {
  name?: unknown;
  slug?: unknown;
  version?: unknown;
  scope?: unknown;
  status?: unknown;
  message?: unknown;
}

function itemName(s: SkillItem): string {
  return typeof s.name === 'string' ? s.name : typeof s.slug === 'string' ? s.slug : '';
}

function itemStatus(s: SkillItem): 'enabled' | 'disabled' | 'installed' | 'removed' {
  const st = typeof s.status === 'string' ? s.status.toLowerCase() : '';
  if (st === 'enabled' || st === 'installed') return st as 'enabled' | 'installed';
  if (st === 'removed' || st === 'uninstalled' || st === 'deleted') return 'removed';
  return 'disabled';
}

const STATUS_STYLES = {
  enabled: 'bg-success/10 text-success',
  installed: 'bg-ink/8 text-ink/60',
  disabled: 'bg-ink/5 text-ink/45',
  removed: 'bg-error/10 text-error',
} as const;

function parseSkills(output: string): SkillItem[] {
  if (!output) return [];
  try {
    const data = JSON.parse(output);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.skills)) return data.skills;
      if (Array.isArray(data.items)) return data.items;
    }
  } catch {}
  return [];
}

/** Panel untuk tool `manage_skill` — daftar skill terkelola. */
export function ManageSkill({ tool }: { tool: ToolCallData }) {
  const details = tool.details ?? {};
  const items: SkillItem[] = Array.isArray(details.skills)
    ? details.skills
    : parseSkills(tool.output ?? '');

  if (items.length === 0) {
    if (!tool.output) return null;
    return <FallbackOutput text={tool.output} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8">
      <div className="border-b border-ink/8 bg-paper px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">Skills</span>
        <span className="ml-2 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
        {items.map((item, index) => {
          const name = itemName(item);
          if (!name) return null;
          const status = itemStatus(item);
          const scope = typeof item.scope === 'string' ? item.scope : undefined;
          const version = typeof item.version === 'string' ? item.version : undefined;
          const msg = typeof item.message === 'string' ? item.message : '';
          return (
            <div key={index} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
              {status === 'removed' ? (
                <PackageX size={11} className="shrink-0 text-error" />
              ) : (
                <PackageCheck size={11} className="shrink-0 text-ink/40" />
              )}
              <span className="shrink-0 font-mono text-[10px] font-semibold text-ink/70">{name}</span>
              {scope && <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">{scope}</span>}
              {version && <span className="font-mono text-[10px] text-ink/35">v{version}</span>}
              {msg && <span className="min-w-0 flex-1 truncate text-ink/65">{msg}</span>}
              <span className={`ml-auto shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] ${STATUS_STYLES[status]}`}>
                {status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
