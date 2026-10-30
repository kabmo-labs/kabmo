/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `…` a folded range collapses into.
 *
 * CodeMirror's default placeholder is a bare span whose only handler is
 * `onclick`. That is enough on Chromium and not on WebKit: a `mousedown`
 * inside the content DOM starts CodeMirror's own mouse selection, which
 * re-creates the widget's DOM before `mouseup`, so the click lands on a node
 * that is no longer in the document and the fold never opens — measured on
 * WebKit 27 with `@codemirror/language` 6: the placeholder was removed and
 * re-added inside the same mousedown, and no `click` event followed.
 *
 * Cancelling the press fixes it at the source: the editor never starts a
 * selection over the widget, the node survives, and the browser dispatches the
 * click the package already listens for. `preventDefault` alone is not enough
 * to stop the DOM churn in every case, so propagation is stopped too — the
 * widget owns its own pointer events and has nothing to hand upward.
 */
import type { EditorView } from '@codemirror/view';

export type FoldPlaceholderClick = (event: MouseEvent) => void;

/** The fold widget's DOM, wired so its click survives a press. */
export function foldPlaceholderDom(
  view: EditorView,
  onclick: FoldPlaceholderClick,
): HTMLElement {
  const element = document.createElement('span');
  element.className = 'cm-foldPlaceholder';
  element.textContent = '…';
  element.setAttribute('aria-label', view.state.phrase('folded code'));
  element.title = view.state.phrase('unfold');
  element.onclick = onclick;
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return element;
}
