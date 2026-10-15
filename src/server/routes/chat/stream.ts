import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { handleSimulatedStreaming } from '@/shared/lib/chat/stream-service';
import { createSseStream } from '@/server/lib/sse';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import { localRuns } from '@/server/lib/omp/session/local-runs.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return handleStreamingRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleStreamingRequest(request);
}

async function handleStreamingRequest(request: Request) {
  const url = new URL(request.url);
  let sessionId = url.searchParams.get('sessionId') || `session-${Date.now()}`;
  let prompt = url.searchParams.get('prompt') || '';
  let modelName = url.searchParams.get('model') || 'DeepSeek V4 Pro';
  let workspaceName = url.searchParams.get('workspaceName') || 'Workspace';

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body.sessionId) sessionId = body.sessionId;
      if (body.prompt) prompt = body.prompt;
      if (body.model) modelName = body.model;
      if (body.workspaceName) workspaceName = body.workspaceName;
    } catch {
      // Use fallback query params if JSON parsing fails
    }
  }

  // Real mode routes through the omp agent RPC bridge (POST /api/agent/:id +
  // SSE /api/agent/:id/events). This simulated stream is the MOCK-only
  // path — refuse it in real mode so the two never conflict.
  if (!isMockMode()) {
    return new Response(JSON.stringify({ error: 'Streaming is handled by the omp agent bridge in real mode' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = createSseStream({
    headers: { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
    async onStart(handlers) {
      let isAborted = false;
      const abortListener = () => {
        isAborted = true;
      };
      request.signal.addEventListener('abort', abortListener);

      const sendEvent = (event: string, data: unknown): void => {
        if (isAborted) return;
        handlers.send(event, data);
        if (handlers.isClosed()) isAborted = true;
      };

      // A simulated run is a run all the same, and it reports through the SAME
      // row a real one does — the sidebar spinner and the chat's generating
      // indicator read one source, so this path must write it or the two
      // surfaces disagree about whether anything is happening. `localRuns`
      // claims it for this process, because there is no omp child behind it for
      // the registry to find: without the claim the sidebar's self-heal reads
      // the row as an orphan and clears the spinner mid-answer.
      localRuns().add(sessionId);
      void markStreamStatus(sessionId, 'stream');

      try {
        const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const messageId = `msg-${Date.now()}-ai`;

        // 1. Send initialization event
        sendEvent('init', {
          id: messageId,
          role: 'ai',
          date: `Today, ${timeStr}`,
          timestamp: timeStr,
          model: modelName,
        });

        // Simulated intelligent streaming — the MOCK-only path for OMPChamber.
        await handleSimulatedStreaming({
          prompt,
          modelName,
          workspaceName,
          sessionId,
          messageId,
          timeStr,
          sendEvent,
          isAborted: () => isAborted,
        });
      } catch (err: unknown) {
        if (!isAborted) {
          const message = err instanceof Error ? err.message : 'Streaming execution error';
          sendEvent('error', { error: message });
        }
      } finally {
        request.signal.removeEventListener('abort', abortListener);
        // Terminal badge, not a deletion: opening the session acknowledges it,
        // exactly as it does for a real run. An aborted stream is `abort`.
        void markStreamStatus(sessionId, isAborted ? 'abort' : 'finish');
        localRuns().delete(sessionId);
        handlers.close();
      }
    },
  });

  return stream.response;
}
