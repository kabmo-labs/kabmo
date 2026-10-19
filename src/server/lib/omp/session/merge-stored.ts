/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Merge Kabmo's own copy of a conversation onto the messages loaded from
 * an omp JSONL file.
 *
 * The JSONL is authoritative for what the model received, but it is not a
 * complete record of Kabmo's UI: omp rewrites raw composer input
 * (`@agent` → a task-tool delegation prompt, `/skill:a b` → `/skill:a`) and
 * writes no user entry at all for `/command` turns. The Kabmo DB keeps the
 * turn as the user typed it, which is what this restores.
 *
 * Attachments are UNIONED rather than picked from one side. The two sources see
 * different halves of the same attachment:
 *
 * - The JSONL recovers a text file's NAME from the delivered prompt (the
 *   composer inlines the file as `Attached file: <name>` plus a fenced block)
 *   and carries an image's bytes, but has no preview and no stored content.
 * - The Kabmo row has the display fields — a text file's name and content, an
 *   image's name and preview — but nothing about what omp actually received.
 *
 * Choosing one list over the other is what made a dropped `.md`/`.py`/`.json`
 * vanish from a reloaded session: the JSONL had an image, so its list won, and
 * the text file only ever existed in Kabmo row.
 */

export interface StoredAttachment {
  name?: string;
  preview?: string;
  type?: string;
  size?: number;
  content?: string;
}

export interface StoredMessage {
  id?: string;
  role: string;
  content: string;
  date?: string;
  timestamp?: string;
  /**
   * When omp recorded the entry, in epoch ms — `toChatMessage` stamps every
   * JSONL-derived row with it, and Kabmo's own rows carry the clock they
   * were created at. It is what positions a raw turn that no JSONL turn relates
   * to (see `anchorIndexFor`); `date` cannot serve, because a Kabmo row's is a
   * display string ("Today, 03:57 PM") rather than an ISO instant.
   */
  startedAt?: number;
  attachments?: StoredAttachment[];
  /**
   * A notice row — omp's own reminder/task-result entries, or Kabmo's
   * rendering of a builtin command's output. The JSONL cannot round-trip
   * command output at all: a `/context` or `/usage` turn writes no entry to the
   * session file, so the notice exists ONLY in the live frame, and without this
   * the row vanished on reload.
   */
  notice?: string;
}

/**
 * The only rows a Kabmo overlay needs for a session whose transcript omp owns
 * on disk: the user turns (the raw composer text and the attachment metadata the
 * JSONL cannot record) and the notice rows (builtin command output, which omp
 * writes nowhere).
 *
 * Every other row is a mirror of a JSONL entry: this module never reads one, and
 * rewriting the transcript on every `message_end` is what grew the overlay to
 * the size of the conversation it copies — measured at 165.6 MB of 167.9 MB of
 * `ai` rows that nothing consumes. A session with NO session file is a different
 * case and must stay whole — there the DB is the only copy — so callers gate on
 * the file, never on the id's shape.
 *
 * The merge depends on no mirror to place a turn either: a stored raw turn that
 * no JSONL user turn relates to is positioned by its own clock
 * (`anchorIndexFor`), not by scanning the stored array for a row the JSONL still
 * carries — which is what makes this narrowing self-sufficient rather than a
 * change that quietly moves a `/usage` or `/compact` bubble to the end of the
 * timeline. Verified against this install's own files: of 260 stored sessions
 * compared against their JSONLs, only the turns whose anchor the scan had been
 * supplying change position, and they change to the time they were sent.
 */
export function overlayRowsForOmpSession<T>(messages: T[]): T[] {
  return messages.filter((message) => {
    if (typeof message !== 'object' || message === null) return false;
    const record = message as { role?: unknown; notice?: unknown };
    if (record.role === 'user') return true;
    // Whitespace-only notices are dropped by the merge anyway; keeping one would
    // only carry bytes no renderer ever shows.
    return typeof record.notice === 'string' && record.notice.trim().length > 0;
  });
}

function isRawComposerInput(content: string): boolean {
  return /^\s*\//.test(content) || /(^|\s)@[A-Za-z0-9_-]+/.test(content);
}

/** Whether a JSONL-derived user turn (a) and a stored one (b) are the same
 *  request despite omp rewriting the delivered prompt. */
function userTurnsRelate(a: string, b: string): boolean {
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  // `@agent` is delivered to omp as a task-tool delegation prompt.
  if (a.startsWith('Use the task tool to delegate this request') && /(^|\s)@[A-Za-z0-9_-]+/.test(b)) {
    return true;
  }
  // `/skill:<name> <args>`: the JSONL only records a synthesized `/skill:<name>`.
  const token = a.split(' ')[0];
  return a.startsWith('/skill:') && Boolean(token) && b.startsWith(token);
}

/**
 * Union two attachment lists by name.
 *
 * The JSONL entry comes first, so the order the model received wins; a stored
 * entry with the same name fills in the fields the JSONL could not carry.
 */
function mergeAttachmentLists(
  fromJsonl: StoredAttachment[] | undefined,
  fromStore: StoredAttachment[] | undefined,
): StoredAttachment[] {
  const jsonl = Array.isArray(fromJsonl) ? fromJsonl : [];
  const stored = Array.isArray(fromStore) ? fromStore : [];
  if (jsonl.length === 0) return stored;
  if (stored.length === 0) return jsonl;
  const remaining = [...stored];
  const merged = jsonl.map((attachment) => {
    const index = remaining.findIndex((candidate) => candidate.name === attachment.name);
    if (index === -1) return attachment;
    const [match] = remaining.splice(index, 1);
    return {
      ...match,
      ...attachment,
      content: attachment.content ?? match.content,
      preview: attachment.preview || match.preview,
    };
  });
  // Anything the JSONL could not see (an attachment omp dropped before the
  // prompt was persisted) is still shown rather than silently discarded.
  return [...merged, ...remaining];
}

/**
 * Where an unmatched raw turn belongs in the merged timeline.
 *
 * Its own clock decides: the turn was typed before the next row omp recorded
 * after it, so it is inserted ahead of the first merged row that carries a later
 * `startedAt`. This replaced a scan for "the next stored row the JSONL still
 * carries" — that scan worked only while the overlay also held the mirrored
 * rows, which are exactly the rows `overlayRowsForOmpSession` drops, so it sent
 * every such turn to the tail of the timeline of a narrowed session (measured:
 * a `/usage` or `/compact` turn, 7 of them in one install).
 *
 * The scan is kept for a row with no clock to read — a legacy stored turn —
 * where it still resolves against an un-narrowed overlay, and `merged.length`
 * (append at the end) is the last resort rather than a silent drop.
 */
function anchorIndexFor(
  raw: StoredMessage,
  merged: StoredMessage[],
  jsonlIndex: Map<string, number>,
  stored: StoredMessage[],
): number {
  const at = raw.startedAt;
  if (typeof at === 'number' && Number.isFinite(at)) {
    const after = merged.findIndex((m) => typeof m.startedAt === 'number' && m.startedAt > at);
    if (after !== -1) return after;
  }
  for (let i = stored.indexOf(raw) + 1; i < stored.length; i += 1) {
    const id = stored[i]?.id;
    const found = typeof id === 'string' ? jsonlIndex.get(id) : undefined;
    if (found !== undefined) return found;
  }
  return merged.length;
}

/** Merge user turns and attachments from Kabmo DB copy onto the
 *  JSONL-loaded messages. */
export function mergeOmpAttachments(
  messages: StoredMessage[],
  storedMessagesJson: string | undefined,
): StoredMessage[] {
  if (!storedMessagesJson) return messages;
  let stored: StoredMessage[] = [];
  try {
    stored = JSON.parse(storedMessagesJson);
  } catch {
    return messages;
  }
  if (!Array.isArray(stored)) return messages;
  const storedUsers = stored.filter((m) => m?.role === 'user' && typeof m.content === 'string');

  const jsonlIndex = new Map<string, number>();
  messages.forEach((m, index) => {
    if (m.id) jsonlIndex.set(m.id, index);
  });

  const used = new Set<number>();
  const merged = messages.map((m) => {
    if (m.role !== 'user') return m;
    const storedIndex = storedUsers.findIndex((s, i) => !used.has(i) && userTurnsRelate(m.content, s.content));
    if (storedIndex === -1) return m;
    used.add(storedIndex);
    const storedMsg = storedUsers[storedIndex];
    const content = storedMsg.content !== m.content && isRawComposerInput(storedMsg.content)
      ? storedMsg.content
      : m.content;
    const attachments = mergeAttachmentLists(m.attachments, storedMsg.attachments);
    const next = { ...m, content };
    return attachments.length ? { ...next, attachments } : next;
  });

  // Unmatched raw turns are positioned by their own clock, and spliced
  // highest-anchor-first so earlier indices stay valid.
  const insertions = new Map<number, StoredMessage[]>();
  storedUsers.forEach((storedMsg, userIndex) => {
    if (used.has(userIndex) || !isRawComposerInput(storedMsg.content)) return;
    if (storedMsg.id && jsonlIndex.has(storedMsg.id)) return;
    const anchor = anchorIndexFor(storedMsg, merged, jsonlIndex, stored);
    const group = insertions.get(anchor);
    if (group) group.push(storedMsg);
    else insertions.set(anchor, [storedMsg]);
  });
  for (const anchor of [...insertions.keys()].sort((a, b) => b - a)) {
    const group = insertions.get(anchor);
    if (group) merged.splice(anchor, 0, ...group);
  }

  const byContent = new Map<string, StoredAttachment[]>();
  for (const m of stored) {
    if (m?.role === 'user' && Array.isArray(m.attachments) && m.attachments.length > 0) {
      byContent.set(m.content, m.attachments);
    }
  }
  const merged2 = merged.map((m) => {
    if (m.role !== 'user' || m.attachments?.length) return m;
    // The JSONL content may carry inlined text-file blocks appended to the
    // original prompt, so match by prefix instead of exact equality.
    const atts = byContent.get(m.content)
      ?? [...byContent.entries()].find(([storedContent]) =>
          m.content.startsWith(storedContent) || storedContent.startsWith(m.content)
        )?.[1];
    return atts ? { ...m, attachments: atts } : m;
  });
  return spliceStoredNotices(merged2, stored);
}

/**
 * Re-attach notice rows Kabmo stored but the JSONL cannot carry.
 *
 * A builtin slash command writes NOTHING to the session file — omp answers it
 * on the command path and the output lives only in the `command_output` frame —
 * so a `/context` or `/usage` row disappeared on reload, leaving a timeline that
 * had forgotten a command the user just ran. The Kabmo's own copy keeps them.
 *
 * Placement is by the USER TURN that produced them, never by id: Kabmo's
 * optimistic user row carries a `msg-…-user` id while the JSONL records omp's
 * own timestamp id, so the two never match. The stored list is walked backwards
 * to the nearest user message, and that message is located in the merged list
 * with the same content relation the attachment merge uses (omp rewrites the
 * delivered prompt, so equality alone would miss it). A notice whose anchor
 * cannot be resolved is appended at the end rather than dropped — losing it
 * again is the bug being fixed.
 */
function spliceStoredNotices(merged: StoredMessage[], stored: StoredMessage[]): StoredMessage[] {
  const storedNotices = stored
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role !== 'user' && typeof message?.notice === 'string' && message.notice.trim());
  if (storedNotices.length === 0) return merged;

  // Already present (a notice the JSONL itself carried, e.g. a task result):
  // matching on the text keeps the JSONL's own row authoritative.
  const present = new Set(merged.map((m) => (typeof m.notice === 'string' ? m.notice : '')).filter(Boolean));

  const mergedUsers = merged
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user');

  const insertions = new Map<number, StoredMessage[]>();
  for (const { message, index } of storedNotices) {
    if (present.has(message.notice as string)) continue;
    let anchor = merged.length;
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = stored[i];
      if (candidate?.role !== 'user' || typeof candidate.content !== 'string') continue;
      const hit = mergedUsers.find(({ message: user }) =>
        user.id !== undefined && candidate.id !== undefined && user.id === candidate.id,
      ) ?? mergedUsers.find(({ message: user }) => userTurnsRelate(user.content, candidate.content));
      if (hit) {
        anchor = hit.index + 1;
        break;
      }
    }
    const group = insertions.get(anchor);
    if (group) group.push(message);
    else insertions.set(anchor, [message]);
  }
  if (insertions.size === 0) return merged;

  const next = [...merged];
  for (const anchor of [...insertions.keys()].sort((a, b) => b - a)) {
    const group = insertions.get(anchor);
    if (group) next.splice(anchor, 0, ...group);
  }
  return next;
}
