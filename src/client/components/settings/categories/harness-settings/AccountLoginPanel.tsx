/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A spawned sign-in, drawn as Kabmo UI instead of an embedded terminal.
 *
 * The server runs the CLI on a PTY and returns the auth URL plus the last lines
 * of output. This panel opens the URL, accepts the code the page shows, and
 * polls until the process exits. A normal exit calls `onFinished`, which is
 * where the parent runs Verify and the automatic probe.
 *
 * No terminal renderer is mounted: the PTY is an implementation detail of the
 * login command, not a surface the user has to operate.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { ExternalLink, Loader2, X } from 'lucide-preact';
import {
  accountLoginStatus,
  cancelAccountLogin,
  startAccountLogin,
  submitAccountLoginInput,
  type AccountLoginView,
} from '@/client/hooks/models/harness-accounts';

export interface AccountLoginPanelProps {
  accountId: string;
  onFinished: () => void;
  onClose: () => void;
}

export function AccountLoginPanel({ accountId, onFinished, onClose }: AccountLoginPanelProps) {
  const [view, setView] = useState<AccountLoginView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const finishedRef = useRef(false);
  const codeId = `login-code-${accountId}`;

  useEffect(() => {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const apply = (next: AccountLoginView | null) => {
      if (stopped || !next) return;
      setView(next);
      if (next.phase === 'done' && !finishedRef.current) {
        finishedRef.current = true;
        stop();
        onFinished();
      }
      if (next.phase === 'error' || next.phase === 'cancelled') stop();
    };

    const poll = async () => {
      const result = await accountLoginStatus(accountId);
      if (stopped) return;
      if (result.error) setProblem(result.error);
      else if (!result.login) {
        setProblem('The sign-in job is no longer running.');
        stop();
        return;
      } else apply(result.login);
      if (!stopped) timer = setTimeout(() => void poll(), 800);
    };

    void startAccountLogin(accountId).then((result) => {
      if (stopped) return;
      if (result.error) {
        setProblem(result.error);
        stop();
        return;
      }
      if (!result.login) {
        setProblem('The sign-in job did not start.');
        stop();
        return;
      }
      apply(result.login);
      if (!stopped) timer = setTimeout(() => void poll(), 800);
    });

    return () => {
      stop();
      void cancelAccountLogin(accountId);
    };
    // One mount is one login attempt; the parent remounts by changing the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const submit = async () => {
    const text = code.trim();
    if (!text || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const result = await submitAccountLoginInput(accountId, text);
      if (result.error) setProblem(result.error);
      else if (result.login) setView(result.login);
      setCode('');
    } finally {
      setSending(false);
    }
  };

  const running = !view || view.phase === 'running';
  const label = !view
    ? 'Starting the sign-in command...'
    : view.phase === 'running'
      ? 'Waiting for sign-in...'
      : view.phase === 'done'
        ? 'Sign-in finished. Verifying...'
        : view.phase === 'cancelled'
          ? 'Sign-in cancelled'
          : 'Sign-in failed';

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-ink/15 bg-paper">
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-muted">
          {running ? <Loader2 size={11} className="animate-spin" /> : null}
          {label}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink/15 px-1.5 py-0.5 text-[10px] text-ink/70 transition-colors hover:border-ink/35 hover:text-ink"
          aria-label="Close sign-in"
          title="Stop the sign-in process and close this panel"
        >
          <X size={11} /> Close
        </button>
      </div>

      <div className="space-y-2 p-2.5">
        {view?.url && (
          <div>
            <div className="mb-1 text-[10px] font-medium text-muted">Open this page to sign in</div>
            <div className="flex items-start gap-1.5">
              <a
                href={view.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-info underline underline-offset-2"
              >
                {view.url}
              </a>
              <a
                href={view.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-ink/15 px-1.5 py-1 text-[10px] text-ink/70 transition-colors hover:border-ink/35 hover:text-ink"
              >
                <ExternalLink size={10} /> Open
              </a>
            </div>
          </div>
        )}

        {view && view.lines.length > 0 && (
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-ink/10 bg-ink/[0.02] p-2 font-mono text-[10px] leading-relaxed text-ink/65">
            {view.lines.join('\n')}
          </pre>
        )}

        {running && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <label htmlFor={codeId} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[10px] font-medium text-muted">
                  Code shown by the page (only if it asks)
                </span>
                <input
                  id={codeId}
                  type="text"
                  value={code}
                  autoComplete="one-time-code"
                  placeholder="Paste code"
                  onInput={(event) => setCode(event.currentTarget.value)}
                  className="w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-muted focus:border-ink/50"
                />
              </label>
              <button
                type="submit"
                disabled={sending || !code.trim()}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1.5 text-[11px] text-ink/75 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? <Loader2 size={11} className="animate-spin" /> : null}
                Send code
              </button>
            </div>
          </form>
        )}

        {view?.phase === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-error/30 bg-error/5 px-2 py-1.5 text-[10px] text-error">
            <span>{view.error ?? 'The sign-in command failed.'}</span>
            <button
              type="button"
              onClick={onFinished}
              className="cursor-pointer rounded border border-error/40 px-1.5 py-0.5 text-[10px]"
            >
              Verify anyway
            </button>
          </div>
        )}
        {problem && <p className="text-[10px] text-error">{problem}</p>}
      </div>
    </div>
  );
}
