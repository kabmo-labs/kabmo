/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The blame card: the commit that last touched a line, and — on request — every
 * commit that touched it.
 *
 * Built from DOM rather than from Preact because it lives inside the editor's
 * own subtree, which is not the Preact tree: a portal would need the component
 * to re-render on every hover, and the editor is the one place the app already
 * keeps its DOM imperative (see `theme.ts`, `marks.ts`).
 *
 * ## Six states, and only ONE of them is an error
 *
 * A dirty buffer, a line past the end of HEAD, an untracked file and a folder
 * that is not a repository are all ANSWERS — the reader asked who wrote this
 * and the honest reply is "nobody yet". Painting them red would make an
 * ordinary state look like a failure and would teach the reader to distrust the
 * one case that IS one.
 *
 * ## The card stays open while the pointer is over it
 *
 * That is what makes its text selectable, which is the only way to copy a sha
 * out of it. Closing is the owner's job (see `blame.ts`): Escape, an outside
 * press, a document change, and a pointer that left both the editor and the
 * card.
 */

import { blameUnavailableText, formatBlameAge, isUncommittedSha } from '@/shared/lib/fs/git-blame';
import type { BlamePayload } from '@/shared/lib/fs/git-blame';
import type { BlameHistoryResult, BlameStatus, FileBlame } from '@/client/hooks/editor/blame';

export interface BlamePanelState {
  line: number;
  status: BlameStatus;
  payload: BlamePayload | null;
  message: string | null;
  stale: boolean;
  history: BlameHistoryResult | null;
  historyOpen: boolean;
  historyLoading: boolean;
}

const PANEL_CLASS =
  'fixed z-50 w-[min(340px,92vw)] rounded-xl border border-ink/20 bg-paper p-3 shadow-xl font-sans text-xs text-ink';

const HEAD_CLASS = 'flex items-baseline justify-between gap-2';
const AUTHOR_CLASS = 'truncate text-xs font-semibold text-ink';
const AGE_CLASS = 'shrink-0 font-mono text-[10px] text-ink/40';
const SUBJECT_CLASS = 'mt-1 line-clamp-2 text-[11px] leading-snug text-ink/80';
const RULE_CLASS = 'mt-2 border-t border-ink/10 pt-2';
const META_CLASS = 'flex items-center gap-2 font-mono text-[9px] text-ink/40';
const NOTE_CLASS = 'mt-1 text-[10px] leading-snug text-ink/50';
const HISTORY_BUTTON_CLASS =
  'mt-2 flex w-full items-center gap-1.5 text-left text-[10px] text-ink/50 hover:text-ink cursor-pointer';
const HISTORY_LIST_CLASS = 'mt-1.5 space-y-1 border-t border-ink/10 pt-1.5';
const HISTORY_ROW_CLASS = 'flex items-center gap-1.5 font-mono text-[10px]';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `14 Nov 2023`, from the commit's own clock. */
function commitDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * What the card says for a state, as a title and a body.
 *
 * Exported because the sentence is the whole product here: a test that only
 * checked the DOM's shape would pass on a card that said the wrong thing about
 * an unsaved line.
 */
export function blamePanelNote(state: BlamePanelState): { title: string; body: string } | null {
  const payload = state.payload;
  if (state.status === 'error') {
    return { title: 'Blame failed', body: state.message ?? 'git could not read this file.' };
  }
  if (state.status === 'unavailable') {
    return {
      title: payload?.reason === 'untracked' ? 'Not tracked' : 'No history',
      body: blameUnavailableText(payload?.reason ?? 'error', state.message ?? undefined),
    };
  }
  if (!payload) return null;
  if (state.stale) {
    return {
      title: 'Not committed yet',
      body: 'This line changed in the editor. Save the file to see its blame.',
    };
  }
  if (state.line > payload.lines) {
    return {
      title: 'Not committed yet',
      body: `Line ${state.line} is past the end of the file at HEAD (${payload.lines} lines).`,
    };
  }
  const commit = payload.runs.length > 0 ? commitAt(payload, state.line) : null;
  if (!commit) {
    return { title: 'Not committed yet', body: `git has no attribution for line ${state.line}.` };
  }
  if (isUncommittedSha(commit.sha)) {
    return { title: 'Not committed yet', body: 'This line differs from the last commit.' };
  }
  return null;
}

function commitAt(payload: BlamePayload, line: number) {
  for (const run of payload.runs) {
    if (line >= run.from && line <= run.to) return payload.commits[run.sha] ?? null;
  }
  return null;
}

/** The card's own markup, rebuilt whole on every change. */
function renderInto(root: HTMLElement, state: BlamePanelState): void {
  root.replaceChildren();
  root.className = PANEL_CLASS;

  const note = blamePanelNote(state);
  if (note) {
    const head = el('div', HEAD_CLASS);
    head.append(el('span', AUTHOR_CLASS, note.title));
    if (state.status === 'error' && state.message) {
      const retry = el('button', 'shrink-0 cursor-pointer text-[10px] text-ink/50 hover:text-ink', 'Try again');
      retry.type = 'button';
      retry.setAttribute('aria-label', 'Read the blame again');
      head.append(retry);
    }
    root.append(head, el('p', NOTE_CLASS, note.body));
    return;
  }

  const payload = state.payload;
  if (!payload) {
    // The read has not landed yet. A card with nothing in it reads as broken, so
    // it says what it is waiting for.
    root.append(el('p', NOTE_CLASS, 'Reading blame…'));
    return;
  }
  const commit = commitAt(payload, state.line)!;

  const head = el('div', HEAD_CLASS);
  head.append(el('span', AUTHOR_CLASS, commit.author.trim() || 'Unknown'), el('span', AGE_CLASS, formatBlameAge(commit.time)));
  root.append(head);

  if (commit.summary) root.append(el('p', SUBJECT_CLASS, commit.summary));

  const meta = el('div', `${META_CLASS} ${RULE_CLASS}`);
  meta.append(el('code', 'truncate', commit.sha.slice(0, 7)), el('span', '', commitDate(commit.time)));
  if (commit.mail) {
    const mail = el('span', 'truncate', commit.mail);
    mail.title = commit.mail;
    meta.append(mail);
  }
  root.append(meta);

  const toggle = el('button', HISTORY_BUTTON_CLASS);
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', state.historyOpen ? 'true' : 'false');
  toggle.textContent = `${state.historyOpen ? '▾' : '▸'} Line history`;
  root.append(toggle);

  if (!state.historyOpen) return;

  const list = el('ol', HISTORY_LIST_CLASS);
  if (state.historyLoading) {
    list.append(el('li', `${HISTORY_ROW_CLASS} text-ink/40`, 'Reading history…'));
  } else if (!state.history || state.history.entries.length === 0) {
    list.append(el('li', `${HISTORY_ROW_CLASS} text-ink/40`, 'No commits touched this line.'));
  } else {
    const entries = state.history.entries;
    entries.forEach((entry, index) => {
      const row = el('li', HISTORY_ROW_CLASS);
      // The LAST entry is where the line was born: `log -L` walks backwards
      // from the newest commit that touched it.
      const kind = index === entries.length - 1 ? 'new' : 'edit';
      row.append(
        el('span', 'text-ink/40', index === 0 ? '●' : '○'),
        el('code', 'text-ink/60', entry.sha.slice(0, 7)),
        el('span', 'truncate text-ink/80', entry.author.trim() || 'Unknown'),
        el('span', 'ml-auto shrink-0 text-ink/40', formatBlameAge(entry.time)),
        el(
          'span',
          'shrink-0 rounded bg-ink/5 px-1 text-[8.5px] uppercase tracking-wider text-ink/45',
          kind,
        ),
      );
      list.append(row);
    });
    if (state.history.truncated) {
      list.append(el('li', `${HISTORY_ROW_CLASS} text-ink/40`, 'Older commits are not shown.'));
    }
  }
  root.append(list);
}

export interface BlamePanel {
  element: HTMLElement;
  /** Re-place the card under `anchor` without rebuilding it. */
  place(anchor: { left: number; top: number; bottom: number }): void;
  destroy(): void;
}

/**
 * Build a card for `line`, live-updating it as the answer arrives.
 *
 * The controller is subscribed rather than read once: a hover that lands before
 * the file's blame has been read shows the skeleton, and the card has to fill
 * itself in — a snapshot taken at open time would leave "Reading blame…" on
 * screen forever.
 */
export function createBlamePanel(line: number, controller: FileBlame, onRetry: () => void): BlamePanel {
  const element = el('div', PANEL_CLASS);
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Line blame');
  // A press inside the card is the reader selecting its text, so the owner must
  // not treat it as an outside click.
  element.addEventListener('mousedown', (event) => event.stopPropagation());

  let history: BlameHistoryResult | null = null;
  let historyOpen = false;
  let historyLoading = false;

  const state = (): BlamePanelState => {
    const snapshot = controller.snapshot();
    return {
      line,
      status: snapshot.status,
      payload: snapshot.payload,
      message: snapshot.message,
      stale: controller.stale(),
      history,
      historyOpen,
      historyLoading,
    };
  };

  const paint = () => {
    renderInto(element, state());
    const retry = element.querySelector<HTMLButtonElement>('[aria-label="Read the blame again"]');
    if (retry) {
      retry.addEventListener('click', (event) => {
        event.stopPropagation();
        onRetry();
      });
    }
    element.querySelector<HTMLButtonElement>('button[aria-expanded]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      historyOpen = !historyOpen;
      paint();
      if (!historyOpen || history || historyLoading) return;
      historyLoading = true;
      paint();
      void controller.history(line).then((result) => {
        history = result;
        historyLoading = false;
        paint();
      });
    });
  };

  paint();
  const unsubscribe = controller.subscribe(paint);

  return {
    element,
    place(anchor) {
      // Measured after the paint, so the card's own height decides whether it
      // flips above the line. The viewport comes from the card's OWN window
      // rather than a bare `window` global: the card is mounted in whatever
      // document the editor belongs to, and a module that assumes the top-level
      // one cannot be mounted in a test window or an iframe.
      const win = element.ownerDocument.defaultView;
      const viewportWidth = win?.innerWidth ?? 1024;
      const viewportHeight = win?.innerHeight ?? 768;
      const width = element.offsetWidth || 340;
      const height = element.offsetHeight || 120;
      const margin = 8;
      const left = Math.max(margin, Math.min(anchor.left, viewportWidth - width - margin));
      const below = anchor.bottom + 6;
      const above = anchor.top - height - 6;
      const top = below + height > viewportHeight - margin && above > margin ? above : below;
      element.style.left = `${left}px`;
      element.style.top = `${Math.max(margin, top)}px`;
    },
    destroy() {
      unsubscribe();
      element.remove();
    },
  };
}
