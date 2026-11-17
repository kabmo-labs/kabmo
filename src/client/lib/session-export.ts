/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Export markdown" for one session row.
 *
 * The file is served by `/api/sessions/:id/export`, not built as a Blob in the
 * page: a native shell cannot download a `blob:` URL (Android's download
 * listener ignores it, and the desktop shells never see a navigation), so the
 * export has to be an HTTP URL the shell's own download path can fetch.
 *
 * The request is made once to validate the transcript and read the server's
 * filename, then the same URL is handed to the download anchor. A refusal
 * (no transcript, a failed read) is reported in words instead of saving the
 * server's error body under a `.md` name.
 */

import { saveUrl } from '@/client/lib/browser/download';
import { sessionMarkdownFileName } from '@/shared/lib/chat/export-markdown';

export type SessionExportResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

interface ErrorPayload {
  error?: string;
}

export async function exportSessionMarkdown(sessionId: string): Promise<SessionExportResult> {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/export`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'text/markdown' } });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read the session transcript.',
    };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorPayload | null;
    return {
      ok: false,
      error: body?.error ?? `Could not read the session transcript (HTTP ${response.status}).`,
    };
  }

  const markdown = await response.text();
  if (!markdown.trim()) {
    return { ok: false, error: 'This session has no transcript to export.' };
  }

  const name = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/i)?.[1]
    || sessionMarkdownFileName(undefined, sessionId);
  saveUrl(url, name);
  return { ok: true, name };
}
