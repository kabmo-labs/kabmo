import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { getDb } from '@/server/db.server';
import { getSessionData } from '@/client/data/mock/chat';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const mock = isMockMode();

  try {
    const db = await getDb();

    if (sessionId) {
      const existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', [sessionId]);
      if (existing) {
        let parsedMessages = [];
        try {
          parsedMessages = JSON.parse(existing.messages);
        } catch {
          parsedMessages = [];
        }
        return json({
          session: {
            id: existing.session_id,
            title: existing.title || `Session ${sessionId}`,
            messages: parsedMessages,
          },
          isMock: mock,
        });
      }

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
    }

    // List all stored chat sessions
    const rows = await db.all('SELECT session_id, title, updated_at FROM chat_sessions ORDER BY updated_at DESC');
    return json({ sessions: rows, isMock: mock });
  } catch (error: any) {
    return json({ error: error.message, isMock: mock }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const db = await getDb();
    const data = await request.json();
    const sessionId = data.sessionId;

    if (!sessionId) {
      return json({ error: 'sessionId is required' }, { status: 400 });
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    const title = data.title || `Session ${sessionId}`;

    await db.run(
      'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [sessionId, title, JSON.stringify(messages)]
    );

    return json({ success: true, session: { id: sessionId, title, messages } });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
