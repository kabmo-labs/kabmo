/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The nested-repo picker, shared by the host's own panels and by plugins.
 *
 * It is in the KIT rather than in the host because both ends must draw the same
 * control: a plugin panel's header and the Files panel's toolbar describe the
 * same working tree, and a second implementation would drift on the things that
 * matter — the label for the root itself, the checkmark, what refresh does.
 *
 * The kit has no icon dependency (its only dependencies are `preact` and the
 * SDK), so every glyph here is an inline `<svg>` with `currentColor` paint. That
 * is also why it carries its own outside-click handling: the host's
 * `useOnClickOutside` is not reachable from a published package.
 *
 * The rows are the discovered repos of the CURRENT root, and `'.'` is always
 * among them — the root is a legitimate choice even when it is not itself a
 * repository, because a folder of nested repos is a normal workspace.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RepoScopeHandle } from './repo';

export interface RepoPickerProps {
  /** The scope to draw and write. Pass `useRepoScope()`'s handle. */
  scope: RepoScopeHandle;
  /** Extra classes for the trigger, for a host that sizes its own toolbar. */
  className?: string;
  /** Hide the picker entirely (no workspace root to describe). */
  disabled?: boolean;
  /**
   * A row under the list that opens a larger surface (the host's repo manager).
   *
   * Optional because it is HOST chrome: Kabmo opens a modal with grouping
   * and per-repo state, which a plugin has no equivalent of. Absent, no row is
   * drawn — the picker never promises an interaction it does not have, the same
   * rule the navbar's header slots follow.
   */
  onManage?: () => void;
  /** The manage row's label. Only read when `onManage` is given. */
  manageLabel?: string;
}

/** One inline glyph. `currentColor` so it follows the theme with no CSS. */
function Glyph({ path, size = 12, spin = false }: { path: string; size?: number; spin?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={spin ? 'animate-spin' : undefined}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICON = {
  folder: 'M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1z',
  chevron: 'M6 9l6 6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2M3 4v5h5M21 20v-5h-5',
  check: 'M20 6L9 17l-5-5',
  manage: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
} as const;

export function RepoPicker({ scope, className, disabled = false, onManage, manageLabel = 'Manage repositories…' }: RepoPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Outside click closes. A published package cannot import the host's hook, and
  // a pointerdown listener is what a browser actually delivers for a click
  // outside a menu (a click listener misses a drag that ends elsewhere).
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // `'.'` always leads, so the root is the first row whatever order discovery
  // returned. The rest keep discovery's order.
  const options = useMemo(() => {
    const rest = scope.rows.filter((row) => row.repo !== '.');
    const root = scope.rows.find((row) => row.repo === '.');
    return root ? [root, ...rest] : rest;
  }, [scope.rows]);

  const selected = options.find((row) => row.repo === scope.repo) ?? options[0];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    // The LABEL is what is searched, not the path: a user types what they can
    // read, and for the root row the two differ ("Workspace" vs ".").
    return options.filter((row) => row.label.toLowerCase().includes(needle));
  }, [options, query]);

  // No root: there is no tree to describe, so the control says so rather than
  // offering a list that cannot be applied.
  if (disabled || !scope.root) {
    return (
      <span class={`inline-flex items-center gap-1.5 px-2 py-1 text-xs text-ink/40 ${className ?? ''}`} title="No workspace folder">
        <Glyph path={ICON.folder} />
        no workspace
      </span>
    );
  }

  return (
    <div class={`relative ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        title="Switch git project"
        aria-haspopup="listbox"
        aria-expanded={open}
        class="flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-xs text-ink/80 font-medium hover:bg-ink/5"
      >
        <Glyph path={ICON.folder} />
        <span class="truncate max-w-[130px]">{selected?.short ?? 'workspace root'}</span>
        <Glyph path={ICON.chevron} />
      </button>

      {open && (
        <div
          role="listbox"
          class="absolute top-full left-0 mt-1 w-56 bg-paper border border-ink/20 rounded-md shadow-lg z-50 flex flex-col overflow-hidden text-xs"
        >
          <div class="px-2 py-1.5 border-b border-ink/10 flex items-center gap-1.5">
            <Glyph path={ICON.search} size={11} />
            <input
              type="text"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search repos..."
              title="Search repositories"
              class="w-full bg-transparent outline-none text-xs text-ink placeholder-ink/40"
              autoFocus
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} title="Clear search" class="text-ink/40 hover:text-ink">
                ×
              </button>
            )}
            <button
              type="button"
              onClick={() => scope.refresh()}
              title="Refresh nested repos"
              disabled={scope.scanning}
              class="text-ink/40 hover:text-ink transition-colors disabled:opacity-40"
            >
              <Glyph path={ICON.refresh} size={11} spin={scope.scanning} />
            </button>
          </div>
          <div class="max-h-48 overflow-y-auto scrollbar-overlay-container py-1">
            {filtered.length === 0 ? (
              <div class="px-3 py-2 text-ink/40 italic">No repos found</div>
            ) : (
              filtered.map((row) => (
                <button
                  key={row.repo}
                  type="button"
                  role="option"
                  aria-selected={scope.repo === row.repo}
                  onClick={() => {
                    scope.setRepo(row.repo);
                    setOpen(false);
                    setQuery('');
                  }}
                  title={row.label}
                  class="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center justify-between transition-colors"
                >
                  <span class="truncate">{row.label}</span>
                  {scope.repo === row.repo && <Glyph path={ICON.check} />}
                </button>
              ))
            )}
          </div>
          {onManage && (
            <div class="border-t border-ink/10">
              <button
                type="button"
                onClick={() => {
                  onManage();
                  setOpen(false);
                  setQuery('');
                }}
                class="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center gap-2 transition-colors text-ink/80"
              >
                <Glyph path={ICON.manage} size={12} />
                <span>{manageLabel}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
