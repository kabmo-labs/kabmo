/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The credential sheet: which token is in use, and whether it can write.
 *
 * There is no field to TYPE a token here, and that is deliberate rather than
 * unfinished. This host has no editor for a panel plugin's declared settings —
 * no route, no form — so a field would collect a value nothing stores. What the
 * sheet does instead is name the sources that actually work (the server's
 * environment, or a logged-in `gh`/`glab`) and PROBE the one in use, so a reader
 * who sees no write buttons learns whether that is because their token is
 * read-only.
 *
 * `writeScope` has three answers and they are drawn differently:
 *
 * - `true` — the token can write;
 * - `false` — it cannot, and that is the actionable case;
 * - `null` — the host does not say (a fine-grained GitHub token, Gitea,
 *   Bitbucket), so the panel does not claim either.
 */

import { useState } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import { RPC, type ForgeCredential } from '../protocol';
import type { Scope } from './use-forge';
import { Glyph, ICON } from './Glyph';

interface CredentialSheetProps {
  scope: Scope | null;
  credential: ForgeCredential | null;
  onClose: () => void;
}

const SOURCE: Record<ForgeCredential['source'], string> = {
  setting: 'the plugin’s own setting',
  environment: 'a variable in the server’s environment',
  cli: 'the logged-in `gh` / `glab` CLI',
  none: 'nothing — reads are anonymous',
};

export function CredentialSheet({ scope, credential, onClose }: CredentialSheetProps) {
  const probe = useRpc<{ root: string; repo: string; probe: boolean }, ForgeCredential>(RPC.credential);
  const [probed, setProbed] = useState<ForgeCredential | null>(null);
  const current = probed ?? credential;

  const runProbe = async () => {
    if (!scope) return;
    const outcome = await probe.call({ ...scope, probe: true });
    if (outcome.ok) setProbed(outcome.value as ForgeCredential);
  };

  const write =
    current?.writeScope === true
      ? { text: 'This credential can write.', tone: 'text-success' }
      : current?.writeScope === false
        ? { text: 'This credential is read-only: no write verb will be offered.', tone: 'text-warning' }
        : current?.present
          ? { text: 'This host does not report a scope, so write verbs are offered and a refusal is reported if one is refused.', tone: 'text-ink/60' }
          : { text: 'No credential: public repositories only, and no write verbs.', tone: 'text-ink/60' };

  return (
    <div className="rounded border border-ink/20 bg-canvas p-2">
      <div className="flex items-center gap-1.5">
        <Glyph path={ICON.forge} size={11} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/60">Credential</span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close the credential sheet"
          className="ml-auto rounded p-0.5 text-ink/50 hover:text-ink"
        >
          <Glyph path={ICON.cross} size={11} />
        </button>
      </div>

      <p className="mt-1 text-[11px] text-ink/75">
        Reading with <span className="font-medium text-ink">{SOURCE[current?.source ?? 'none']}</span>.
      </p>
      <p className={`mt-0.5 text-[10.5px] ${write.tone}`}>{write.text}</p>

      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void runProbe()}
          disabled={probe.pending || !current?.present}
          className="rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
        >
          {probe.pending ? 'Checking…' : 'Check write scope'}
        </button>
        <span className="text-[9.5px] text-ink/45">one request; a read-only token is what hides the verbs</span>
      </div>

      {probe.error && <p className="mt-1 text-[10px] text-error">{probe.error.message}</p>}

      <p className="mt-1.5 text-[9.5px] leading-snug text-ink/45">
        Set a token with <span className="font-mono">GITHUB_TOKEN</span> / <span className="font-mono">GITLAB_TOKEN</span>{' '}
        / <span className="font-mono">GITEA_TOKEN</span> / <span className="font-mono">BITBUCKET_TOKEN</span> in the
        server’s environment and restart it, or run <span className="font-mono">gh auth login</span>.
      </p>
    </div>
  );
}
