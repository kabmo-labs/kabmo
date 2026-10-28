import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { getSessionData } from '@/client/data/mock/chat';
import { isMockMode } from '@/server/mock.server';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { loadSessionMessages, loadSessionModel, loadSessionThinkingLevel, loadSessionTitle } from '@/server/lib/omp/session/messages';
import { mergeOmpAttachments, overlayRowsForOmpSession } from '@/server/lib/omp/session/merge-stored';
import { readRawHeaderLine } from '@/server/lib/omp/session/files';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
import { getLiveRunSessionIds } from '@/server/lib/omp/rpc/session-registry';

/** Newest-message window served by default for omp JSONL sessions; the client
 *  pages further back via `?before=` when the user scrolls to the top. Large
 *  enough to cover every realistic chat turn, small enough to keep the JSON
 *  payload (and the mobile parse+mount cost) bounded. */
const DEFAULT_MESSAGE_WINDOW = 120;

/** Slice a fully loaded message list into the requested tail window. */
function windowMessages<T>(
  messages: T[],
  limit: number | null,
  before: number | null,
): { messages: T[]; total: number; hasMore: boolean; oldestIndex: number } {
  const total = messages.length;
  if (limit === null || total <= limit) {
    return { messages, total, hasMore: false, oldestIndex: 0 };
  }
  // `before` is an exclusive upper bound into the full list; the window is the
  // `limit` messages ending just before it. A pending "new-…" session or a
  // fresh spawn has no index to continue from — the tail is the only window.
  const end = before !== null && before > 0 && before <= total ? before : total;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), total, hasMore: start > 0, oldestIndex: start };
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { sessionId } = params;
  if (!sessionId) {
    return json({ error: 'Session ID is required' }, { status: 400 });
  }

  const mock = isMockMode();
  // Timeline pagination: default to the newest `limit` messages; `before`
  // (0-based index into the FULL message list, from a previous response's
  // `oldestIndex`) pages further back. The full load stays available for
  // callers that need it (limit=all).
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const beforeParam = url.searchParams.get('before');
  const parseCount = (raw: string | null): number | null => {
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const before = parseCount(beforeParam);
  const limit = limitParam === 'all' ? null : (parseCount(limitParam) ?? DEFAULT_MESSAGE_WINDOW);

  try {
    // Real mode: an omp session UUID found on disk is authoritative — load its
    // messages straight from the session JSONL file (rich timeline). The
    // chat_sessions overlay is only for Kabmo-created sessions (mock or
    // synthetic ids).
    if (!mock) {
      const filePath = await findSessionFileById(sessionId);
      if (filePath) {
        // A run in flight is what makes a resultless tool call "still running"
        // rather than "finished with nothing": a page reloaded mid-call reads
        // the transcript, which cannot tell the two apart on its own.
        const messages = await loadSessionMessages(filePath, {
          liveRun: getLiveRunSessionIds().has(sessionId),
        });
        // Real omp JSONL only records image blocks — text/pdf attachments
        // never reach the file. The Kabmo's DB copy (written by the chat
        // timeline) carries the full attachment metadata, so merge it back
        // onto the matching user messages by content.
        const db = await getDb();
        const overlay = await db.get('SELECT messages FROM chat_sessions WHERE session_id = ?', [sessionId]);
        const overlaid = mergeOmpAttachments(messages, overlay?.messages);
        const loadedTitle = await loadSessionTitle(filePath);
        const rawFirstUser = overlaid.find((m) => m.role === 'user')?.content?.trim();
        const jsonlFirstUser = messages.find((m) => m.role === 'user')?.content?.trim();
        const titleIsPromptEcho = Boolean(
          loadedTitle && rawFirstUser && jsonlFirstUser && rawFirstUser !== jsonlFirstUser
          && (jsonlFirstUser.startsWith(loadedTitle) || loadedTitle.startsWith(jsonlFirstUser.slice(0, 60))),
        );
        // Match the sidebar's timestamped default instead of leaking a raw UUID.
        const header = await readRawHeaderLine(filePath);
        const headerTimestamp = typeof header?.timestamp === 'string' ? header.timestamp : undefined;
        const title = (titleIsPromptEcho ? rawFirstUser?.slice(0, 60) : loadedTitle)
          || rawFirstUser?.slice(0, 120)
          || (headerTimestamp ? formatNewSessionTitle(new Date(headerTimestamp)) : undefined)
          || `Session ${sessionId}`;
        const win = windowMessages(overlaid, limit, before);
        return json({
          session: {
            id: sessionId,
            title,
            messages: win.messages,
            model: await loadSessionModel(filePath),
            thinkingLevel: await loadSessionThinkingLevel(filePath),
          },
          isMock: false,
          source: 'omp-jsonl',
          total: win.total,
          hasMore: win.hasMore,
          oldestIndex: win.oldestIndex,
        });
      }
    }

    const db = await getDb();
    let existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', [sessionId]);

    if (!existing && mock) {
      const metaSession = await db.get('SELECT title FROM sessions WHERE id = ?', [sessionId]);
      if (metaSession?.title) {
        if (metaSession.title.includes('38 Tools Showcase')) {
          existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', ['1']);
        } else if (metaSession.title.includes('Dialogue Sample')) {
          existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', ['2']);
        } else if (metaSession.title.includes('Virtual Devices') || metaSession.title.includes('Oh-My-Pi Sample')) {
          existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', ['3']);
        }
      }
    }

    if (existing) {
      let parsedMessages = [];
      try {
        parsedMessages = JSON.parse(existing.messages);
      } catch {
        parsedMessages = [];
      }
      const hasDefaultTitle = !existing.title || String(existing.title).startsWith('Session ');
      const firstUserContent = Array.isArray(parsedMessages)
        ? parsedMessages.find((m: { role?: string; content?: string }) => m?.role === 'user')?.content
        : undefined;
      return json({
        session: {
          id: existing.session_id,
          title: (hasDefaultTitle && firstUserContent ? firstUserContent.slice(0, 120) : existing.title) || `Session ${sessionId}`,
          messages: parsedMessages,
        },
        isMock: mock,
      });
    }

    // Seed from default session data if mock mode, otherwise clean empty session
    const initial = (mock ? getSessionData(sessionId) : null) || {
      id: sessionId,
      title: `Session ${sessionId}`,
      messages: [],
    };

    await db.run(
      'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [sessionId, initial.title, JSON.stringify(initial.messages)]
    );

    return json({ session: initial, isMock: mock });
  } catch (error: any) {
    console.error('Chat session loader error:', error);
    return json({ error: error.message, isMock: mock }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { sessionId } = params;
  if (!sessionId) {
    return json({ error: 'Session ID is required' }, { status: 400 });
  }

  try {
    const db = await getDb();

    if (request.method === 'DELETE') {
      await db.run('DELETE FROM chat_sessions WHERE session_id = ?', [sessionId]);
      return json({ success: true });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const data = await request.json();
      const existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', [sessionId]);
      
      let currentMessages: any[] = [];
      let title = data.title || (existing ? existing.title : `Session ${sessionId}`);

      if (existing) {
        try {
          currentMessages = JSON.parse(existing.messages);
        } catch {
          currentMessages = [];
        }
      }

      let updatedMessages = currentMessages;

      if (data.action === 'reset') {
        const defaultData = getSessionData(sessionId);
        updatedMessages = defaultData?.messages || [];
      } else if (Array.isArray(data.messages)) {
        // Direct overwrite with new messages array
        updatedMessages = data.messages;
      } else if (data.message) {
        // Append single message
        updatedMessages = [...currentMessages, data.message];
      }

      // A session omp owns on disk has its transcript in the JSONL, so the
      // overlay keeps only the rows omp cannot record there — the user turns
      // (raw composer text, attachment metadata) and the notice rows. A session
      // with no file is Kabmo-created: the DB is its only copy, so it stays
      // whole. The gate is the file's existence, never the id's shape — an omp
      // uuid whose file is gone still needs its full row.
      const persistedMessages = (await findSessionFileById(sessionId))
        ? overlayRowsForOmpSession(updatedMessages)
        : updatedMessages;

      await db.run(
        'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [sessionId, title, JSON.stringify(persistedMessages)]
      );

      return json({
        success: true,
        session: {
          id: sessionId,
          title,
          messages: persistedMessages,
        },
      });
    }

    return methodNotAllowed({ request, params });
  } catch (error: any) {
    console.error('Chat session action error:', error);
    return json({ error: error.message }, { status: 500 });
  }
}
