/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Full output" — the chip that opens the stream omp spilled to disk.
 *
 * When a tool result is too long omp keeps only a truncated body in the
 * transcript and writes the whole thing beside the session, leaving an
 * `artifactId` in `details.meta.limits`. Measured over 5,441 real results, 65
 * carry one — and they are the longest outputs in the corpus, so the reader was
 * stopped at 768 bytes exactly where they wanted the rest.
 *
 * The chip lives in the card's action slot rather than inside a panel: it must
 * be reachable without expanding anything, because the reason it exists is that
 * the body on screen is incomplete.
 */

import { useEffect, useState } from 'preact/hooks';
import { FileText, Loader2, X } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { CopyButton } from '@/client/components/common/CopyButton';
import { ArtifactBody } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ArtifactBody';
import { resolveTargetFile } from '@/client/components/workspace/chat-timeline/tool-renderers';
import { useTimelineScope } from '@/client/hooks/chat/timeline/scope';
import { artifactRefOf, artifactUrl } from '@/shared/lib/chat/tool/artifact';
import { artifactViewKind } from '@/shared/lib/chat/tool/artifact-view';
import { formatToolBytes } from '@/shared/lib/chat/tool/summary';
import type { ToolCallData } from '@/shared/types/chat';

interface ArtifactText {
  text: string;
  truncated: boolean;
  size: number;
}

/** The chip + its reader modal, or null when the result was not spilled. */
export function ArtifactChip({ tool }: { tool: ToolCallData }) {
  const ref = artifactRefOf(tool);
  const { sessionId } = useTimelineScope();
  const [open, setOpen] = useState(false);
  // The file the call targeted, so a spilled `read` renders with its own
  // grammar instead of the default one.
  const path = resolveTargetFile(tool);

  if (!ref || !sessionId) return null;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        title={
          ref.elidedBytes
            ? `Read the full output (${formatToolBytes(ref.elidedBytes)} elided)`
            : 'Read the full output'
        }
        aria-label="Read the full output"
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-ink/60 transition-colors hover:bg-ink/10 hover:text-ink"
      >
        <FileText size={10} />
        Full output
      </button>
      {open && (
        <ArtifactModal
          url={artifactUrl(sessionId, ref)}
          elidedBytes={ref.elidedBytes}
          path={path}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ArtifactModalProps {
  url: string;
  elidedBytes?: number;
  /** File the artifact belongs to, for a code excerpt's grammar. */
  path?: string;
  onClose: () => void;
}

/** Fetches the artifact once, on open. */
function ArtifactModal({ url, elidedBytes, path, onClose }: ArtifactModalProps) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ArtifactText }>({
    status: 'loading',
  });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
          setState({ status: 'error', message });
          return;
        }
        setState({ status: 'ready', data: (await response.json()) as ArtifactText });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Request failed' });
      }
    })();
    return () => controller.abort();
  }, [url]);

  const lineCount = state.status === 'ready' ? state.data.text.split(/\r?\n/).length : 0;
  // The badge names what the body IS, so a reader who expected code and got
  // prose can see why (a `bash` that cat'd a markdown file, an `eval` that
  // returned JSON). Derived from the same classifier the body dispatches on.
  const viewKind = state.status === 'ready' ? artifactViewKind(state.data.text) : null;

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-4xl"
      header={
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={14} className="shrink-0 text-ink/60" />
          <span className="text-[13px] font-semibold text-ink">Full output</span>
          {viewKind && (
            <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-ink/50">
              {viewKind}
            </span>
          )}
          {state.status === 'ready' && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-ink/45">
                {formatToolBytes(state.data.size)} · {lineCount} lines
                {elidedBytes ? ` · ${formatToolBytes(elidedBytes)} elided inline` : ''}
              </span>
              <CopyButton
                text={state.data.text}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
                iconSize={11}
                label="Copy"
              />
            </>
          )}
        </div>
      }
    >
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 px-5 py-6 font-mono text-[11.5px] text-ink/50">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading output…</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex items-center gap-2 px-5 py-6 font-mono text-[11.5px] text-error">
          <X size={12} className="shrink-0" />
          <span>{state.message}</span>
        </div>
      )}
      {state.status === 'ready' && (
        <div className="min-h-0">
          {state.data.truncated && (
            <div className="border-b border-ink/8 bg-canvas/50 px-5 py-1.5 font-mono text-[10px] text-ink/50">
              The output is too large to show whole — the tail is shown.
            </div>
          )}
          <ArtifactBody text={state.data.text} path={path} />
        </div>
      )}
    </Modal>
  );
}
