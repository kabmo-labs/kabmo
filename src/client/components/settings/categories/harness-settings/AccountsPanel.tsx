/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Saved accounts for one harness, in their OWN section.
 *
 * The launch command and provider panel describe how the agent runs; an account
 * describes which login it runs as. Keeping them apart is deliberate: changing
 * `CODEX_HOME` in the environment box used to change every new chat with no
 * record of whose login it was, and no way back.
 *
 * A new account starts as an empty home. The panel shows the exact sign-in
 * command, and Verify reads the CLI's own token. Kabmo never stores it.
 */

import { useState } from 'preact/hooks';
import { Check, Loader2, ShieldCheck, ShieldOff, Trash2, X } from 'lucide-preact';
import { CopyButton } from '@/client/components/common/CopyButton';
import { AccountLoginPanel } from '@/client/components/settings/categories/harness-settings/AccountLoginPanel';
import { AddAccountForm } from '@/client/components/settings/categories/harness-settings/AddAccountForm';
import type { AccountMutationResult } from '@/client/hooks/models/harness-accounts';
import type { HarnessAccountView } from '@kabmo-labs/kabmo-harness/accounts';

export interface AccountsPanelProps {
  harness: string;
  accounts: HarnessAccountView[];
  selectedId: string | null;
  onCreate: (label: string) => Promise<AccountMutationResult>;
  onSelect: (accountId: string | null) => Promise<AccountMutationResult>;
  onRename: (accountId: string, label: string) => Promise<AccountMutationResult>;
  onRemove: (accountId: string) => Promise<AccountMutationResult>;
  onVerify: (accountId: string) => Promise<AccountMutationResult>;
  /** Probe the now-active account so its models are ready without a second click. */
  onProbe?: () => Promise<string | null>;
}
const BUTTON =
  'cursor-pointer rounded-md border border-ink/15 px-2 py-1 text-[11px] text-ink/65 transition-colors hover:border-ink/35 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40';

export function HarnessAccountsPanel({
  harness, accounts, selectedId, onCreate, onSelect, onRename, onRemove, onVerify, onProbe,
}: AccountsPanelProps) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);

  /** One place folds a refusal or a success into the panel's visible state. */
  const run = async (key: string, action: () => Promise<AccountMutationResult>) => {
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      const result = await action();
      setProblem(result.error);
      if (!result.error && result.createdId) setExpanded(result.createdId);
      if (!result.error && result.detail && result.signedIn !== false) setNotice(result.detail);
      return result;
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (busy) return;
    const result = await run('create', () => onCreate(label));
    if (!result.error) setLabel('');
  };

  const verify = async (account: HarnessAccountView) => {
    const result = await run(`verify:${account.id}`, () => onVerify(account.id));
    if (!result.error && result.signedIn === false) setExpanded(account.id);
  };

  /** Probe after a switch, so "Use" leaves the account ready to chat. */
  const probeNow = async (key: string): Promise<void> => {
    if (!onProbe) return;
    setBusy(key);
    try {
      const failure = await onProbe();
      if (failure) setProblem(`The account is active, but the agent check failed: ${failure}`);
    } finally {
      setBusy(null);
    }
  };

  /** Select the account, and open its sign-in terminal if it has no login yet. */
  const useAccount = async (account: HarnessAccountView) => {
    const result = await run(`select:${account.id}`, () => onSelect(account.id));
    if (result.error) return;
    if (!account.signedIn) {
      setLoginId(account.id);
      return;
    }
    await probeNow(`probe:${account.id}`);
  };

  const useSystemDefault = async () => {
    const result = await run('select:default', () => onSelect(null));
    if (!result.error) await probeNow('probe:default');
  };

  /** The PTY exits when the sign-in command returns; Verify reads its result. */
  const finishSignIn = async (account: HarnessAccountView) => {
    setLoginId(null);
    const result = await run(`verify:${account.id}`, () => onVerify(account.id));
    if (!result.error && result.signedIn === false) setExpanded(account.id);
    if (!result.error && result.signedIn) await probeNow(`probe:${account.id}`);
  };

  const saveName = async (id: string) => {
    if (busy) return;
    const result = await run(`rename:${id}`, () => onRename(id, draft));
    if (!result.error) setEditing(null);
  };

  return (
    <section className="mt-3 space-y-3 border-t border-ink/10 pt-3" aria-label="Saved accounts">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Accounts</span>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted">
            Each saved account is its own CLI home. New chats use the selected account; a chat that is already running keeps the one it started on.
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted">{accounts.length} saved</span>
      </div>

      {problem && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-error/30 bg-error/5 px-2.5 py-2 text-[11px] text-error" role="alert">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} className="cursor-pointer" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}
      {notice && !problem && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-ink/10 bg-ink/[0.02] px-2.5 py-2 text-[11px] text-ink/65" role="status">
          <span className="inline-flex items-center gap-1.5"><Check size={11} className="text-success" /> {notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${selectedId === null ? 'border-ink/25 bg-ink/[0.03]' : 'border-ink/10'}`}>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-ink">System default</div>
            <div className="text-[10px] leading-relaxed text-muted">
              The login this machine already has. No home is injected.
            </div>
          </div>
          <button
            type="button"
            aria-pressed={selectedId === null}
            disabled={selectedId === null || busy !== null}
            onClick={() => void useSystemDefault()}
            className={BUTTON}
          >
            {selectedId === null ? 'In use' : 'Use'}
          </button>
        </div>

        {accounts.length === 0 && (
          <p className="rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2 text-[11px] leading-relaxed text-muted">
            No saved accounts yet. New chats use the system default login above; add an account to keep this harness on its own home.
          </p>
        )}

        {accounts.map((account) => {
          const selected = account.id === selectedId;
          return (
            <div
              key={account.id}
              className={`rounded-lg border px-3 py-2 ${selected ? 'border-ink/25 bg-ink/[0.03]' : 'border-ink/10'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {editing === account.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={draft}
                        autoFocus
                        maxLength={80}
                        aria-label="Account name"
                        onInput={(event) => setDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveName(account.id);
                          if (event.key === 'Escape') setEditing(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-ink/25 bg-paper px-1.5 py-1 text-[11px] text-ink outline-none focus:border-ink/50"
                      />
                      <button type="button" onClick={() => void saveName(account.id)} disabled={busy !== null} className={BUTTON}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={BUTTON}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-ink">{account.label}</span>
                      {selected && (
                        <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink/60">
                          In use
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                        {account.signedIn ? <ShieldCheck size={10} /> : <ShieldOff size={10} />}
                        {account.signedIn ? 'Signed in' : 'Not signed in'}
                      </span>
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-muted">
                    {account.identity.email ?? account.identity.organization ?? account.detail}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted" title={account.homePath}>
                    {account.homePath}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {!selected && (
                    <button
                      type="button"
                      aria-pressed={false}
                      disabled={busy !== null}
                      onClick={() => void useAccount(account)}
                      className={BUTTON}
                    >
                      {account.signedIn ? 'Use' : 'Use & sign in'}
                    </button>
                  )}
                  {!account.signedIn && selected && loginId !== account.id && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setProblem(null);
                        setNotice(null);
                        setLoginId(account.id);
                      }}
                      className={`${BUTTON} border-ink/30 text-ink`}
                      title="Run this account's sign-in command in a Kabmo terminal"
                    >
                      Sign in
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void verify(account)}
                    className={BUTTON}
                    title="Read this home's own token and show who is signed in"
                  >
                    {busy === `verify:${account.id}` ? <Loader2 size={11} className="animate-spin" /> : 'Verify'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setEditing(account.id);
                      setDraft(account.label);
                    }}
                    className={BUTTON}
                  >
                    Rename
                  </button>
                  {confirmRemove === account.id ? (
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run(`remove:${account.id}`, () => onRemove(account.id))}
                        className={`${BUTTON} border-error/40 text-error`}
                      >
                        Remove home
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className={BUTTON}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirmRemove(account.id)}
                      className={BUTTON}
                      aria-label={`Remove ${account.label}`}
                      title="Delete this account's Kabmo-owned home"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>

              {confirmRemove === account.id && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
                  Deletes this home and its login. Chats already running keep their process but cannot refresh the login.
                </p>
              )}

              {loginId === account.id && (
                <AccountLoginPanel
                  accountId={account.id}
                  onFinished={() => void finishSignIn(account)}
                  onClose={() => setLoginId(null)}
                />
              )}

              {loginId !== account.id && (!account.signedIn || expanded === account.id) && (
                <div className="mt-2 rounded-md border border-ink/10 bg-ink/[0.02] p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-muted">Sign in this home</span>
                    <CopyButton text={account.loginCommand} title="Copy sign-in command" ariaLabel="Copy sign-in command" label="Copy" />
                  </div>
                  <code className="block break-all font-mono text-[10px] leading-relaxed text-ink/65">
                    {account.loginCommand}
                  </code>
                  {!account.signedIn && (
                    <p className="mt-1 text-[10px] leading-relaxed text-muted">
                      Run it in a terminal, finish the browser sign-in, then press Verify.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AddAccountForm
        harness={harness}
        label={label}
        busy={busy !== null}
        onLabel={setLabel}
        onAdd={() => void add()}
      />
    </section>
  );
}
