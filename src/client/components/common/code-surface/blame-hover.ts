/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The blame card's trigger: hover or press a label, and everything that closes
 * it again.
 *
 * Split out of `blame.ts` for the repository's per-file ceiling, and it earns
 * the boundary: this half is DOM interaction with no state of its own beyond
 * "is a card open, and for which line", while `blame.ts` is what the labels are
 * drawn from.
 *
 * ## The card is placed against the VIEWPORT, not the line
 *
 * It is mounted on `document.body` with `position: fixed`, so the editor's own
 * scroller cannot clip it. That also means it does not follow the text while it
 * is open — deliberately: a card that moved under a pointer reading it would be
 * worse than one the reader's own scroll dismisses.
 *
 * ## Two hover targets, because one of them cannot exist everywhere
 *
 * The label only appears on a run's first line, and it is absent for a line
 * that is not committed yet — which is precisely the line a reader asks about
 * when the editor shows something they do not recognise. The GUTTER's line
 * number is therefore the second target: it exists on every rendered line, it
 * is what VS Code's blame is anchored to, and it is the only way to reach the
 * card for an uncommitted line.
 *
 * ## Every close condition lives here
 *
 * Escape, a press outside, a document change, and a pointer that left both the
 * label and the card. A card that outlived the line it describes is worse than
 * no card, and a call site that forgot one of them would be a bug nobody sees
 * until the reader scrolls.
 */

import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import type { FileBlame } from '@/client/hooks/editor/blame';
import { createBlamePanel, type BlamePanel } from '@/client/components/common/code-surface/blame-panel';

/** The anchor a card is placed against, as the three numbers it needs. */
export interface BlameAnchor {
  left: number;
  top: number;
  bottom: number;
}

/**
 * The hover/press behaviour, one instance per view.
 *
 * Every close condition is here rather than at a call site: Escape, a press
 * outside, a document change, and a pointer that left both the label and the
 * card. A card that outlived the line it describes is worse than no card.
 */
export function blameInteraction(controller: FileBlame): Extension {
  return ViewPlugin.define((view) => {
    let panel: BlamePanel | null = null;
    let panelLine = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const close = () => {
      clearTimeout(hideTimer);
      hideTimer = undefined;
      panel?.destroy();
      panel = null;
      panelLine = 0;
    };

    /**
     * Where the card hangs from.
     *
     * A label with no box (a zero-width widget in a pane that is still being
     * measured) anchors to its LINE instead. `coordsAtPos` answers null outside
     * the viewport and can throw when the view has no layout yet, so the
     * scroller's own corner is the answer that cannot fail.
     */
    const anchorFor = (target: HTMLElement, line: number): BlameAnchor => {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0) return { left: rect.left, top: rect.top, bottom: rect.bottom };
      const docLine = view.state.doc.line(Math.min(line, view.state.doc.lines));
      let coords: { left: number; top: number; bottom: number } | null = null;
      try {
        coords = view.coordsAtPos(docLine.from);
      } catch {
        coords = null;
      }
      if (coords) return coords;
      const fallback = view.scrollDOM.getBoundingClientRect();
      return { left: fallback.left, top: fallback.top + 24, bottom: fallback.top + 24 };
    };

    const open = (line: number, anchor: BlameAnchor) => {
      if (panelLine === line && panel) return;
      close();
      panelLine = line;
      panel = createBlamePanel(line, controller, () => {
        controller.reload();
        close();
      });
      document.body.append(panel.element);
      panel.place(anchor);
    };

    /**
     * The line a hover or press is about, from either target.
     *
     * The label carries its line in a dataset attribute. The gutter does not, so
     * its own text is the number — which is what `lineNumbers()` writes, and the
     * only fact a gutter row holds.
     */
    const lineOf = (event: Event): { line: number; anchor: HTMLElement } | null => {
      const element = event.target as HTMLElement | null;
      const label = element?.closest?.('.cm-blame-label') as HTMLElement | null;
      if (label) {
        const line = Number(label.dataset.blameLine);
        return Number.isInteger(line) && line > 0 ? { line, anchor: label } : null;
      }
      const gutter = element?.closest?.('.cm-lineNumbers .cm-gutterElement') as HTMLElement | null;
      if (!gutter) return null;
      const line = Number((gutter.textContent ?? '').trim());
      return Number.isInteger(line) && line > 0 ? { line, anchor: gutter } : null;
    };

    const onOver = (event: MouseEvent) => {
      const hit = lineOf(event);
      if (!hit) return;
      open(hit.line, anchorFor(hit.anchor, hit.line));
    };

    const onPress = (event: MouseEvent) => {
      const hit = lineOf(event);
      if (hit) {
        event.preventDefault();
        open(hit.line, anchorFor(hit.anchor, hit.line));
        return;
      }
      // A press anywhere else closes the card — including on the editor's own
      // text, which is a different question than "who wrote this".
      if (panel && !panel.element.contains(event.target as Node)) close();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel) {
        close();
        // The editor's own Escape collapses selections; this one only dismisses.
        event.stopPropagation();
      }
    };

    const onLeave = (event: MouseEvent) => {
      if (!panel) return;
      const to = event.relatedTarget as Node | null;
      if (to && (panel.element.contains(to) || view.scrollDOM.contains(to))) return;
      // A short grace period: the pointer crosses a few pixels of padding on its
      // way from the label into the card.
      hideTimer = setTimeout(close, 200);
    };

    // `mouseover` and the press are on the SCROLL element rather than the
    // content: the line numbers live in the gutters, which are siblings of the
    // content inside the scroller — a listener on `contentDOM` never sees them.
    view.scrollDOM.addEventListener('mouseover', onOver);
    view.scrollDOM.addEventListener('mouseleave', onLeave);
    view.scrollDOM.addEventListener('mousedown', onPress);
    document.addEventListener('mousedown', onPress);
    document.addEventListener('keydown', onKey, true);

    return {
      update(update: ViewUpdate) {
        // The line numbers the card names have moved, so it describes a document
        // that is no longer on screen.
        if (update.docChanged && panel) close();
      },
      destroy() {
        close();
        view.scrollDOM.removeEventListener('mouseover', onOver);
        view.scrollDOM.removeEventListener('mouseleave', onLeave);
        view.scrollDOM.removeEventListener('mousedown', onPress);
        document.removeEventListener('mousedown', onPress);
        document.removeEventListener('keydown', onKey, true);
      },
    };
  });
}
