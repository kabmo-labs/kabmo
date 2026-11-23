/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kanban panel: the board, its lens chips, and the two sheets.
 *
 * ## What this view is
 *
 * A control surface. A card is a task — a prompt, an agent, a stage — and the
 * board's job is to move it. There is no description, no comments and no
 * labels, because a board that accumulates knowledge stops being read.
 *
 * ## Two writers, one board
 *
 * An agent can move its own cards through the plugin's MCP tools. That write
 * happens in a DIFFERENT process, so the panel cannot learn about it from its own
 * state: it follows the plugin topic, which the server half publishes whenever
 * `cards/` changes. That is why a card can move while this view is open and
 * nothing here polls.
 *
 * ## The lens
 *
 * One board, two lenses: this workspace (the default when one is open) and
 * everything. A card carries the workspace it belongs to, so switching a lens
 * filters rather than moving anything, and a card whose folder is gone is still
 * on the board.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import { experimental_useSidebarThreads, usePanelInfo } from '@kabmo-labs/kabmo-ui';

import type { Card, CardSummary, ResolvedAgent, Stage } from '../protocol';
import { useBoard, type Lens } from './use-board';
import { useWrites } from './use-writes';
import { useCatalogs } from './catalogs';
import { StageColumn } from './StageColumn';
import { CardSheet } from './CardSheet';
import { StageSheet } from './StageSheet';
import { useCardDetail } from './use-card-detail';

/** The chips' labels, in order. */
function lensLabel(lens: Lens, counts: Record<Lens, number>): string {
  if (lens === 'all') return `All ${counts.all}`;
  if (lens === 'workspace') return `This workspace ${counts.workspace}`;
  return `Unfiled ${counts.unfiled}`;
}

/** Which stages to draw: hidden ones only while they hold cards. */
export function visibleStages(stages: readonly Stage[], cards: readonly CardSummary[]): Stage[] {
  return stages.filter(
    (stage) => !stage.hidden || cards.some((card) => card.status === stage.id),
  );
}

/** Cards whose stage matches no stage id, shown rather than dropped. */
export function unplacedCards(stages: readonly Stage[], cards: readonly CardSummary[]): CardSummary[] {
  const known = new Set(stages.map((stage) => stage.id));
  return cards.filter((card) => !known.has(card.status));
}

/** The board panel. */
export function KanbanPanel() {
  const board = useBoard();
  const { workspacePath, sessionId } = usePanelInfo();
  const writes = useWrites(board.reload);
  const catalogs = useCatalogs(true);
  const threads = experimental_useSidebarThreads();
  const detail = useCardDetail();
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sessionStateOf = useCallback(
    (card: CardSummary): 'running' | 'needs-you' | 'idle' | 'none' => {
      if (!card.sessionId) return 'none';
      const thread = threads.threads.find((entry) => entry.id === card.sessionId);
      if (!thread) return 'idle';
      if (thread.awaitingInput) return 'needs-you';
      return thread.isRunning ? 'running' : 'idle';
    },
    [threads.threads],
  );

  // `exists` is checked ONCE here: everything below draws a real board.
  const live = board.snapshot?.exists ? board.snapshot : null;
  const stages = useMemo(
    () => (live ? visibleStages(live.board.stages, board.cards) : []),
    [live, board.cards],
  );
  const unplaced = useMemo(
    () => (live ? unplacedCards(live.board.stages, board.cards) : []),
    [live, board.cards],
  );

  const drop = useCallback(
    async (stageId: string) => {
      const id = draggingId;
      setDraggingId(null);
      setDropTarget(null);
      if (!id) return;
      const card = board.cards.find((entry) => entry.id === id);
      if (!card || card.status === stageId) return;
      const outcome = await writes.moveCard(id, stageId);
      if (!outcome.ok) setNotice(outcome.error);
      else if (outcome.value.next === 'start_work_required') {
        setNotice('Moved. This stage runs a chat — press Start work on the card.');
      }
    },
    [board.cards, draggingId, writes],
  );

  const startWork = useCallback(
    async (card: Card, resolved: ResolvedAgent) => {
      const outcome = await writes.startWork(card, resolved);
      if (!outcome.ok) return { ok: false as const, error: outcome.error };
      setOpenCardId(null);
      return { ok: true as const, value: outcome };
    },
    [writes],
  );

  // The board is the plugin's only surface, so every state it can be in is here.
  if (board.isLoading) {
    return <p class="p-3 text-xs text-ink/45">Reading the board…</p>;
  }

  if (board.error) {
    return (
      <div class="flex flex-col gap-2 p-3">
        <p class="text-xs text-ink">Could not read the board.</p>
        <p class="text-[11px] text-[var(--theme-error)]">{board.error}</p>
        <button type="button" class="self-start rounded-md border border-ink/20 px-2 py-1 text-[11px]" onClick={board.reload}>
          Retry
        </button>
      </div>
    );
  }

  if (!live) {
    return (
      <div class="flex flex-col gap-2 p-3">
        <p class="text-xs text-ink">No board yet.</p>
        <p class="text-[11px] text-ink/50">It will be created in this Kabmo's data directory.</p>
        <button
          type="button"
          class="self-start rounded-md border border-ink/20 bg-ink/5 px-2 py-1 text-[11px]"
          onClick={() => void board.createBoard()}
        >
          Create board
        </button>
      </div>
    );
  }

  const openCard = openCardId ? detail.card : null;
  const showWorkspace = board.lens === 'all';

  return (
    <div class="flex h-full min-h-0 w-full bg-paper text-ink">
      <div class="flex flex-col flex-1 min-w-0 min-h-0">
        <header class="flex items-center gap-2 px-2.5 h-10 flex-none border-b border-ink/10">
          <span class="text-xs font-semibold">Kanban</span>
          <span class="text-[10px] text-ink/40">{live.cards.length}</span>
          <div class="flex items-center gap-1 ml-2">
            {(['all', 'workspace', 'unfiled'] as const).map((lens) => (
              <button
                key={lens}
                type="button"
                class={[
                  'rounded-full border px-2 py-0.5 text-[10px]',
                  board.lens === lens ? 'border-ink/30 bg-ink/5 text-ink' : 'border-ink/10 text-ink/55',
                ].join(' ')}
                aria-pressed={board.lens === lens}
                onClick={() => board.setLens(lens)}
              >
                {lensLabel(lens, board.counts)}
              </button>
            ))}
          </div>
          <button
            type="button"
            class="ml-auto rounded-md border border-ink/15 px-2 py-0.5 text-[10px] text-ink/70"
            onClick={() => setStagesOpen(true)}
          >
            Stages…
          </button>
          <button
            type="button"
            class="rounded-md border border-ink/15 px-2 py-0.5 text-[10px] text-ink/70"
            onClick={board.reload}
          >
            Refresh
          </button>
        </header>

        {live.errors.length > 0 ? (
          <ul class="px-2.5 py-1.5 border-b border-ink/10 flex flex-col gap-0.5">
            {live.errors.map((entry) => (
              <li key={entry.path} class="text-[10px] text-[var(--theme-error)] font-mono">
                {entry.path} — {entry.message}
              </li>
            ))}
          </ul>
        ) : null}

        {notice ? (
          <p class="px-2.5 py-1.5 border-b border-ink/10 text-[11px] text-ink/60" role="status">
            {notice}
          </p>
        ) : null}

        <div class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-2">
          <div class="flex gap-2 h-full min-h-0">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                cards={board.cards.filter((card) => card.status === stage.id)}
                showWorkspace={showWorkspace}
                sessionStateOf={sessionStateOf}
                draggingId={draggingId}
                dropTarget={dropTarget}
                onOpenCard={(id) => {
                  setOpenCardId(id);
                  void detail.load(id);
                }}
                onAddCard={(stageId) => {
                  void writes
                    .createCard({ title: 'New card', status: stageId, workspace: workspacePath })
                    .then((outcome) => {
                      if (outcome.ok) setNotice('Card created. Open it to write the task.');
                      else setNotice(outcome.error);
                    });
                }}
                onDragStart={setDraggingId}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTarget(null);
                }}
                onDropOn={(stageId) => void drop(stageId)}
                onDragOver={setDropTarget}
              />
            ))}
            {unplaced.length > 0 ? (
              <StageColumn
                stage={{ id: 'unplaced', label: 'Unplaced', hidden: false, session: false }}
                cards={unplaced}
                showWorkspace={showWorkspace}
                sessionStateOf={sessionStateOf}
                draggingId={draggingId}
                dropTarget={dropTarget}
                onOpenCard={(id) => {
                  setOpenCardId(id);
                  void detail.load(id);
                }}
                onAddCard={() => undefined}
                onDragStart={setDraggingId}
                onDragEnd={() => setDraggingId(null)}
                onDropOn={(stageId) => void drop(stageId)}
                onDragOver={setDropTarget}
              />
            ) : null}
          </div>
        </div>
      </div>

      {openCard ? (
        <CardSheet
          card={openCard}
          stages={live.board.stages}
          board={{ defaults: live.board.defaults as Record<string, unknown>, stages: live.board.stages }}
          catalogs={catalogs}
          activeSessionId={sessionId}
          sessionState={sessionStateOf({
            ...openCard,
            hasPrompt: openCard.task.prompt.length > 0,
            imageCount: openCard.task.images.length,
          })}
          onClose={() => setOpenCardId(null)}
          onSave={async (patch, base) => {
            const outcome = await writes.updateCard(openCard.id, patch, base);
            if (outcome.ok) void detail.load(openCard.id);
            return outcome;
          }}
          onMove={async (status, base) => {
            const outcome = await writes.moveCard(openCard.id, status, base);
            if (outcome.ok) void detail.load(openCard.id);
            return outcome;
          }}
          onDelete={async () => {
            const outcome = await writes.deleteCard(openCard.id);
            if (outcome.ok) setOpenCardId(null);
            return outcome;
          }}
          onStartWork={startWork}
          onLinkSession={async (linkId) => {
            const outcome = await writes.linkSession(openCard.id, linkId);
            if (outcome.ok) void detail.load(openCard.id);
            return outcome;
          }}
        />
      ) : null}

      {stagesOpen ? (
        <StageSheet
          board={live.board}
          catalogs={catalogs}
          onClose={() => setStagesOpen(false)}
          onSave={async (next) => {
            const outcome = await writes.saveStages(next);
            if (outcome.ok) board.reload();
            return outcome;
          }}
          onSaveDefaults={async (next) => {
            const outcome = await writes.saveDefaults(next);
            if (outcome.ok) board.reload();
            return outcome;
          }}
        />
      ) : null}
    </div>
  );
}
