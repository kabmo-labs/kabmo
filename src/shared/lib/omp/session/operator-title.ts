/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The operator's opening turn, as a display title — one rule for every reader.
 *
 * Three surfaces used to answer this question differently, and a `/skill:` turn
 * made them disagree in public:
 *
 *   - omp's own `operatorTitleText` (whose rule this mirrors): a `user` message,
 *     or a `custom` entry carrying `customType: "skill-prompt"` — the chip
 *     `/skill:<name> <args>`, NEVER the expanded SKILL.md body.
 *   - Kabmo's 4 KiB sidebar scan: looked only for `"role":"user"`, and a
 *     skill entry has no `role` field at all, so a `/skill:`-opened session
 *     reported `(no messages)` and its row read "New Session - <timestamp>"
 *     while the header showed the real title.
 *   - the header's full read: found the operator's turn, but through
 *     `loadSessionMessages`, which rewrites a skill turn to `/skill:<name>`
 *     (its args are dropped) — so it disagreed with omp's chip too.
 *
 * Both spellings of the rule live here: the OBJECT form for a parsed entry, and
 * the RAW-TEXT form for a prefix window whose entries are cut off. The raw form
 * is the one that matters for the sidebar — a skill entry's `details` (which
 * holds `args`) sits AFTER a multi-kilobyte `content`, past any bounded window,
 * so the name is recovered from the prompt's own opening line instead.
 */

import { extractStringProperty } from '@/shared/lib/omp/session/jsonl';
import { isRecord } from '@/shared/lib/util/guards';

/**
 * `User invoked the "<name>" skill …` — the header `buildSkillPromptMessage`
 * writes into a skill entry's `content`.
 *
 * In the JSONL the line is nested inside a JSON string, so every quote is
 * escaped (`User invoked the \"red-engineer\" skill`) — a pattern written
 * against the raw text with plain quotes matches nothing. Both spellings are
 * accepted, because the same line is also read from already-parsed content.
 */
const SKILL_INVOCATION_LINE = /User invoked the \\?"([^"\\]+)\\?" skill/;

/** The `custom_message` type omp writes for a `/skill:<name>` turn. */
export const SKILL_PROMPT_CUSTOM_TYPE = 'skill-prompt';

/** Text of a message's `content`, whether it is a string or a block array. */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/**
 * The chip a `/skill:` invocation displays as — `/skill:<name>` plus the
 * operator's args when they are known. Mirrors omp's `skillPromptTitleInput`
 * order (explicit chip, then prompt, then `name` + `args`) as far as the
 * available fields allow.
 */
export function skillChip(name: string, args?: string): string {
  const name0 = name.trim();
  if (!name0) return '';
  const args0 = args?.trim();
  return args0 ? `/skill:${name0} ${args0}` : `/skill:${name0}`;
}

/**
 * Title text of one PARSED entry, or `undefined` when it is not the operator's.
 *
 * Agent-attributed and non-user entries are excluded, exactly as omp excludes
 * them: an automatic title must never name a session after the agent's own
 * words.
 */
export function operatorTitleFromEntry(record: Record<string, unknown>): string | undefined {
  if (record.type === 'custom_message' && record.customType === SKILL_PROMPT_CUSTOM_TYPE) {
    // An explicit non-user attribution is agent work and must never name the
    // session. ABSENT is accepted on purpose: the raw-prefix reader cannot see
    // this field at all (omp writes it after `content`, past any bounded
    // window), and a rule that differed between the two readers is exactly the
    // disagreement this module exists to remove. Every skill entry measured in
    // the wild carries `"user"`.
    if (record.attribution !== undefined && record.attribution !== 'user') return undefined;
    const details: Record<string, unknown> | undefined = isRecord(record.details) ? record.details : undefined;
    const name = typeof details?.name === 'string' ? details.name : SKILL_INVOCATION_LINE.exec(textOfContent(record.content))?.[1];
    if (!name) return undefined;
    const args = typeof details?.args === 'string' ? details.args : undefined;
    return skillChip(name, args) || undefined;
  }
  if (record.type !== 'message') return undefined;
  const message: Record<string, unknown> | undefined = isRecord(record.message) ? record.message : undefined;
  if (!message || message.role !== 'user') return undefined;
  return textOfContent(message.content).trim() || undefined;
}

/**
 * Title text of the operator's opening turn inside a RAW-JSONL prefix window.
 *
 * Deliberately tolerant of a truncated line — the skill entry is routinely cut
 * mid-`content` — so it reads the fields a bounded window can actually hold:
 * a `customType` marker plus the invocation line inside the prompt, or a
 * `"role":"user"` pair with its `content`/`text`.
 *
 * The `content` of a skill entry is the expanded SKILL.md and is never used as
 * the title; only the name in its opening line is.
 */
export function firstOperatorTitleFromPrefix(content: string): string | undefined {
  let fallback: string | undefined;
  let index = content.indexOf('"role"');
  while (index !== -1) {
    const role = extractStringProperty(content, 'role', index);
    const text = extractStringProperty(content, 'content', index) ?? extractStringProperty(content, 'text', index);
    if (text) {
      if (role === 'user') return text;
      if (!fallback && (role === 'developer' || role === 'assistant')) fallback = text;
    }
    index = content.indexOf('"role"', index + 6);
  }
  // A skill turn carries no `role` field, so it is found by its own marker —
  // and the marker is read as a PROPERTY, not as a literal substring: the file
  // omp writes separates the colon with a space (`"customType": "skill-prompt"`)
  // and an entry can be cut mid-line by the window, so a fixed
  // `"customType":"…"` needle matches neither. The scan is anchored on
  // `customType` rather than on `"role"` for the same reason: a session opened
  // by `/skill:` has no user-role substring anywhere near the top of the file.
  let marker = content.indexOf('"customType"');
  while (marker !== -1) {
    if (extractStringProperty(content, 'customType', marker) === SKILL_PROMPT_CUSTOM_TYPE) {
      const name = SKILL_INVOCATION_LINE.exec(content.slice(marker))?.[1];
      if (name) return skillChip(name);
    }
    marker = content.indexOf('"customType"', marker + 12);
  }
  return fallback;
}
