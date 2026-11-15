/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which cloudflared config the Cloudflare row reads.
 *
 * Shown because a machine can hold more than one config (a work profile, a
 * secret store) and the tunnel's own state cannot answer "which file am I
 * using?". Saving is a server action: the path is refused unless cloudflared
 * could actually run from it, and the refusal is the server's sentence.
 */

import { useEffect, useState } from 'preact/hooks';

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50';

export interface CloudflareConfigProps {
  path: string;
  busy: boolean;
  onSave: (path: string) => void;
}

export function CloudflareConfig({ path, busy, onSave }: CloudflareConfigProps) {
  const [draft, setDraft] = useState(path);
  // A save, or a reset from another tab, rewrites the effective path; the field
  // follows it rather than keeping a value the server is not using.
  useEffect(() => setDraft(path), [path]);

  const dirty = draft.trim() !== path;

  return (
    <section className="rounded-xl border border-ink/10 bg-paper">
      <header className="border-b border-ink/10 px-4 py-3">
        <h4 className="text-sm font-semibold text-ink">Cloudflare config</h4>
      </header>
      <div className="space-y-2 px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink/50">Config file</span>
          <input
            type="text"
            value={draft}
            spellcheck={false}
            placeholder="~/.cloudflared/config.yml"
            onInput={(event) => setDraft(event.currentTarget.value)}
            className={INPUT_CLASS}
          />
        </label>
        <p className="text-[11px] leading-relaxed text-ink/60">
          The tunnel runs a copy of this file with its ingress <code className="font-mono">service:</code> pointed at
          this server's port, so the file's own service line is left alone. Empty uses the default path.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => onSave(draft.trim())}
            className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  );
}
