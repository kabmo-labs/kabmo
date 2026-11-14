import { Check, Download, ExternalLink, Loader2 } from 'lucide-preact';
import type { CatalogSkillItem } from '@/shared/types';

interface SkillCardProps {
  skill: CatalogSkillItem;
  installed: boolean;
  /** This row's own request is in flight — other rows stay clickable. */
  busy: boolean;
  onInstallToggle: (skill: CatalogSkillItem) => void;
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/**
 * One catalog row.
 *
 * The install button carries three states and they are deliberately different:
 * a spinner while THIS row's request runs (so a second click cannot start a
 * second install), the installed state and a download state. The previous single
 * button flipped its label only after the whole list reloaded, so a slow install
 * looked like a dead click and a double-click ran the CLI twice.
 */
export function SkillCard({ skill, installed, busy, onInstallToggle }: SkillCardProps) {
  return (
    <div className="p-4 rounded-xl border border-ink/15 hover:border-ink/30 bg-paper transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div className="space-y-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-ink tracking-tight font-mono truncate">{skill.name}</span>
          {skill.installs ? (
            <span className="text-[10px] text-ink/45 font-mono flex-shrink-0">{compactCount(skill.installs)} weekly</span>
          ) : null}
        </div>

        {skill.description ? (
          <p className="text-xs text-ink/75 leading-relaxed line-clamp-2">{skill.description}</p>
        ) : null}

        <div className="text-[11px] text-ink/50 font-mono truncate pt-1">{skill.repoTag}</div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
        {skill.githubUrl ? (
          <a
            href={skill.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            title="Open the repository"
            aria-label={`Open the repository for ${skill.name}`}
          >
            <ExternalLink size={14} />
          </a>
        ) : null}

        <button
          type="button"
          onClick={() => onInstallToggle(skill)}
          disabled={busy}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-default disabled:opacity-60 ${
            installed
              ? 'border border-ink/20 text-ink/80 hover:border-error hover:text-error hover:bg-error/5'
              : 'bg-ink text-paper hover:bg-ink/90 shadow-xs'
          }`}
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span>{installed ? 'Removing…' : 'Installing…'}</span>
            </>
          ) : installed ? (
            <>
              <Check size={12} />
              <span>Installed</span>
            </>
          ) : (
            <>
              <Download size={12} />
              <span>Install</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
