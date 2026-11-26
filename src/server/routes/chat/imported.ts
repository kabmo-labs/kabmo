/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether this chat is a DISCOVERED one, and the name its agent reported.
 *
 * A chat Kabmo spawned has `origin = ''`; a row copied from the agent's own
 * history has `'imported'`. The loader uses that to say "the transcript is not
 * here yet" (the client asks the restore command) and to name the row from
 * `harness_sessions` rather than the UUID stamp an empty local row carries.
 */

import { loadHarnessSession, loadHarnessSessionTitle } from '@kabmo-labs/kabmo-harness/session/session-store.server';

export interface ImportedChat {
  imported: boolean;
  title: string;
  /** The agent that produced the row; '' when this is not an imported chat. */
  harness: string;
}

export async function importedChat(sessionId: string): Promise<ImportedChat> {
  const record = await loadHarnessSession(sessionId).catch(() => null);
  if (!record) return { imported: false, title: '', harness: '' };
  // The title and the harness are facts about the ROW, not about how it got
  // here: a spawned child needs both to name its header and to decide whether
  // its agent can replay a transcript Kabmo never received.
  return {
    imported: record.origin === 'imported',
    title: await loadHarnessSessionTitle(sessionId).catch(() => ''),
    harness: record.harness,
  };
}
