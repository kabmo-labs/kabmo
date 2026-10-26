import { useMemo } from 'preact/hooks';
import { AlertCircle, Ban, Clock, Code2, Play } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { CopyButton } from '@/client/components/common/CopyButton';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';
import { NumberedCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/numbered-code';

/**
 * The `eval` card's two numbered blocks (the script and its pretty-printed
 * result) draw through `NumberedCode`, which states the line box and the font
 * size ONCE for both columns. They used to state it themselves — the gutter was
 * `text-[10px]` under the code's `text-[11px]`, so every number sat higher than
 * its line by a growing amount. The component's header holds the measurement;
 * this file no longer has a constant to drift from it.
 */

/** Panel khusus untuk tool `eval` — eksekusi kode script, browser eval, dsb. */
export function Eval({ tool }: { tool: ToolCallData }) {
  const input = tool.input;
  const inputObj = typeof input === 'object' && input !== null ? (input as Record<string, any>) : undefined;

  const code =
    typeof inputObj?.code === 'string'
      ? inputObj.code
      : typeof input === 'string'
        ? input
        : '';

  const language = (typeof inputObj?.language === 'string' ? inputObj.language : 'js').toUpperCase();
  const timeout = typeof inputObj?.timeout === 'number' ? `${inputObj.timeout}s` : undefined;

  const output = tool.output || (tool.error ? `Error: ${tool.error}` : '');
  const isError = tool.status === 'error' || output.includes('ToolError:') || output.includes('Command exited with code');
  const isAborted = output.includes('Command aborted') || tool.status === 'aborted';

  const jsonResult = useMemo(
    () => (!isError && !isAborted ? tryParseJson(output) : { isValid: false }),
    [output, isError, isAborted]
  );

  const truncatedCode = useMemo(() => truncateTailLines(code, MAX_OUTPUT_LINES), [code]);
  // A cell's script is short but the grammar compile is not, and an eval card
  // opens while its own output streams. Per LINE, because `NumberedCode` draws
  // one element per line on each side of the gutter.
  const highlightedCodeLines = useDeferredHighlightLines(truncatedCode.text, 'javascript');
  // The result is shown whole: an eval's output IS the answer, so hiding its
  // head behind a "… earlier lines hidden" line misreports what the cell returned.
  const highlightedJsonLines = useDeferredHighlightLines(
    jsonResult.isValid && jsonResult.pretty ? jsonResult.pretty : '',
    'json',
  );

  return (
    <div className="space-y-2">
      {/* Code Card */}
      {code && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/40 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <Code2 size={12} className="text-ink/60" />
              <span className="font-mono text-[10.5px] font-semibold text-ink">
                Script Evaluation
              </span>
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-ink/50">
                {language}
              </span>
              {timeout && (
                <span className="flex items-center gap-1 font-mono text-[9.5px] text-ink/40">
                  <Clock size={10} />
                  <span>{timeout}</span>
                </span>
              )}
            </div>

            <CopyButton
              text={code}
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
              label="Copy"
            />
          </div>

          {truncatedCode.skipped > 0 && (
            <div className="border-b border-ink/6 bg-canvas/40 px-3 py-1 font-mono text-[9.5px] text-ink/45">
              … {truncatedCode.skipped} earlier lines hidden
            </div>
          )}
          <NumberedCode
            numbers={truncatedCode.text.split('\n').map((_, idx) => idx + 1)}
            lines={highlightedCodeLines}
            className="max-h-56 overflow-x-auto select-text"
            gutterClassName="border-r border-ink/6 bg-canvas/50 py-2.5 pl-2.5 pr-2 text-ink/25"
            codeClassName="p-2.5 text-ink/85"
            lineHeight={18}
            fontSize={11}
          />
        </div>
      )}

      {/* Output / Result Block */}
      {output && (
        <div
          className={`overflow-hidden rounded-lg border ${
            isError
              ? 'border-error/25 bg-error/[0.03]'
              : isAborted
                ? 'border-warning/25 bg-warning/[0.03]'
                : 'border-ink/8 bg-paper'
          }`}
        >
          <div
            className={`flex items-center justify-between border-b px-3 py-1.5 ${
              isError
                ? 'border-error/15 bg-error/[0.06]'
                : isAborted
                  ? 'border-warning/15 bg-warning/[0.06]'
                  : 'border-ink/6 bg-canvas/30'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {isError ? (
                <>
                  <AlertCircle size={11} className="text-error" />
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-error">
                    Execution Error
                  </span>
                </>
              ) : isAborted ? (
                <>
                  <Ban size={11} className="text-warning" />
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-warning">
                    Evaluation Aborted
                  </span>
                </>
              ) : (
                <>
                  <Play size={11} className="text-success" />
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink/50">
                    Evaluation Result
                  </span>
                  {jsonResult.isValid && (
                    <>
                      <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-ink/50">
                        JSON
                      </span>
                      {jsonResult.linesCount && jsonResult.linesCount > 1 && (
                        <span className="font-mono text-[9.5px] text-ink/40">
                          {jsonResult.linesCount} lines
                        </span>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <CopyButton
              text={jsonResult.isValid && jsonResult.pretty ? jsonResult.pretty : output}
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
              label="Copy"
            />
          </div>

          {jsonResult.isValid && jsonResult.pretty ? (
            <NumberedCode
              numbers={jsonResult.pretty.split('\n').map((_, idx) => idx + 1)}
              lines={highlightedJsonLines}
              className="max-h-56 overflow-x-auto select-text"
              gutterClassName="border-r border-ink/6 bg-canvas/50 py-2.5 pl-2.5 pr-2 text-ink/25"
              codeClassName="p-2.5 text-ink/85"
              lineHeight={18}
              fontSize={11}
            />
          ) : (
            <pre
              className={`max-h-48 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words select-text ${
                isError ? 'text-error' : isAborted ? 'text-warning' : 'text-ink/80'
              }`}
            >
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
