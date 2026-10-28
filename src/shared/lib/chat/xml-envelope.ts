/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool output sometimes arrives wrapped in XML envelopes: omp's
 * `<system-reminder …>…</system-reminder>`, `<system-interrupt>`, an MCP
 * server's `<result>…</result>`. The tag is transport, not content — rendered as
 * markdown it shows as escaped markup instead of the message it carries, so the
 * timeline peels the wrapper before rendering the inner text.
 *
 * Three shapes are handled, and the rules that separate them from content are
 * what the tests pin:
 *
 * 1. **A leading wrapper.** It must open the output, its tags must balance and
 *    nest, and what follows the closing tag must be free text — a second
 *    element means there is no single wrapper. A tag in the middle of prose is
 *    content (`<div>` inside an HTML sample, `a < b`).
 * 2. **A run of notices.** omp emits ONE `system-reminder` PER MATCHED RULE, so
 *    a tool result routinely opens with two or three; a run is followed only
 *    for notice tags, since an HTML dump's siblings are content.
 * 3. **A trailing notice** (`takeTrailingNotice`). omp rewrites a command and
 *    reports it after the output, where there is no leading wrapper at all.
 *
 * **Fenced blocks and inline code spans are not markup.** A reminder that
 * documents a rule carries the rule's own TypeScript — `` `ReturnType<typeof fn>` ``,
 * `Promise<LoadedConfig>`, a ```typescript fence — and reading those as tags
 * unbalanced the scan, so the wrapper was never recognized and the row leaked
 * into the timeline as raw markup. Measured over the 352 `<system-reminder>`
 * blocks in this install's session files: 99 of them carry such a sample.
 *
 * The scan is hand-rolled (`./xml-tag.ts`): this module is shared with the
 * server, so there is no `DOMParser`, and it parses arbitrary tool output, so it
 * must never throw.
 */

import { scanElement } from '@/shared/lib/chat/xml-tag';

export interface XmlEnvelope {
  /** Element name, e.g. `system-reminder`. */
  tag: string;
  /** Attributes of the wrapper's start tag, e.g. `{ reason: 'rule_violation' }`. */
  attributes: Record<string, string>;
  /** Text between the wrapper's start and end tags, common indent removed. */
  inner: string;
  /** Free text that followed the closing tag, if any. */
  rest?: string;
}

/** Envelope tags that carry a runtime notice about the turn rather than a
 *  result: omp's `<system-reminder>` (a rule fired) and `<system-interrupt>`
 *  (a loop guard stopped the turn). Both are transport wrappers whose
 *  attributes name the reason, so the card header flags them instead of
 *  treating them as an ordinary result. */
const NOTICE_TAGS: Record<string, true> = {
  'system-reminder': true,
  reminder: true,
  'system-interrupt': true,
  'system-warning': true,
  'system-directive': true,
};

/** True for any wrapper that means "the runtime interrupted with a notice". */
export function isReminderTag(tag: string): boolean {
  return NOTICE_TAGS[tag] === true;
}

/** Every wrapper tag a notice payload can carry — the notice variants plus the
 *  ones `SystemNotice` reads for a task card. Used to strip the scaffolding
 *  before display; `normalizeNoticeText` deliberately does NOT do this, because
 *  the stored notice keeps its wrapper as the field's identity. */
const NOTICE_WRAPPER_TAG_RE = /<\/?(?:system-reminder|reminder|system-interrupt|system-warning|system-directive|system-notice|task-result)\b[^>]*>/gi;

/** Drop every notice wrapper tag, leaving the text it carried. */
export function stripNoticeTags(text: string): string {
  return text.replace(NOTICE_WRAPPER_TAG_RE, '');
}

/** Every XML wrapper the output consists of, in order.
 *
 *  A run is followed only for runtime-notice wrappers (`isReminderTag`): omp
 *  emits ONE `system-reminder` PER MATCHED RULE, so a single tool result
 *  routinely opens with two of them (measured: 86 of the 353 reminder blocks in
 *  this install's session files are the second element of such a run). Any
 *  other sibling markup still means there is no wrapper to peel — an HTML
 *  dump's `<div>`s are content and must stay raw.
 *
 *  Free text after the LAST wrapper rides on it as `rest`; the blank line omp
 *  writes BETWEEN two wrappers is separator, not content, and is dropped. */
export function unwrapXmlEnvelopes(text: string): XmlEnvelope[] {
  const first = text.search(/\S/);
  if (first === -1 || text[first] !== '<') return [];

  const head = scanElement(text, first);
  if (!head) return [];

  if (!isReminderTag(head.tag)) {
    const rest = text.slice(head.end).trim();
    if (rest.startsWith('<')) return [];
    return [{ tag: head.tag, attributes: head.attributes, inner: head.inner, ...(rest ? { rest } : {}) }];
  }

  const envelopes: XmlEnvelope[] = [{ tag: head.tag, attributes: head.attributes, inner: head.inner }];
  let cursor = head.end;
  for (;;) {
    while (cursor < text.length && /\s/.test(text[cursor] as string)) cursor += 1;
    if (cursor >= text.length) return envelopes;
    if (text[cursor] !== '<') break;
    const next = scanElement(text, cursor);
    if (!next || !isReminderTag(next.tag)) break;
    envelopes.push({ tag: next.tag, attributes: next.attributes, inner: next.inner });
    cursor = next.end;
  }
  const rest = text.slice(cursor).trim();
  if (rest) (envelopes[envelopes.length - 1] as XmlEnvelope).rest = rest;
  return envelopes;
}

/** The first wrapper of the output, when it is one. */
export function unwrapXmlEnvelope(text: string): XmlEnvelope | undefined {
  return unwrapXmlEnvelopes(text)[0];
}

const NOTICE_OPEN_RE = /<(system-reminder|reminder|system-interrupt|system-warning|system-directive)\b/gi;

/** A notice omp APPENDED after the output rather than wrapping it.
 *
 *  `<system-warning>` after a command's own lines is the shape: omp rewrote the
 *  command and reports it after the fact, so there is no leading wrapper to
 *  peel. The tag must sit on its own line at the very END of the output — an
 *  output that merely quotes a notice (source code shown by `rg`) keeps it as
 *  content, which is why the pair has to close the text. */
export function takeTrailingNotice(text: string): { before: string; envelope: XmlEnvelope } | undefined {
  const matches = [...text.matchAll(NOTICE_OPEN_RE)];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return undefined;

  // Own line, with real content before it.
  const before = text.slice(0, last.index);
  if (!before.trim() || !before.endsWith('\n')) return undefined;

  const element = scanElement(text, last.index);
  if (!element || !isReminderTag(element.tag)) return undefined;
  if (text.slice(element.end).trim() !== '') return undefined;

  return {
    before: before.replace(/\s+$/, ''),
    envelope: { tag: element.tag, attributes: element.attributes, inner: element.inner },
  };
}
