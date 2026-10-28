/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one rule every tool-output surface follows: **output is rendered as
 * markdown**.
 *
 * Two things happen before the parser sees it:
 *
 * 1. XML envelopes wrapping the output are peeled
 *    (`<system-reminder …>…</system-reminder>`, `<result>…</result>`). Those
 *    tags are transport — left in place, markdown escapes them and the user
 *    reads markup instead of the message it carries. omp emits one reminder
 *    PER MATCHED RULE, so a single tool result routinely opens with two.
 * 2. Content markdown would reflow gets fenced. A log, a JSON body, an HTML
 *    dump have no blank lines and no markers: parsed as prose they collapse
 *    into a single paragraph and their `#`/`-` lines turn into headings and
 *    bullets. A fence is still markdown, and it is the only shape that keeps
 *    such a blob verbatim.
 */

import { detectOutputFormat, type OutputFormat } from '@/shared/lib/chat/detect-format';
import { takeTrailingNotice, unwrapXmlEnvelopes, type XmlEnvelope } from '@/shared/lib/chat/xml-envelope';

export interface ToolOutputText {
  /** What the user reads: the XML envelopes peeled off, if there were any. */
  content: string;
  /** Format of `content`, deciding how `outputMarkdown` renders it. */
  format: OutputFormat;
  /** Wrappers that were peeled — rendered as the output's headers. */
  envelopes: XmlEnvelope[];
}

/** Read raw tool output into the text the timeline renders. */
export function readToolOutput(text: string): ToolOutputText {
  const leading = unwrapXmlEnvelopes(text);
  // A notice omp appended AFTER the output (a rewritten command it reports
  // after the fact) has no leading wrapper, so it is peeled from the tail.
  const trailing = leading.length === 0 ? takeTrailingNotice(text) : undefined;
  const envelopes = trailing ? [trailing.envelope] : leading;
  const content = trailing
    ? [trailing.before, trailing.envelope.inner].filter(Boolean).join('\n\n')
    : envelopes.length > 0
      ? [
          ...envelopes.map((envelope) => envelope.inner),
          ...envelopes.flatMap((envelope) => (envelope.rest ? [envelope.rest] : [])),
        ]
          .filter(Boolean)
          .join('\n\n')
      : text;
  return {
    content,
    format: detectOutputFormat(content),
    envelopes,
  };
}

/** Markdown for output content — verbatim formats are fenced so the parser
 *  cannot reflow them; markdown itself passes through untouched. */
export function outputMarkdown(content: string, format: OutputFormat): string {
  if (!content || format === 'markdown') return content;
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${format === 'text' ? '' : format}\n${content}\n${fence}`;
}
