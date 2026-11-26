import { json } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { computeSessionContextTelemetry, emptyTelemetry } from '@/client/data/context-data';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { loadSessionSource } from '@/server/lib/chat/session-store.server';
import { computeRealSessionTelemetry } from '@/server/lib/omp/session/telemetry';
import { CONTEXT_LIMIT } from '@/server/lib/omp/session/telemetry/format';
import { resolveSelectedModelContextLimit } from '@/server/lib/models/selected-context-limit.server';
import { resolveSessionRef } from '@/server/lib/sessions/resolve.server';
import { acpTelemetryFor } from '@/server/lib/harness/acp/acp-telemetry.server';
import type { SessionContextTelemetry } from '@/shared/types';

/**
 * Raw message items never ride on the telemetry response: the panel fetches
 * its pages from /api/telemetry/raw-messages, so the summary stays light even
 * for very long sessions.
 */
function stripRawMessages(telemetry: SessionContextTelemetry): SessionContextTelemetry {
  return { ...telemetry, rawMessages: [] };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const mock = isMockMode();

  try {
    const source = await loadSessionSource(sessionId);

    // A session with no turn yet has no model of its own, so the window shown
    // is the one belonging to the model the user has PICKED. Read once, before
    // the branches, because every fallback below needs it.
    const selectedLimit = await resolveSelectedModelContextLimit() ?? CONTEXT_LIMIT;

    if (mock) {
      if (source?.kind === 'messages') {
        const telemetry = computeSessionContextTelemetry(sessionId, source.title, source.messages, selectedLimit);
        return json({ telemetry: stripRawMessages(telemetry), isMock: true });
      }
      const defaultMock = emptyTelemetry(sessionId || 'default', 'Session not started', selectedLimit);
      return json({ telemetry: defaultMock, isMock: true });
    }

    if (sessionId && source?.kind === 'jsonl') {
      const telemetry = await computeRealSessionTelemetry(source.filePath, sessionId);
      return json({ telemetry: stripRawMessages(telemetry), isMock: false, source: 'omp-jsonl' });
    }

    if (source?.kind === 'messages') {
      // An ACP chat's numbers come from the agent's own `usage_update`, not
      // from an estimate over the transcript. The omp-shaped computation below
      // invents token counts, a cost and a model id, which is exactly what the
      // panel must not show for a harness that reports real usage.
      const ref = sessionId ? await resolveSessionRef(sessionId) : null;
      if (ref?.harness && ref.harness !== 'omp-rpc') {
        const acp = await acpTelemetryFor(sessionId!, source.title);
        if (acp) return json({ telemetry: stripRawMessages(acp), isMock: false, source: 'acp-usage' });
        // No usage was ever reported (a chat that has not run, or one whose
        // agent sends none). The transcript still says how many turns exist,
        // so the panel shows a started session with zero usage rather than
        // "not started" over a conversation that is on screen.
        const rows = source.messages as { role?: string; model?: string }[];
        const userCount = rows.filter((row) => row.role === 'user').length;
        const model = rows.find((row) => typeof row.model === 'string' && row.model)?.model ?? '';
        const base = emptyTelemetry(sessionId || 'default', source.title, selectedLimit);
        return json({
          telemetry: {
            ...base,
            messagesCount: rows.length,
            userCount,
            assistantCount: rows.length - userCount,
            modelId: model,
            modelName: model,
          },
          isMock: false,
          source: 'acp-transcript',
        });
      }
      const telemetry = computeSessionContextTelemetry(sessionId, source.title, source.messages, selectedLimit);
      return json({ telemetry: stripRawMessages(telemetry), isMock: false });
    }

    const defaultTelemetry = emptyTelemetry('default', 'Session not started', selectedLimit);
    return json({ telemetry: defaultTelemetry, isMock: false });
  } catch (error: unknown) {
    console.error('Context telemetry loader error:', error);
    const fallback = emptyTelemetry('fallback', 'Session not started');
    return json({ telemetry: fallback, isMock: mock, error: error instanceof Error ? error.message : String(error) }, { status: 200 });
  }
}
