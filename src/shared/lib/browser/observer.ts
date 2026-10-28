/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Live interaction observer for the viewed page.
 *
 * The screencast shows the page but not the agent's clicks and keystrokes, so
 * on attach we install a passive capture-phase listener set through CDP
 * (`Runtime.addBinding` + an injected script) that reports real DOM
 * interactions back over the same flattened session. The listener only reads
 * event metadata and posts a small JSON payload — it never changes page state.
 *
 * Navigation and other page-level signals are handled by the viewer's CDP event
 * stream (Page.frameNavigated), not here.
 */

import { CdpConnection } from '@/shared/lib/browser/cdp';
import { readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';
import type { BrowserActionKind } from '@/shared/types';
import type { BrowserActionDraft } from '@/shared/lib/browser/activity';

/** Page-context function the injected script calls; CDP surfaces it as Runtime.bindingCalled. */
export const OBSERVER_BINDING = '__kabmoAction';

const OBSERVER_KINDS = new Set<BrowserActionKind>(['click', 'type', 'press', 'submit']);

/**
 * Passive DOM listeners installed in the top frame. Kept as a plain string
 * because it is injected verbatim through `Page.addScriptToEvaluateOnNewDocument`
 * and `Runtime.evaluate`. Special keys are reported immediately; typing is
 * debounced to one toast per burst.
 */
const OBSERVER_SOURCE = [
  '(function () {',
  '  if (window.top !== window) return;',
  '  if (window.__kabmoObserver) return;',
  '  window.__kabmoObserver = true;',
  `  var BINDING = ${JSON.stringify(OBSERVER_BINDING)};`,
  '  function emit(kind, label) {',
  '    try { if (typeof window[BINDING] === "function") window[BINDING](JSON.stringify({ kind: kind, label: label })); } catch (error) { /* binding unavailable or page CSP blocked it — interaction reporting is best-effort */ }',
  '  }',
  '  function describe(element) {',
  '    if (!element || !element.tagName) return "elemen";',
  '    var tag = String(element.tagName).toLowerCase();',
  '    var raw = element.getAttribute && (element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder"));',
  '    if (!raw) raw = element.innerText || element.value || "";',
  '    var text = String(raw).replace(/\\s+/g, " ").trim().slice(0, 48);',
  '    return text ? tag + " \\"" + text + "\\"" : tag;',
  '  }',
  '  document.addEventListener("click", function (event) { emit("click", "Mengklik " + describe(event.target)); }, true);',
  '  var inputTimer = null;',
  '  var inputElement = null;',
  '  var lastInputLabel = "";',
  '  function emitInput() {',
  '    if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }',
  '    if (!inputElement) return;',
  '    var value = inputElement.value === undefined || inputElement.value === null ? "" : String(inputElement.value);',
  '    var label = value ? "Mengetik \\"" + value.slice(0, 40) + "\\"" : "Menghapus teks";',
  '    if (label === lastInputLabel) return;',
  '    lastInputLabel = label;',
  '    emit("type", label);',
  '  }',
  '  document.addEventListener("input", function (event) {',
  '    if (event.target) inputElement = event.target;',
  '    if (inputTimer) clearTimeout(inputTimer);',
  '    inputTimer = setTimeout(emitInput, 450);',
  '  }, true);',
  '  document.addEventListener("change", function () { emitInput(); }, true);',
  '  var SPECIAL_KEYS = ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];',
  '  document.addEventListener("keydown", function (event) {',
  '    if (SPECIAL_KEYS.indexOf(event.key) === -1) return;',
  '    emitInput();',
  '    emit("press", "Menekan " + event.key);',
  '  }, true);',
  '  document.addEventListener("submit", function () { emit("submit", "Mengirim form"); }, true);',
  '})();',
].join('\n');

export interface ObserverHandle {
  dispose: () => void;
}

/** Validate one `Runtime.bindingCalled` payload from the injected observer. */
export function parseObserverPayload(payload: unknown): BrowserActionDraft | null {
  if (typeof payload !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const kind = readString(parsed, 'kind');
  const label = readString(parsed, 'label');
  if (!kind || !label) return null;
  if (!OBSERVER_KINDS.has(kind as BrowserActionKind)) return null;
  return { kind: kind as BrowserActionKind, label: label.slice(0, 120) };
}

/**
 * Install the observer on an attached page session. Every step is best-effort:
 * a page that refuses evaluation simply yields no interaction toasts while the
 * screencast keeps working.
 */
export async function installObserver(conn: CdpConnection, sessionId: string): Promise<ObserverHandle> {
  await Promise.all([
    conn.send('Runtime.enable', {}, sessionId).catch(() => {}),
    conn.send('Runtime.addBinding', { name: OBSERVER_BINDING }, sessionId).catch(() => {}),
    conn.send('Page.enable', {}, sessionId).catch(() => {}),
  ]);
  const [added] = await Promise.all([
    conn.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER_SOURCE }, sessionId).catch(() => undefined),
    conn.send('Runtime.evaluate', { expression: OBSERVER_SOURCE, returnByValue: false }, sessionId).catch(() => {}),
  ]);
  const scriptId = isRecord(added) ? readString(added, 'identifier') : undefined;
  return {
    dispose: () => {
      if (scriptId) {
        void conn
          .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }, sessionId)
          .catch(() => {});
      }
      void conn.send('Runtime.removeBinding', { name: OBSERVER_BINDING }, sessionId).catch(() => {});
    },
  };
}
