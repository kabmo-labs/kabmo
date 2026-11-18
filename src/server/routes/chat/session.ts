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
import { importedChat } from '@/server/routes/chat/imported';
import { loadAcpTranscript } from '@/server/lib/harness/acp/session-transcript.server';
import { getSessionRelation } from '@/server/lib/sessions/relations.server';
import { windowMessages } from '@/server/routes/chat/window';
import { readCodexRolloutTranscript } from '@/server/lib/harness/codex/transcript.server';
import { getLiveRunSessionIds, getLiveSession, harnessOfSession } from '@/server/lib/omp/rpc/session-registry';
import { loadStreamStates } from '@/shared/lib/omp/session/stream-state.server';
import { configByCategory, selectValues } from '@/server/lib/harness/launch';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';
import { liveMetaFields, type LiveSessionMeta } from '@/server/routes/chat/live-meta';
import { hasAssistantRow } from '@/shared/lib/chat/transcript-rows';

/** Newest-message window served by default for omp JSONL sessions; the client
 *  pages further back via `?before=` when the user scrolls to the top. Large
 *  enough to cover every realistic chat turn, small enough to keep the JSON
 *  payload (and the mobile parse+mount cost) bounded. */
const DEFAULT_MESSAGE_WINDOW = 120;

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
    // A non-omp ACP chat has no JSONL for this loader to read, and its stored
    // row carries no model. Reopening that tab made the composer fall back to
    // omp's catalog and name a model the agent never ran. The LIVE session's
    // own selector is the only honest source — and `get_state` on the ACP
    // driver is an in-process read, not a round trip to the agent.
    let liveMeta: LiveSessionMeta | null = null;
    if (!mock) {
      const live = getLiveSession(sessionId);
      if (live?.isAlive() && harnessOfSession(live) !== 'omp-rpc') {
        const harness = harnessOfSession(live);
        const state = (await live.send({ type: 'get_state' }).catch(() => null)) as {
          model?: { provider?: unknown; id?: unknown };
          thinkingLevel?: unknown;
          configOptions?: unknown;
        } | null;
        const provider = typeof state?.model?.provider === 'string' ? state.model.provider : '';
        const modelId = typeof state?.model?.id === 'string' ? state.model.id : '';
        const selectors: AcpConfigOption[] = Array.isArray(state?.configOptions)
          ? (state.configOptions as AcpConfigOption[])
          : [];
        // The session's OWN selector lists, so the picker lists exactly what
        // this agent offers — a probe is one throwaway spawn that a chat already
        // running can contradict (codex refuses the probe while offering models).
        const models = selectValues(configByCategory(selectors, 'model'));
        const thinking = selectValues(configByCategory(selectors, 'thought_level'));
        liveMeta = {
          ...(provider && modelId ? { model: { provider, modelId } } : {}),
          ...(typeof state?.thinkingLevel === 'string' && state.thinkingLevel
            ? { thinkingLevel: state.thinkingLevel }
            : {}),
          harness,
          liveModels: {
            models,
            ...(thinking.length > 0 ? { thinking } : {}),
          },
        };
      }
    }
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
        // An ACP harness can own an on-disk transcript too — omp's own ACP server
        // writes the same JSONL — and this branch used to return without the live
        // session's own fields. The tab then published no selectors at all, so the
        // picker for that harness could only ever list a probe snapshot instead of
        // the list the RUNNING agent offers (`get_state` → `configOptions`), and
        // the composer named the file's model rather than the one in force. The
        // live halves win; the file answers once the session is gone.
        return json({
          session: {
            id: sessionId,
            title,
            messages: win.messages,
            ...liveMetaFields(
              liveMeta,
              await loadSessionModel(filePath),
              await loadSessionThinkingLevel(filePath),
            ),
          },
          isMock: false,
          source: 'omp-jsonl',
          total: win.total,
          hasMore: win.hasMore,
          oldestIndex: win.oldestIndex,
        });
      }
    }

    // An IMPORTED chat has a sidebar row but no transcript here: the agent holds
    // it. The payload says so, and the client asks the restore command to copy it
    // in. A chat Kabmo spawned has `origin = ''` and never takes this path.
    const { imported, title: harnessTitle, harness: recordedHarness } = mock
      ? { imported: false, title: '', harness: '' }
      : await importedChat(sessionId);
    // A child spawned SERVER-SIDE (an orchestration worker, a CLI child) has no
    // tab, so the client never wrote its transcript. Its agent still holds the
    // conversation, and `session/load` can replay it — the same path an
    // imported chat uses. The relation is what tells the two apart from a
    // brand-new top-level chat, which must not spawn an agent just to replay
    // nothing.
    const isChild = !mock && Boolean((await getSessionRelation(sessionId).catch(() => null))?.parentSessionId);
    const canRestore = !mock && (imported || isChild) && recordedHarness !== '' && recordedHarness !== 'omp-rpc';
    // A Codex session open in another client refuses `session/resume`, so a
    // restore cannot show it. The rollout is readable while that client holds
    // the thread, and it is only consulted when the local transcript is empty.
    const codexMessages = imported && recordedHarness === 'codex'
      ? await readCodexRolloutTranscript(sessionId)
      : [];

    const db = await getDb();
    // No live session (a restart, a closed tab): the last run's model is still
    // in `session_stream_state`, and it is the only truthful identity for an
    // ACP chat — its agent stores no model in the transcript.
    const recordedModel = !mock && !liveMeta?.model
      ? (await loadStreamStates())[sessionId]?.model
      : undefined;
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
      // The server-side recorder is the fallback for a chat no tab ever wrote:
      // an orchestration worker, a CLI child. `chat_sessions` still wins when
      // it holds an ANSWER, because an open tab's copy carries the attachment
      // chips and notice rows this fold does not build. A user-only row is a
      // prompt the client wrote before its tab closed, not a transcript.
      const localHasAnswer = hasAssistantRow(parsedMessages);
      const recordedMessages = localHasAnswer ? [] : await loadAcpTranscript(sessionId);
      const messages = localHasAnswer
        ? parsedMessages
        : (recordedMessages.length > 0 ? recordedMessages : (codexMessages.length > 0 ? codexMessages : parsedMessages));
      const localTitle = hasDefaultTitle && firstUserContent ? firstUserContent.slice(0, 120) : existing.title;
      // The imported row's name is in `harness_sessions`; the empty local row
      // an earlier open created carries the UUID stamp instead, which put a
      // second spelling of the chat's name in the header. A spawned child has
      // the same problem: its title is the harness's, not the UUID.
      const title = (imported || isChild) && (!localTitle || String(localTitle).startsWith('Session '))
        ? harnessTitle || localTitle || `Session ${sessionId}`
        : localTitle || `Session ${sessionId}`;
      return json({
        session: {
          id: existing.session_id,
          title,
          messages,
          ...(canRestore && !hasAssistantRow(messages) ? { restore: true } : {}),
          ...liveMetaFields(liveMeta, recordedModel),
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

    const recordedMessages = await loadAcpTranscript(sessionId);
    const seedTitle = harnessTitle || initial.title;
    const seededMessages = recordedMessages.length > 0
      ? recordedMessages
      : (codexMessages.length > 0 ? codexMessages : initial.messages);
    await db.run(
      'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [sessionId, seedTitle, JSON.stringify(initial.messages)]
    );

    return json({
      session: {
        ...initial,
        title: seedTitle,
        messages: seededMessages,
        ...(canRestore && !hasAssistantRow(seededMessages) ? { restore: true } : {}),
        ...liveMetaFields(liveMeta, recordedModel),
      },
      isMock: mock,
    });
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
