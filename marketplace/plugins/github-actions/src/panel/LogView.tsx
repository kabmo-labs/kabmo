/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A job log, as plain text.
 *
 * Nothing here is markdown: a log is attacker-influenced text that happens to
 * contain `**`, backticks and `<` sequences, and rendering it as markdown would
 * let a workflow's own output draw a link. It is one `<pre>` that wraps, so a
 * long line stays readable in a 420 px column.
 *
 * The tail is a TAIL: the server cut it on a line boundary and says so, and the
 * notice names the byte count it came from rather than pretending the log began
 * where the visible text does.
 */

import type { LogTail } from '../protocol';

export interface LogState {
  loading: boolean;
  error: string | null;
  tail: LogTail | null;
}

interface LogViewProps {
  state: LogState;
  onFull: () => void;
  onReload: () => void;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LogView({ state, onFull, onReload }: LogViewProps) {
  if (state.loading && !state.tail) {
    return <p class="px-3 py-2 text-[11px] text-ink/50">Reading the log…</p>;
  }
  if (state.error) {
    return (
      <div class="px-3 py-2">
        <p class="text-[11px] text-error-text">{state.error}</p>
        <button
          type="button"
          onClick={onReload}
          class="mt-1 rounded border border-ink/15 px-2 py-0.5 text-[11px] text-ink/70 hover:bg-ink/5"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!state.tail) return null;
  return (
    <div class="flex min-h-0 flex-col">
      <div class="flex items-center gap-2 border-y border-ink/10 bg-canvas/40 px-3 py-1 font-mono text-[10px] text-ink/50">
        <span>{bytesLabel(state.tail.bytes)}</span>
        {state.tail.truncated ? <span>· tail shown</span> : <span>· whole log</span>}
        <button
          type="button"
          onClick={onFull}
          class="ml-auto rounded border border-ink/15 px-1.5 py-0.5 text-[10px] text-ink/70 hover:bg-ink/5"
        >
          Whole log
        </button>
      </div>
      <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-[1.45] text-ink/85">
        {state.tail.text}
      </pre>
    </div>
  );
}
