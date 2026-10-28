/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Line blame as the editor draws it: a label at the end of each run, and the
 * card that opens from it.
 *
 * ## The label is a WIDGET, not a mark
 *
 * A `Decoration.mark` over the line's text is part of the document: the caret
 * can land in it, `⌘C` copies it, and a replace-all would rewrite it. A widget
 * at `line.to` is none of those things — it is drawn, it is not the file.
 *
 * ## Decorations are built for the VIEWPORT only
 *
 * One widget per run on a 20 000-line file is 2 249 DOM nodes on top of the
 * document, and CM6 would lay all of them out on every scroll. The plugin
 * builds the ranges the viewport can show (plus a screen of context), which is
 * the same bound the Shiki tokenizer uses for the same reason.
 *
 * ## The answer is a STATE FIELD, fed by a bridge plugin
 *
 * The controller the panel owns is the source of truth, but a plugin that read
 * it directly could not repaint: replacing a plugin's `decorations` outside a
 * transaction leaves the DOM showing the previous set until something else
 * dispatches. Measured in the component test — a fresh payload produced no
 * labels at all until an unrelated transaction ran. So a small bridge
 * subscribes to the controller and dispatches the payload as an effect, and the
 * labels are a pure function of state.
 *
 * The field also carries what the controller cannot: "the document moved since
 * this answer arrived". An edit shifts every line number, so the labels stop
 * being drawn until a new payload lands — and a cache HIT hands back the same
 * object, which cannot describe the edit either, so the flag is cleared by a
 * new IDENTITY rather than by any notification.
 *
 * The hover target and the card live in `blame-hover.ts`: they are DOM
 * interaction, and this module is the drawing.
 */

import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';

import { formatBlameAge, isUncommittedSha, type BlamePayload } from '@/shared/lib/fs/git-blame';
import type { FileBlame } from '@/client/hooks/editor/blame';
import { blameInteraction } from '@/client/components/common/code-surface/blame-hover';

/** Lines of context above and below the viewport the labels are built for. */
const CONTEXT_LINES = 40;

/** What the labels are drawn from: the answer, and whether it still fits. */
export interface BlameViewState {
  payload: BlamePayload | null;
  /** The document changed since this payload was read. */
  stale: boolean;
}

/** Install a payload the controller just produced. */
export const setBlame = StateEffect.define<BlameViewState>();

/**
 * The field, seeded from the controller.
 *
 * A factory rather than a module constant because `create` reads the answer the
 * controller already holds: a document opened with a cached blame must draw its
 * labels on the first paint, and a plugin cannot dispatch during the view's own
 * construction (CM6 throws "Calls to EditorView.update are not allowed while an
 * update is in progress").
 */
function blameField(controller: FileBlame): StateField<BlameViewState> {
  return StateField.define<BlameViewState>({
    create: () => ({ payload: controller.snapshot().payload, stale: false }),
    update(value, tr) {
      let next = value;
      for (const effect of tr.effects) {
        if (!effect.is(setBlame)) continue;
        // A DIFFERENT payload is a fresh answer about the document as it is now;
        // the same one is a cache hit and describes the bytes before the edit.
        next =
          effect.value.payload !== value.payload
            ? { payload: effect.value.payload, stale: false }
            : { payload: value.payload, stale: value.stale };
      }
      if (tr.docChanged && !next.stale) next = { payload: next.payload, stale: true };
      return next;
    },
  });
}

/** `Ada Lovelace · 4d ago`, or just the name where the panel is narrow. */
function labelText(payload: BlamePayload, sha: string, compact: boolean): string | null {
  const commit = payload.commits[sha];
  if (!commit || isUncommittedSha(sha)) return null;
  const author = commit.author.trim() || 'Unknown';
  return compact ? author : `${author} · ${formatBlameAge(commit.time)}`;
}

class BlameLabel extends WidgetType {
  constructor(
    readonly line: number,
    readonly text: string,
    readonly title: string,
  ) {
    super();
  }

  override eq(other: BlameLabel): boolean {
    return other.line === this.line && other.text === this.text && other.title === this.title;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-blame-label';
    // The interaction plugin reads these two off the DOM event's target, which
    // is how a hover reaches the controller without a listener per label.
    span.dataset.blameLine = String(this.line);
    span.title = this.title;
    span.textContent = this.text;
    return span;
  }
}

/** The runs the viewport can show, one label on each run's first visible line. */
function buildDecorations(state: BlameViewState, view: EditorView, compact: boolean): DecorationSet {
  const { payload, stale } = state;
  if (!payload?.available || stale) return Decoration.none;

  const last = Math.min(payload.lines, view.state.doc.lines);
  if (last < 1) return Decoration.none;
  const top = view.state.doc.lineAt(Math.max(0, Math.min(view.viewport.from, view.state.doc.length))).number;
  const bottom = view.state.doc.lineAt(Math.max(0, Math.min(view.viewport.to, view.state.doc.length))).number;
  const startLine = Math.max(1, top - CONTEXT_LINES);
  const endLine = Math.min(last, bottom + CONTEXT_LINES);

  const ranges: { from: number; deco: Decoration }[] = [];
  for (const run of payload.runs) {
    // Only a run's first VISIBLE line wears the label: a 200-line block would
    // otherwise repeat one author down the whole screen.
    const line = Math.max(run.from, startLine);
    if (line > run.to || line > endLine) continue;
    const text = labelText(payload, run.sha, compact);
    if (!text) continue;
    const commit = payload.commits[run.sha];
    const docLine = view.state.doc.line(line);
    ranges.push({
      from: docLine.to,
      deco: Decoration.widget({
        widget: new BlameLabel(docLine.number, text, commit.summary || commit.sha),
        side: 1,
      }),
    });
  }
  // The builder requires ascending positions, and the runs are already sorted.
  return Decoration.set(
    ranges.map((entry) => entry.deco.range(entry.from)),
    true,
  );
}

/** Labels for the viewport, rebuilt when the payload or the visible lines move. */
function blameLabels(field: StateField<BlameViewState>, compact: boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        this.decorations = buildDecorations(view.state.field(field), view, compact);
      }

      update(update: ViewUpdate) {
        const moved = update.startState.field(field) !== update.state.field(field);
        if (!moved && !update.docChanged && !update.viewportChanged) return;
        this.decorations = buildDecorations(update.state.field(field), update.view, compact);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * The bridge: the controller's answer, dispatched into the field.
 *
 * A plugin rather than an effect in the component, because the answer arrives
 * on the controller's own schedule (a fetch) and the component holds no view to
 * dispatch to. It never publishes during the view's construction — that throws
 * — because the field's own `create` already read the current answer.
 */
function blameBridge(controller: FileBlame): Extension {
  return ViewPlugin.define((view) => {
    let alive = true;
    const publish = () => {
      if (!alive) return;
      const snapshot = controller.snapshot();
      view.dispatch({ effects: setBlame.of({ payload: snapshot.payload, stale: false }) });
    };
    const unsubscribe = controller.subscribe(publish);
    return {
      destroy() {
        alive = false;
        unsubscribe();
      },
    };
  });
}

export interface BlameExtensionOptions {
  controller: FileBlame;
  /** Draw the label at all. Off keeps the card, which is the feature. */
  inline?: boolean;
  /** The author alone, for a narrow panel or a phone. */
  compact?: boolean;
}

/**
 * The whole feature as one extension: the field, the labels, the bridge and the
 * card's interaction.
 *
 * `inline: false` keeps everything except the label, so the card stays reachable
 * from the label when it is on — and the gutter's line number is the other
 * hover target the interaction serves.
 */
export function blameExtensions({ controller, inline = true, compact = false }: BlameExtensionOptions): Extension[] {
  const field = blameField(controller);
  return [field, blameBridge(controller), inline ? blameLabels(field, compact) : [], blameInteraction(controller)];
}
