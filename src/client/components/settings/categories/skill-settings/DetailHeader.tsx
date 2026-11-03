import type { ComponentChildren } from 'preact';
import { AlertCircle, Check, Eye, EyeOff, Loader2, Lock, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-preact';
import type { SkillItem } from '@/shared/types';
import { scopeLabel, sourceBadge } from '@/client/components/settings/categories/skill-settings/row-meta';

interface SkillDetailHeaderProps {
  skill: SkillItem | null;
  isCreatingNew: boolean;
  name: string;
  locationLabel: string;
  dirty: boolean;
  validationError: string | null;
  readOnly: boolean;
  hidden: boolean;
  isReloading: boolean;
  confirmingDelete: boolean;
  onReload?: () => void;
  onOpenCatalog?: () => void;
  onHiddenChange: (hidden: boolean) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onSave: () => void;
  /** A write is in flight: the buttons report that instead of accepting another. */
  saving?: boolean;
  /** The last write landed (flashes briefly). */
  saved?: boolean;
  /** The last write's refusal, in the server's own words. */
  writeError?: string | null;
  onDismissWriteError?: () => void;
}

function Badge({ children, title }: { children: ComponentChildren; title?: string }) {
  return (
    <span
      title={title}
      className="px-1.5 py-0.5 rounded-md border border-ink/15 bg-ink/[0.03] text-[10px] font-mono text-ink/65 whitespace-nowrap"
    >
      {children}
    </span>
  );
}

/**
 * The detail pane's identity and action bar.
 *
 * Everything a save would change is visible here — scope, provenance, the hidden
 * flag, and whether the draft differs from disk — and Save is disabled until
 * something does. The pane used to offer a permanent "Save Changes" that rewrote
 * an unchanged file, and had no read-only marker beyond a paragraph further down.
 */
export function SkillDetailHeader({
  skill,
  isCreatingNew,
  name,
  locationLabel,
  dirty,
  validationError,
  readOnly,
  hidden,
  isReloading,
  confirmingDelete,
  onReload,
  onOpenCatalog,
  onHiddenChange,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSave,
  saving = false,
  saved = false,
  writeError = null,
  onDismissWriteError,
}: SkillDetailHeaderProps) {
  const title = isCreatingNew ? 'New skill' : (skill?.name ?? name);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-ink/10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold tracking-tight text-ink truncate">{title}</h2>
            {!isCreatingNew && skill ? (
              <>
                <Badge title={skill.source}>{sourceBadge(skill)}</Badge>
                <Badge>{scopeLabel(skill)}</Badge>
                {readOnly ? (
                  <span className="flex items-center gap-1 text-[10px] text-ink/55">
                    <Lock size={10} />
                    read-only
                  </span>
                ) : null}
                {hidden ? <Badge>hidden</Badge> : null}
              </>
            ) : null}
            {dirty ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-ink/70">
                <span className="w-1.5 h-1.5 rounded-full bg-ink" />
                unsaved
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-ink/55 mt-0.5 truncate">
            {isCreatingNew
              ? `A new skill written to ${locationLabel}`
              : skill?.description || `No description · ${locationLabel}`}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onReload ? (
            <button
              type="button"
              onClick={onReload}
              disabled={isReloading}
              title="Re-discover skills in the running agents"
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink hover:bg-ink/5 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw size={12} className={isReloading ? 'animate-spin text-ink/70' : 'text-ink/70'} />
              <span className="hidden sm:inline">Reload</span>
            </button>
          ) : null}
          {onOpenCatalog ? (
            <button
              type="button"
              onClick={onOpenCatalog}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            >
              <Sparkles size={12} className="text-ink/70" />
              <span className="hidden sm:inline">Catalog</span>
            </button>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <div className="rounded-lg border border-ink/15 bg-ink/[0.03] px-3 py-2 text-[11px] text-ink/70 leading-relaxed">
          Provided by <span className="font-mono text-ink/85">{skill?.source}</span>, so Kabmo cannot edit it. The file
          is <span className="font-mono text-ink/85 break-all">{skill?.filePath}</span>. Edit it at its source, or
          import a copy into <span className="font-mono text-ink/85">~/.omp/agent/skills</span> to own it here.
        </div>
      ) : null}

      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={hidden}
          disabled={readOnly}
          onChange={(event) => onHiddenChange(event.currentTarget.checked)}
          className="mt-0.5 accent-ink cursor-pointer disabled:cursor-not-allowed"
        />
        <span className="text-[11px] text-ink/75 leading-relaxed">
          <span className="inline-flex items-center gap-1">
            Hide from the model&apos;s skill listing
            {hidden ? <EyeOff size={11} className="text-ink/45" /> : <Eye size={11} className="text-ink/45" />}
          </span>
          <span className="block text-[10px] text-ink/45">
            Still runnable via <span className="font-mono">/skill:{name || 'name'}</span>.
          </span>
        </span>
      </label>

      {validationError ? <p className="text-[11px] text-error leading-relaxed">{validationError}</p> : null}

      {writeError ? (
        <div className="flex items-start gap-1.5 rounded-lg border border-error/30 bg-error/5 px-2.5 py-2 text-[11px] text-error">
          <AlertCircle size={12} className="mt-px flex-shrink-0" />
          <span className="flex-1 break-words">{writeError}</span>
          {onDismissWriteError ? (
            <button type="button" onClick={onDismissWriteError} className="cursor-pointer text-error/60 hover:text-error" aria-label="Dismiss error">
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {!isCreatingNew && skill && !readOnly ? (
          confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onConfirmDelete}
                className="px-2 py-1.5 rounded-lg bg-error/15 border border-error/40 text-error text-[11px] font-semibold hover:bg-error/25 transition-colors cursor-pointer"
              >
                Delete permanently
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                className="px-2 py-1.5 rounded-lg border border-ink/20 text-[11px] font-medium text-ink/70 hover:bg-ink/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRequestDelete}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-[11px] font-medium transition-colors cursor-pointer"
            >
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
          )
        ) : (
          <div />
        )}

        {!readOnly ? (
          <button
            type="button"
            onClick={onSave}
            disabled={saving || Boolean(validationError) || (!dirty && !isCreatingNew)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-paper text-[11px] font-medium hover:bg-ink/90 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            <span>{saving ? 'Saving…' : isCreatingNew ? 'Create skill' : 'Save changes'}</span>
          </button>
        ) : null}
      </div>

      {saved ? (
        <p className="flex items-center gap-1 text-[10px] text-ink/60">
          <Check size={10} />
          Saved
        </p>
      ) : !readOnly && !dirty && !isCreatingNew ? (
        <p className="flex items-center gap-1 text-[10px] text-ink/40">
          <Check size={10} />
          Nothing to write
        </p>
      ) : null}
    </div>
  );
}
