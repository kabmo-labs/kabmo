/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New Workspace modal's git-clone field.
 *
 * The Clone button is disabled until the URL is one `git clone` accepts, using
 * the SAME predicate the server refuses on (`@/shared/lib/git/url`) — a
 * per-caller copy is what lets the button enable on a string the route then
 * rejects.
 *
 * A clone is long (a real repository is tens of seconds), so the button carries
 * its own progress word and the field is read-only while it runs: a second
 * click would start a second clone into a destination that now exists.
 */

import { useState } from 'preact/hooks';
import { Loader2, GitFork } from 'lucide-preact';
import { isGitUrl, repoSlug } from '@/shared/lib/git/url';

interface CloneFieldProps {
  /** The directory the clone lands in — the modal's current browse path. */
  parent: string;
  /** True while a clone is in flight. */
  busy: boolean;
  onClone: (url: string) => void;
}

export function CloneField({ parent, busy, onClone }: CloneFieldProps) {
  const [url, setUrl] = useState('');
  const trimmed = url.trim();
  const valid = isGitUrl(trimmed);
  const slug = valid ? repoSlug(trimmed) : '';

  const submit = () => {
    if (valid && !busy) onClone(trimmed);
  };

  return (
    <div>
      <label className="block text-xs font-semibold mb-1 text-ink">
        Clone Git Repository{' '}
        <span className="text-ink/40 font-normal">(optional — clones into the path above)</span>
      </label>
      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          placeholder="https://github.com/org/repo.git"
          spellcheck={false}
          aria-label="Git repository URL"
          className="flex-1 bg-paper border border-ink/20 rounded px-3 py-2 outline-none focus:border-ink/50 text-sm font-mono disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!valid || busy}
          title={valid ? `Clone into ${parent}/${slug}` : 'Enter an https, ssh, git@ or local path'}
          aria-label="Clone repository"
          className="px-3 py-2 bg-ink/5 border border-ink/10 rounded text-xs font-medium hover:bg-ink/10 disabled:opacity-40 transition-colors flex items-center space-x-1.5 flex-shrink-0"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <GitFork size={13} />}
          <span>{busy ? 'Cloning…' : 'Clone'}</span>
        </button>
      </div>
      {valid && slug && !busy && (
        <p className="mt-1 text-[10px] text-ink/40 font-mono truncate">
          Creates workspace “{slug.toLowerCase()}” at {parent}/{slug}
        </p>
      )}
    </div>
  );
}
