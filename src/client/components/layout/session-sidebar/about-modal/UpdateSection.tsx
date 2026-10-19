import { AlertCircle, Check, Download, Loader2, RefreshCw, Sparkles } from 'lucide-preact';
import type { UpdateTarget, UpdateTargetInfo } from '@/shared/types/updates';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import { UpdateLog } from '@/client/components/common/UpdateLog';
import { UPDATE_POPUP_OPEN_EVENT } from '@/shared/lib/updates/popup-state';

interface UpdateSectionProps {
  updates: UseUpdatesResult;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

interface UpdateRowProps {
  target: UpdateTarget;
  info: UpdateTargetInfo;
  applying: boolean;
  disabled: boolean;
  onApply: (target: UpdateTarget) => void;
}

const actionClassName = 'inline-flex items-center gap-1.5 rounded-md border border-ink/20 px-2.5 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50';

function UpdateRow({ target, info, applying, disabled, onApply }: UpdateRowProps) {
  const label = target === 'ompchamber' ? 'Kabmo' : 'Oh-My-Pi';
  const versionText = `v${info.current ?? '…'} → v${info.latest ?? '…'}`;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink/10 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink">{label}</p>
        <p className="font-mono text-[10px] text-ink/60">
          {info.installed ? versionText : 'not detected'}
        </p>
      </div>
      {info.installed ? (
        <button
          type="button"
          onClick={() => onApply(target)}
          disabled={disabled}
          className={actionClassName}
        >
          {applying ? (
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Download size={12} />
          )}
          <span>Update</span>
        </button>
      ) : (
        <span className="shrink-0 text-[10px] text-ink/40">not detected</span>
      )}
    </div>
  );
}

export function UpdateSection({ updates, onToast }: UpdateSectionProps) {
  const updateRows = updates.info
    ? [
        { target: 'ompchamber' as const, info: updates.info.ompchamber },
        { target: 'omp' as const, info: updates.info.omp },
      ].filter(({ info }) => info.updateAvailable && info.latest !== null)
    : [];

  const handleApply = async (target: UpdateTarget) => {
    const result = await updates.apply(target);
    if (!onToast) return;

    // A null result means the run was aborted with the panel (an unmount, a
    // page tear-down): there is nobody left to tell.
    if (!result) return;

    // `manual` means the environment cannot self-update and the message is the
    // command to run — action required, not a success.
    onToast(result.message, result.success && !result.manual ? 'success' : 'error');
  };

  const showResult = Boolean(updates.info && !updates.checking && !updates.error);

  return (
    <section className="mt-5 border-y border-ink/10 py-3 text-left" aria-labelledby="updates-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="updates-heading" className="text-xs font-semibold text-ink">Updates</h3>
        {updates.info && <span className="font-mono text-[9px] text-ink/40">checked</span>}
      </div>

      {updates.progress && (
        <UpdateLog state={updates.progress} active={updates.applying !== null} />
      )}

      <div className="mt-2.5">
        {updates.checking && (
          <button type="button" disabled className={`${actionClassName} w-full justify-center`}>
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
            <span>Checking…</span>
          </button>
        )}

        {updates.error && !updates.checking && (
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-error" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-4 text-error">{updates.error}</p>
              <button
                type="button"
                onClick={() => void updates.check()}
                className={`${actionClassName} mt-2`}
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {!updates.info && !updates.checking && !updates.error && (
          <button
            type="button"
            onClick={() => void updates.check()}
            className={`${actionClassName} w-full justify-center`}
          >
            <RefreshCw size={13} />
            <span>Check for updates</span>
          </button>
        )}

        {showResult && updateRows.length === 0 && (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[11px] text-success">
              <Check size={13} />
              <span>You&apos;re up to date</span>
            </p>
            <button
              type="button"
              onClick={() => void updates.check()}
              className={actionClassName}
            >
              <RefreshCw size={12} />
              <span>Check again</span>
            </button>
          </div>
        )}

        {showResult && updateRows.length > 0 && (
          <div>
            {updateRows.map(({ target, info }) => (
              <UpdateRow
                key={target}
                target={target}
                info={info}
                applying={updates.applying === target}
                disabled={updates.applying !== null}
                onApply={(selectedTarget) => void handleApply(selectedTarget)}
              />
            ))}
            {updates.info?.ompchamber.updateAvailable && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent(UPDATE_POPUP_OPEN_EVENT))}
                disabled={updates.applying !== null}
                className={`${actionClassName} mt-2 w-full justify-center`}
              >
                <Sparkles size={12} />
                <span>What&apos;s new in {updates.info.ompchamber.latest}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void updates.check()}
              disabled={updates.applying !== null}
              className={`${actionClassName} mt-2 w-full justify-center`}
            >
              <RefreshCw size={12} />
              <span>Check again</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
