import { useState } from 'preact/hooks';
import { AlertCircle, RefreshCw } from 'lucide-preact';
import type { UsageResetAccount } from '@/shared/types';
import { formatDateTime } from '@/client/components/settings/categories/usage-settings/format';
import { useUsageResets } from '@/client/hooks/settings/useUsageResets';

/** One account's row: what it holds, why not, and the spend button. */
function AccountRow({
  account,
  onSpend,
  spending,
}: {
  account: UsageResetAccount;
  onSpend: (target: string) => void;
  spending: boolean;
}) {
  const target = `${account.provider}/${account.credentialId}`;
  const identity = account.email ?? account.accountId ?? account.credentialId;
  const organization = account.orgName ?? account.orgId;
  const available = account.availableCount ?? account.credits.length;
  // omp decides what may be spent; Kabmo only renders that verdict. A
  // zero here is a real answer ("nothing to spend right now"), not an error.
  const redeemable = account.redeemableCount ?? 0;
  const reason = account.error ?? account.unavailableReason;

  return (
    <div className="bg-paper border border-ink/15 rounded-lg p-3 shadow-xs space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-ink truncate">
            {identity}
            {organization ? <span className="text-ink/50 font-normal"> · {organization}</span> : null}
          </div>
          <div className="text-[10px] text-ink/50 font-mono truncate">{target}</div>
        </div>
        <span className="text-[10px] text-ink/60 flex-shrink-0 whitespace-nowrap">
          {redeemable > 0 ? `${redeemable} of ${available} usable` : `${available} saved`}
        </span>
      </div>

      {account.soonestExpiry !== undefined && (
        <div className="text-[10px] text-ink/60">
          Soonest expires {formatDateTime(new Date(account.soonestExpiry).toISOString())}
        </div>
      )}

      {account.credits.length > 0 && (
        <div className="space-y-1">
          {account.credits.map((credit) => (
            <div key={credit.id} className="flex items-center justify-between gap-2 text-[10px] text-ink/70">
              <span className="truncate">{credit.title ?? credit.program ?? credit.id}</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                {credit.clears && credit.clears.length > 0 && (
                  <span className="font-mono text-ink/50">{credit.clears.join(', ')}</span>
                )}
                {credit.usable === false && (
                  <span className="font-mono uppercase px-1.5 py-0.5 rounded bg-ink/10 text-ink/60">blocked</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* A reason from omp is shown, never a bare disabled button: "nothing to
          reset right now" and "the provider did not identify a grant" are
          different answers and the user acts on them differently. */}
      {reason && <div className="text-[10px] text-ink/60 leading-snug">{reason}</div>}

      <button
        type="button"
        onClick={() => onSpend(target)}
        disabled={spending || redeemable === 0}
        title={redeemable === 0 ? reason ?? 'Nothing to spend on this account right now.' : `Spend a saved reset on ${target}`}
        className="w-full rounded-md border border-ink/15 px-2 py-1 text-[11px] font-medium text-ink/80 hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {spending ? 'Spending…' : 'Spend saved reset'}
      </button>
    </div>
  );
}

/**
 * Saved rate-limit resets for every Codex and Claude account.
 *
 * A spend is irreversible and happens at the provider, so the outcome sentence
 * (omp's own — it names `already redeemed`, `nothing to reset`, `no account`)
 * is rendered under the rows and kept until the next action, rather than
 * flashed: the user has to be able to read why a spend did not clear anything.
 */
export function SavedResetsSection() {
  const { accounts, error, isLoading, reload, spend } = useUsageResets();
  const [spendingTarget, setSpendingTarget] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSpend = (target: string) => {
    setSpendingTarget(target);
    setOutcome(null);
    void spend(target).then((result) => {
      setOutcome(result);
      setSpendingTarget(null);
    });
  };

  // An empty list from a SUCCESSFUL read is the normal "you have none" case;
  // a failed read is reported, because the two look identical on screen.
  const showEmpty = !isLoading && !error && accounts.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-ink">Saved rate-limit resets</div>
          <div className="text-[10px] text-ink/50 leading-snug">
            Provider-issued resets for Codex and Claude accounts. Spending one clears the window it covers.
          </div>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={isLoading}
          title="Re-read saved resets"
          className="p-1.5 bg-paper border border-ink/15 rounded-md hover:bg-ink/5 text-ink/80 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin text-ink' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[10px] text-error leading-snug">
          <AlertCircle size={12} className="flex-shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {accounts.map((account) => (
        <AccountRow
          key={`${account.provider}/${account.credentialId}`}
          account={account}
          onSpend={handleSpend}
          spending={spendingTarget === `${account.provider}/${account.credentialId}`}
        />
      ))}

      {showEmpty && (
        <p className="text-[10px] text-ink/50 leading-snug">
          No saved resets on any account.
        </p>
      )}

      {outcome && (
        <div className={`text-[10px] leading-snug ${outcome.ok ? 'text-ink/70' : 'text-error'}`}>
          {outcome.message}
        </div>
      )}
    </div>
  );
}
