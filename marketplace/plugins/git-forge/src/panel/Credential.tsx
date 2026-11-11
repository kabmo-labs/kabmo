/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The credential sheet: which token is in use, and whether it can write.
 *
 * There is no field to TYPE a token here: the host owns a plugin's declared
 * settings (`settings-schema.json`), so a second editor in a panel would be a
 * copy that disagrees with the real one. What the sheet does instead is name the
 * sources that actually work (the plugin setting, the server's environment, or a
 * logged-in `gh`/`glab`) and PROBE the one in use, so a reader who sees no write
 * buttons learns whether that is because their token is read-only.
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
  cli: 'the logged-in gh / glab CLI',
  none: 'nothing: reads are anonymous',
};

const FOCUS = 'tap-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20';

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
      ? { text: 'This credential can write.', tone: 'text-success-text' }
      : current?.writeScope === false
        ? { text: 'This credential is read-only: no write verb will be offered.', tone: 'text-warning-text' }
        : current?.present
          ? {
              text: 'This host does not report a scope, so write verbs are offered and a refusal is reported if one is refused.',
              tone: 'text-ink/70',
            }
          : { text: 'No credential: public repositories only, and no write verbs.', tone: 'text-ink/70' };

  return (
    <div className="flex flex-col gap-1 rounded border border-ink/20 bg-canvas p-2" role="region" aria-label="Credential">
      <div className="flex items-center gap-1.5">
        <Glyph path={ICON.key} size={11} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/60">Credential</span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close the credential sheet"
          className={`ml-auto cursor-pointer rounded p-0.5 text-ink/50 transition-colors hover:text-ink ${FOCUS}`}
        >
          <Glyph path={ICON.cross} size={11} />
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-ink/80">
        Reading with <span className="font-medium text-ink">{SOURCE[current?.source ?? 'none']}</span>.
      </p>
      <p className={`text-[10px] leading-relaxed ${write.tone}`}>{write.text}</p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void runProbe()}
          disabled={probe.pending || !current?.present}
          className={`cursor-pointer rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:cursor-default disabled:opacity-40 ${FOCUS}`}
        >
          {probe.pending ? 'Checking…' : 'Check write scope'}
        </button>
        <span className="text-[10px] text-ink/55">one request; a read-only token is what hides the verbs</span>
      </div>

      {probe.error && <p className="text-[10px] leading-relaxed text-error-text">{probe.error.message}</p>}

      <p className="text-[10px] leading-relaxed text-ink/55">
        Set a token in <span className="font-medium text-ink/70">Settings → Plugins Kabmo → Forge</span>, or with{' '}
        <span className="font-mono">GITHUB_TOKEN</span> / <span className="font-mono">GITLAB_TOKEN</span> /{' '}
        <span className="font-mono">GITEA_TOKEN</span> / <span className="font-mono">BITBUCKET_TOKEN</span> in the
        server’s environment, or by running <span className="font-mono">gh auth login</span>.
      </p>
    </div>
  );
}
