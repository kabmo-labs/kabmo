import { useMemo } from 'preact/hooks';
import { AlertCircle, Ban, Clock, Code2, Play } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { CopyButton } from '@/client/components/common/CopyButton';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { useDeferredHighlight } from '@/client/hooks/code/deferred-highlight';

/**
 * The line box both sides of a code card share — gutter row and code line.
 *
 * A gutter row and the code line beside it are separate elements, so they agree
 * only when their line boxes do. They did not: the gutter was `text-[10px]`
 * while the code was `text-[11px]`, and both inherited `leading-relaxed` — a
 * RATIO, so 10 × 1.625 = 16.25px against 11 × 1.625 = 17.875px. Each number
 * then sat 1.6px higher than its line, and by the tenth line the number was a
 * whole line above the code it labels (measured in the browser after a reload:
 * `gutterRowH 16.25`, `preLineHeight 17.875`, `firstRowOffset 10`).
 *
 * The box is stated ONCE and applied to both containers, because a `<div>`
 * holding one line takes its height from `line-height` — no per-row `h-[…]`
 * that could drift from the constant. This is the same shape `Read.tsx` and
 * `ExcerptCode` use.
 */
const LINE_BOX = 'leading-[18px]';

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
  // opens while its own output streams.
  const highlightedCode = useDeferredHighlight(truncatedCode.text, 'javascript');
  // The result is shown whole: an eval's output IS the answer, so hiding its
  // head behind a "… earlier lines hidden" line misreports what the cell returned.
  const highlightedJson = useDeferredHighlight(
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
          <div className={`flex max-h-56 items-start overflow-x-auto font-mono text-[11px] ${LINE_BOX} select-text`}>
            <div className={`sticky left-0 flex-shrink-0 select-none border-r border-ink/6 bg-canvas/50 py-2.5 pl-2.5 pr-2 text-right text-[10px] ${LINE_BOX} tabular-nums text-ink/25`}>
              {truncatedCode.text.split('\n').map((_, idx) => (
                <div key={idx}>{idx + 1}</div>
              ))}
            </div>
            <pre
              className={`flex-1 overflow-x-auto p-2.5 whitespace-pre ${LINE_BOX} text-ink/85 font-mono`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </div>
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
            <div className={`flex max-h-56 items-start overflow-x-auto font-mono text-[11px] ${LINE_BOX} select-text`}>
              <div className={`sticky left-0 flex-shrink-0 select-none border-r border-ink/6 bg-canvas/50 py-2.5 pl-2.5 pr-2 text-right text-[10px] ${LINE_BOX} tabular-nums text-ink/25`}>
                {jsonResult.pretty.split('\n').map((_, idx) => (
                  <div key={idx}>{idx + 1}</div>
                ))}
              </div>
              <pre
                className={`flex-1 overflow-x-auto p-2.5 whitespace-pre ${LINE_BOX} text-ink/85 font-mono`}
                dangerouslySetInnerHTML={{ __html: highlightedJson }}
              />
            </div>
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
