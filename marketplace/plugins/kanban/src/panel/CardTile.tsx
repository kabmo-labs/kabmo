/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One card, drawn as the control record it is.
 *
 * There is no description line because there is no description: decision 2 keeps
 * the board a control surface, so a card shows what decides work — priority, the
 * workspace it belongs to, whether it has a prompt, and the session working it.
 * The prompt itself is one truncated line, because a card is an index and the
 * sheet is the detail.
 */

import type { CardSummary } from '../protocol';

/** Priority as the tag a reader scans for: P0 is the loudest. */
export function priorityLabel(priority: number): string {
  return `P${Math.min(4, Math.max(0, priority))}`;
}

/** The one-line preview a card shows instead of the prompt. */
export function promptPreview(card: CardSummary): string {
  if (!card.hasPrompt) return 'no prompt';
  return card.imageCount > 0 ? `prompt · ${card.imageCount} image${card.imageCount === 1 ? '' : 's'}` : 'prompt';
}

/** The workspace's last path segment: `/Users/x/projects/kabmo` → `kabmo`. */
export function workspaceLabel(workspace: string | null): string {
  if (!workspace) return 'unfiled';
  const parts = workspace.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

export interface CardTileProps {
  card: CardSummary;
  /** True when the board is showing every workspace, so the badge earns its space. */
  showWorkspace: boolean;
  /** The session's live state, from the host's own sidebar list. */
  sessionState: 'running' | 'needs-you' | 'idle' | 'none';
  onOpen: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  /** True while this card is the one being dragged. */
  dragging: boolean;
}

/** One card. Pointer drag is the caller's job; this only reports intent. */
export function CardTile({
  card,
  showWorkspace,
  sessionState,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: CardTileProps) {
  const session = sessionState === 'none' ? null : sessionState;
  return (
    <button
      type="button"
      draggable
      onDragStart={() => onDragStart(card.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(card.id)}
      class={[
        'w-full text-left rounded-lg border px-2.5 py-2 flex flex-col gap-1',
        'bg-paper border-ink/10 hover:border-ink/25 transition-colors',
        dragging ? 'opacity-40' : '',
      ].join(' ')}
      aria-label={`${card.title} — ${priorityLabel(card.priority)}`}
    >
      <span class="flex items-center gap-2 min-w-0">
        <span class="text-[10px] font-mono text-ink/40 flex-none">{card.id}</span>
        <span class="text-[10px] font-mono text-ink/60 flex-none">{priorityLabel(card.priority)}</span>
        {session ? (
          <span class="ml-auto flex items-center gap-1 text-[10px] text-ink/60 flex-none">
            <span
              class={[
                'inline-block w-1.5 h-1.5 rounded-full',
                session === 'running' ? 'bg-[var(--theme-success)]' : session === 'needs-you' ? 'bg-[var(--theme-warning)]' : 'bg-ink/30',
              ].join(' ')}
              aria-hidden="true"
            />
            {session === 'needs-you' ? 'needs you' : session}
          </span>
        ) : null}
      </span>
      <span class="text-xs text-ink leading-snug line-clamp-2">{card.title}</span>
      <span class="flex items-center gap-2 text-[10px] text-ink/45 min-w-0">
        {showWorkspace ? <span class="truncate">{workspaceLabel(card.workspace)}</span> : null}
        <span class="truncate">{promptPreview(card)}</span>
      </span>
    </button>
  );
}
