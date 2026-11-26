/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/sessions/:sessionId/export — the session transcript as a Markdown
 * download.
 *
 * A real HTTP response rather than a Blob the page builds: a native shell
 * cannot download a `blob:` URL (Android's download listener ignores it, and
 * the desktop shells never see a navigation), so the export has to be a URL
 * the shell's own download path can fetch. The chat loader is reused so the
 * file says exactly what the timeline shows — the same title, the same
 * attachment overlay, the same mock/imported branches.
 */

import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { json } from '@kabmo-labs/kabmo-http';
import { loader as chatLoader } from '@/server/routes/chat/session';
import { sessionMarkdownFileName, sessionToMarkdown } from '@/shared/lib/chat/export-markdown';
import type { ChatMessageData } from '@/shared/types';

interface ChatPayload {
  session?: { title?: string; messages?: ChatMessageData[] };
  error?: string;
}

export async function exportSessionMarkdown({ params }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const request = new Request(`http://kabmo.local/api/chat/${encodeURIComponent(sessionId)}?limit=all`);
  const response = await chatLoader({ params: { sessionId }, request });
  const payload = (await response.json().catch(() => null)) as ChatPayload | null;
  if (!response.ok) {
    return json({ error: payload?.error ?? 'Could not read the session transcript.' }, { status: response.status });
  }

  const messages = Array.isArray(payload?.session?.messages) ? payload.session.messages : [];
  if (messages.length === 0) {
    return json({ error: 'This session has no transcript to export.' }, { status: 404 });
  }

  const title = payload?.session?.title;
  const markdown = sessionToMarkdown({ id: sessionId, title, messages });
  // The header is latin-1: a non-ASCII byte or a quote would corrupt it.
  const name = sessionMarkdownFileName(title, sessionId)
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_') || 'session.md';
  return new Response(markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}
