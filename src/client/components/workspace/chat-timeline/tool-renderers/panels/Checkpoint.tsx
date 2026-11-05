import { Camera, RotateCcw } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';
import { formatTimestamp } from '@/shared/lib/format/time';

interface SnapshotInfo {
  id?: unknown;
  timestamp?: unknown;
  fileCount?: unknown;
  branch?: unknown;
  message?: unknown;
  description?: unknown;
}

/** Info snapshot untuk tool `checkpoint` / `rewind` — details atau output. */
export function Checkpoint({ tool }: { tool: ToolCallData }) {
  const details = tool.details ?? {};
  const info: SnapshotInfo = details && typeof details === 'object' ? details : {};
  const isRewind = tool.type === 'rewind';
  const id = typeof info.id === 'string' ? info.id : undefined;
  const ts = formatTimestamp(info.timestamp);
  const fileCount = typeof info.fileCount === 'number' ? info.fileCount : undefined;
  const branch = typeof info.branch === 'string' ? info.branch : undefined;
  const message = typeof info.message === 'string' ? info.message : typeof info.description === 'string' ? info.description : '';

  const hasStructured = Boolean(id || ts || fileCount || branch || message);

  if (!hasStructured) {
    if (!tool.output?.trim()) return null;
    return <FallbackOutput text={tool.output} />;
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-ink/8 bg-canvas/40 px-3 py-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink/5 text-ink/60">
        {isRewind ? <RotateCcw size={12} /> : <Camera size={12} />}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {message && <div className="text-[11.5px] text-ink/85">{message}</div>}
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink/45">
          {id && <span>{id}</span>}
          {ts && <span>{ts}</span>}
          {fileCount !== undefined && <span>{fileCount} files</span>}
          {branch && <span>{branch}</span>}
        </div>
      </div>
    </div>
  );
}
