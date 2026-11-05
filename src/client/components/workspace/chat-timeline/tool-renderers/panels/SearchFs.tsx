import { useMemo, useState } from 'preact/hooks';
import { File, Folder, FolderSearch } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { formatBytes } from '@/shared/lib/format/number';
import { CopyButton } from '@/client/components/common/CopyButton';

interface FsItem {
  path?: unknown;
  name?: unknown;
  type?: unknown;
  size?: unknown;
  matches?: unknown;
}

function itemPath(f: FsItem): string {
  return typeof f.path === 'string' ? f.path : typeof f.name === 'string' ? f.name : '';
}

function itemType(f: FsItem): 'file' | 'dir' | 'unknown' {
  const t = typeof f.type === 'string' ? f.type.toLowerCase() : '';
  if (t === 'file' || t === 'directory' || t === 'dir') return t === 'directory' || t === 'dir' ? 'dir' : 'file';
  return 'unknown';
}

/** Panel untuk tool `search_fs` (legacy) — hasil pencarian filesystem yang readable. */
export function SearchFs({ tool }: { tool: ToolCallData }) {
  const [filter, setFilter] = useState('');
  const details = tool.details ?? {};
  const rawItems: FsItem[] = Array.isArray(details.results) ? details.results : [];

  const items: FsItem[] = useMemo(() => {
    if (rawItems.length > 0) return rawItems;
    if (tool.output) {
      try {
        const data = JSON.parse(tool.output);
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') {
          if (Array.isArray(data.results)) return data.results;
          if (Array.isArray(data.items)) return data.items;
          if (Array.isArray(data.files)) return data.files;
        }
      } catch {}
    }
    const lines = (tool.output ?? '').split(/\r?\n/).filter(Boolean);
    return lines.map((line) => {
      const isDir = line.endsWith('/');
      return {
        path: line,
        type: isDir ? 'dir' : 'file',
      };
    });
  }, [rawItems, tool.output]);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const lower = filter.toLowerCase();
    return items.filter((it) => itemPath(it).toLowerCase().includes(lower));
  }, [items, filter]);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2.5 text-[11.5px] text-ink/45">
        <FolderSearch size={13} className="shrink-0" />
        <span>No filesystem matches found</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-lg border border-ink/8 bg-paper px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderSearch size={13} className="text-ink/60" />
          <span className="text-[11px] font-semibold text-ink">Filesystem Search</span>
          <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[10px] text-ink/50">
            {items.length} {items.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {items.length > 5 && (
            <input
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              className="h-6 w-24 rounded border border-ink/10 bg-canvas px-2 text-[10.5px] text-ink focus:outline-none"
            />
          )}
          <CopyButton
            text={items.map((it) => itemPath(it)).join('\n')}
            className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            label="Copy"
          />
        </div>
      </div>

      <div className="max-h-64 divide-y divide-ink/6 overflow-y-auto rounded-lg border border-ink/8 bg-paper">
        {filtered.map((item, index) => {
          const path = itemPath(item);
          if (!path) return null;
          const type = itemType(item);
          const size = typeof item.size === 'number' && item.size > 0 ? formatBytes(item.size) : '';

          return (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] transition-colors hover:bg-ink/[0.02]"
            >
              {type === 'dir' ? (
                <Folder size={12} className="shrink-0 text-ink/50" />
              ) : (
                <File size={12} className="shrink-0 text-ink/40" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink/80">{path}</span>
              {type !== 'unknown' && (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    type === 'dir' ? 'bg-ink/8 text-ink/60' : 'bg-ink/5 text-ink/45'
                  }`}
                >
                  {type}
                </span>
              )}
              {size && <span className="shrink-0 font-mono text-[10px] text-ink/40">{size}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
