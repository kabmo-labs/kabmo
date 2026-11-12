/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A peer (IRC) message omp injected into a session.
 *
 * Since 18.18.9 a message that ends a `wait` no longer rides in the wait's
 * result (`CoordinationDetails.waited`): omp hands it to the recipient session,
 * which injects it as a `customType: "irc:incoming"` turn whose content is the
 * `<irc>` prompt envelope. `wait` itself now answers with
 * `Wait interrupted by message.` and `details.interrupted: true`.
 *
 * The envelope is prompt text for the model, not a transcript row: rendered
 * as-is it shows the reply instructions and the raw tag. The turn's `details`
 * carries the sender and the body verbatim, so both transcript mappers read
 * that instead, and a session recorded before 18.18.9 (whose wait result still
 * carries `waited`) keeps rendering through the wait card.
 */

import type { IrcMessageData } from '@/shared/types/omp/session';
import { isRecord } from '@/shared/lib/util/guards';

/** The `customType` omp stamps on an injected peer message. */
export const IRC_INCOMING_CUSTOM_TYPE = 'irc:incoming';

/** The peer message in a `details` object, or null when the shape is not one. */
export function ircMessageFromDetails(details: unknown): IrcMessageData | null {
  if (!isRecord(details)) return null;
  const from = typeof details.from === 'string' ? details.from.trim() : '';
  const message = typeof details.message === 'string' ? details.message.trim() : '';
  if (!from || !message) return null;
  return {
    ...(typeof details.id === 'string' && details.id ? { id: details.id } : {}),
    from,
    message,
    ...(typeof details.replyTo === 'string' && details.replyTo ? { replyTo: details.replyTo } : {}),
    ...(details.progress === true ? { progress: true } : {}),
    ...(details.broadcast === true ? { broadcast: true } : {}),
  };
}
