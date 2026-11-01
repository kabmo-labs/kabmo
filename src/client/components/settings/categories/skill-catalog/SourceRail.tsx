import { GitBranch, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import type { SkillCatalogSource } from '@/shared/types';

interface SourceRailProps {
  sources: SkillCatalogSource[];
  onScan: (id: string) => void;
  onImportFrom: (repo: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  scanningId: string | null;
  busy: boolean;
}

/** "Scanned 2m ago" from the stored timestamp, or the honest "Not scanned". */
export function describeScan(source: SkillCatalogSource): string {
  if (source.skillCount === null) return 'Not scanned';
  const count = `${source.skillCount} skill${source.skillCount === 1 ? '' : 's'}`;
  if (!source.scannedAt) return count;
  const minutes = Math.floor((Date.now() - source.scannedAt) / 60_000);
  if (minutes < 1) return `${count} · just scanned`;
  if (minutes < 60) return `${count} · scanned ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${count} · scanned ${hours}h ago`;
  return `${count} · scanned ${Math.floor(hours / 24)}d ago`;
}

/**
 * The Sources tab: every git repository Kabmo offers as a skill source.
 *
 * A source used to be a card with a star count and an "updated" line that no
 * request produced, and its "Add your own source" button posted a body the server
 * did not understand. This list only shows what is stored, its count is the
 * number the last scan actually found, and every action here has a route behind
 * it.
 */
export function SourceRail({
  sources,
  onScan,
  onImportFrom,
  onRemove,
  onAdd,
  scanningId,
  busy,
}: SourceRailProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink/60 leading-relaxed max-w-xl">
          A source is a git repository. Kabmo clones it only when you scan or import, so adding one costs nothing
          until you use it.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer flex-shrink-0"
        >
          <Plus size={13} />
          <span>Add source</span>
        </button>
      </div>

      <div className="rounded-xl border border-ink/15 divide-y divide-ink/10 overflow-hidden">
        {sources.length === 0 ? (
          <p className="p-6 text-xs text-ink/60 text-center">
            No sources yet. Add a repository, or paste one into <span className="font-semibold">From Git</span>.
          </p>
        ) : (
          sources.map((source) => {
            const isScanning = scanningId === source.id;
            return (
              <div key={source.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 bg-paper">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-ink truncate">{source.name}</span>
                    {source.isCustom ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink/8 text-ink/60 flex-shrink-0">custom</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink/55 font-mono truncate">
                    <GitBranch size={11} className="flex-shrink-0" />
                    <span className="truncate">{source.repo}</span>
                  </div>
                  <div className="text-[11px] text-ink/50 mt-0.5">{describeScan(source)}</div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => onScan(source.id)}
                    disabled={busy || isScanning}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink hover:bg-ink/5 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {isScanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    <span>{isScanning ? 'Scanning…' : 'Scan'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onImportFrom(source.repo)}
                    disabled={busy}
                    className="px-2 py-1 rounded-md border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink hover:bg-ink/5 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(source.id)}
                    disabled={busy}
                    title={`Remove ${source.name} from the source list`}
                    aria-label={`Remove ${source.name}`}
                    className="p-1 rounded-md text-ink/40 hover:text-error hover:bg-error/10 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
