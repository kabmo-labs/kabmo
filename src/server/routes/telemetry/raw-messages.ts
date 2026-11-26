import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { loadSessionSource } from '@/server/lib/chat/session-store.server';
import { computeSessionContextTelemetry } from '@/client/data/context-data';
import { computeRawMessagesPage, type RawMessageRole } from '@/server/lib/omp/session/telemetry-raw';
import { resolveSessionRef } from '@/server/lib/sessions/resolve.server';
import { buildAcpRawMessages } from '@/server/lib/harness/acp/acp-raw-messages.server';
import { loadAcpFramesPage } from '@/server/lib/harness/acp/acp-frames.server';
import { loadAcpUsage } from '@/server/lib/harness/acp/acp-telemetry.server';
import type { ChatMessageData } from '@kabmo-labs/kabmo-chat-contracts/chat';
import type { RawMessageItem } from '@/shared/types';

const MAX_PAGE_SIZE = 100;

function parsePage(url: URL): { page: number; pageSize: number; role: RawMessageRole } {
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const rawSize = Number(url.searchParams.get('pageSize') ?? '20');
  const roleParam = url.searchParams.get('role');
  const role: RawMessageRole = roleParam === 'assistant' || roleParam === 'user' ? roleParam : 'all';
  return {
    page: Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawSize) ? Math.floor(rawSize) : 20)),
    role,
  };
}

/**
 * Paged raw session messages for the context panel. Source priority mirrors
 * /api/telemetry/context: omp session JSONL on disk, then the DB copy for
 * chat-created sessions, then mock data — so both endpoints always agree.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const { page, pageSize, role } = parsePage(url);
  const mock = isMockMode();

  try {
    const source = await loadSessionSource(sessionId);

    if (mock) {
      if (source?.kind === 'messages') {
        const telemetry = computeSessionContextTelemetry(sessionId, source.title, source.messages);
        return json(pagedFromList(telemetry.rawMessages, page, pageSize, role, telemetry.messagesCount));
      }
      return json({ items: [], total: 0, filteredTotal: 0, page, pageSize, isMock: true });
    }

    if (sessionId && source?.kind === 'jsonl') {
      const result = await computeRawMessagesPage(source.filePath, page, pageSize, role);
      return json({ ...result, page, pageSize, isMock: false, source: 'omp-jsonl' });
    }

    // An ACP chat has no JSONL: the raw panel reads the ORIGINAL
    // `session/update` payloads the agent sent, not Kabmo's folded transcript.
    // A session recorded before the frame log existed falls back to the
    // transcript rows, which are still truthful (no invented tokens/model).
    const ref = sessionId ? await resolveSessionRef(sessionId) : null;
    if (ref?.harness && ref.harness !== 'omp-rpc') {
      const usage = await loadAcpUsage(sessionId!).catch(() => null);
      const modelId = usage?.runModel
        ? `${usage.runModel.provider}/${usage.runModel.modelId}`
        : undefined;
      const context = {
        ...(modelId ? { modelId } : {}),
        ...(ref.cwd ? { cwd: ref.cwd } : {}),
      };
      const frames = await loadAcpFramesPage(sessionId!, page, pageSize, role, context);
      if (frames.total > 0) {
        return json({ ...frames, page, pageSize, isMock: false, source: 'acp-frames' });
      }
      if (source?.kind === 'messages') {
        const items = buildAcpRawMessages(source.messages as ChatMessageData[], context);
        return json({
          ...pagedFromList(items, page, pageSize, role, items.length),
          isMock: false,
          source: 'acp-transcript',
        });
      }
      return json({ items: [], total: 0, filteredTotal: 0, page, pageSize, isMock: false, source: 'acp-frames' });
    }

    if (source?.kind === 'messages') {
      const telemetry = computeSessionContextTelemetry(sessionId, source.title, source.messages);
      return json(pagedFromList(telemetry.rawMessages, page, pageSize, role, telemetry.messagesCount));
    }

    return json({ items: [], total: 0, filteredTotal: 0, page, pageSize, isMock: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Raw messages loader error:', error);
    return json({ items: [], total: 0, filteredTotal: 0, page, pageSize, error: message }, { status: 200 });
  }
}

/** Page a fully-computed raw list (mock / DB paths) with the panel's newest-first ordering. */
function pagedFromList(
  items: RawMessageItem[],
  page: number,
  pageSize: number,
  role: RawMessageRole,
  total: number,
) {
  const filtered = items.filter((m) => role === 'all' || m.info.role === role);
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).reverse(),
    total,
    filteredTotal: filtered.length,
    page,
    pageSize,
  };
}
