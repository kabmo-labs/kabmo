import { useMemo } from 'preact/hooks';
import { Check, Clock, Server, Terminal } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { bashServiceOf, daemonTone, procUptime } from '@/shared/lib/omp/session/proc';
import { CopyButton } from '@/client/components/common/CopyButton';
import { stripAnsiCodes } from '@/shared/lib/code/ansi';
import { isCodeLike } from '@/shared/lib/code/language';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';
import { useDeferredHighlight } from '@/client/hooks/code/deferred-highlight';
import { HighlightedCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/HighlightedCode';
import { JsonCodeBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/JsonCodeBlock';
import { OutputWindow } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/OutputWindow';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';

interface BashMeta {
  exitCode?: unknown;
  cwd?: unknown;
  durationMs?: unknown;
  truncated?: unknown;
}

function parseWallTime(text: string): { cleanText: string; wallTime?: string } {
  const match = text.match(/\n*Wall time:\s*([^\n\r]+)$/);
  if (match) {
    return {
      cleanText: text.replace(/\n*Wall time:\s*[^\n\r]+$/, ''),
      wallTime: match[1].trim(),
    };
  }
  return { cleanText: text };
}

/** Panel untuk tool `bash` / `terminal` — terminal styled console dengan log highlighting & stats. */
export function Bash({ tool }: { tool: ToolCallData }) {
  const details = tool.details ?? {};
  const meta = details as BashMeta;
  const inputObj = typeof tool.input === 'object' && tool.input !== null ? (tool.input as Record<string, any>) : undefined;
  const command =
    tool.command ||
    (typeof inputObj?.command === 'string' ? inputObj.command : undefined) ||
    (typeof inputObj?.cmd === 'string' ? inputObj.cmd : undefined) ||
    (typeof inputObj?.CommandLine === 'string' ? inputObj.CommandLine : undefined) ||
    (typeof inputObj?.commandLine === 'string' ? inputObj.commandLine : undefined) ||
    (typeof tool.input === 'string' ? tool.input : '');
  const rawOutput = tool.output || (tool.error ? `Error: ${tool.error}` : '');

  const { cleanText: output, wallTime } = parseWallTime(rawOutput);

  const exitCode = typeof meta.exitCode === 'number' ? meta.exitCode : tool.isError ? 1 : undefined;
  const cwd =
    (typeof meta.cwd === 'string' ? meta.cwd : undefined) ||
    (typeof inputObj?.cwd === 'string' ? inputObj.cwd : undefined) ||
    (typeof inputObj?.Cwd === 'string' ? inputObj.Cwd : undefined);
  const durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : tool.durationMs;
  const duration = tool.duration || wallTime || (durationMs ? `${durationMs}ms` : undefined);

  const isSilent = !output || output === '(no output)';

  const jsonResult = useMemo(
    () => (!isSilent && !tool.isError ? tryParseJson(output) : { isValid: false }),
    [output, isSilent, tool.isError]
  );

  const strippedOutput = useMemo(() => stripAnsiCodes(output), [output]);
  const truncatedOutput = useMemo(() => truncateTailLines(strippedOutput, MAX_OUTPUT_LINES), [strippedOutput]);
  const copyText = useMemo(
    () => (jsonResult.isValid && jsonResult.pretty ? jsonResult.pretty : strippedOutput),
    [jsonResult, strippedOutput]
  );
  const outputIsCode = useMemo(() => isCodeLike(strippedOutput), [strippedOutput]);
  const outputLang = useMemo(
    () => (strippedOutput.trim().startsWith('{') || strippedOutput.trim().startsWith('[') ? 'json' : 'javascript'),
    [strippedOutput]
  );
  const truncatedPretty = useMemo(
    () => (jsonResult.isValid && jsonResult.pretty ? truncateTailLines(jsonResult.pretty, MAX_OUTPUT_LINES) : null),
    [jsonResult]
  );
  // Deferred: a command line is short, but the grammar's first compile is not,
  // and this card opens while a run streams.
  const highlightedCommand = useDeferredHighlight(command, 'bash');

  const service = bashServiceOf(tool);
  const serviceTone = daemonTone(service?.state);
  const serviceUptime = service ? procUptime(service) : undefined;

  return (
    <div className="space-y-2">
      {/* A named service launch is not just a command: omp reports the
          supervised process back in `details.service`, and `proc://<id>` reads
          the same snapshot. Without this strip the only thing the card said
          about a live dev server was its exit code. */}
      {service && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-ink/8 bg-paper px-3 py-2 font-mono text-[10.5px]">
          <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">
            <Server size={11} className="text-ink/40" />
            Service
          </span>
          <span className="font-semibold text-ink">{service.name}</span>
          <span
            className={`inline-flex items-center gap-1.5 font-semibold ${
              serviceTone === 'ok'
                ? 'text-success'
                : serviceTone === 'error'
                  ? 'text-error'
                  : serviceTone === 'warn'
                    ? 'text-warning'
                    : 'text-ink/50'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                serviceTone === 'ok'
                  ? 'bg-success'
                  : serviceTone === 'error'
                    ? 'bg-error'
                    : serviceTone === 'warn'
                      ? 'bg-warning animate-pulse'
                      : 'bg-ink/35'
              }`}
            />
            {service.state}
          </span>
          {service.pid !== undefined && (
            <span className="text-ink/45">
              pid <strong className="text-ink">{service.pid}</strong>
            </span>
          )}
          {serviceUptime && (
            <span className="text-ink/45">
              {typeof service.exitedAt === 'number' ? 'ran' : 'up'}{' '}
              <strong className="text-ink">{serviceUptime.label}</strong>
            </span>
          )}
          {service.exitCode !== undefined && (
            <span className={service.exitCode === 0 ? 'text-success' : 'text-error'}>exit {service.exitCode}</span>
          )}
          <span className="text-ink/35">
            read <span className="font-semibold">proc://{service.name}</span>
          </span>
        </div>
      )}

      {/* Terminal Command Window */}
      {command && (
        <div className="overflow-hidden rounded-lg border border-ink/10 bg-paper">
          <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/60 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Terminal size={11} className="shrink-0 text-ink/45" />
              <span className="font-mono text-[10px] font-semibold text-ink/50">bash</span>
              {cwd && (
                <span className="truncate font-mono text-[9.5px] text-ink/40" title={cwd}>
                  {cwd}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {exitCode !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.2 font-mono text-[9px] font-semibold ${
                    exitCode === 0 ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                  }`}
                >
                  exit {exitCode}
                </span>
              )}
              {duration && (
                <span className="flex items-center gap-1 font-mono text-[9.5px] text-ink/45">
                  <Clock size={10} />
                  <span>{duration}</span>
                </span>
              )}
              <CopyButton
                text={command}
                className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
                title="Copy command"
                label="Copy"
              />
            </div>
          </div>

          <div className="flex items-start gap-2.5 px-3 py-2 font-mono text-[11.5px] leading-relaxed">
            <span className="select-none font-bold text-ink/40">$</span>
            <pre
              className="shiki min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-ink/90 select-text"
              dangerouslySetInnerHTML={{ __html: highlightedCommand }}
            />
          </div>
        </div>
      )}

      {/* Output Console */}
      {isSilent ? (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-ink/15 bg-canvas/30 px-3 py-2 font-mono text-[11px] text-ink/50">
          <div className="flex items-center gap-2">
            <Check size={12} className="text-success" />
            <span>Command executed successfully with no output</span>
          </div>
          {duration && <span className="text-[10px] text-ink/40">Wall time: {duration}</span>}
        </div>
      ) : jsonResult.isValid && jsonResult.pretty ? (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/30 px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">Console Output</span>
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-ink/50">JSON</span>
              {jsonResult.linesCount && jsonResult.linesCount > 1 && (
                <span className="font-mono text-[9.5px] text-ink/40">{jsonResult.linesCount} lines</span>
              )}
            </div>
            <CopyButton
              text={jsonResult.isValid && jsonResult.pretty ? jsonResult.pretty : output}
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
              label="Copy"
            />
          </div>
          {truncatedPretty && truncatedPretty.skipped > 0 && (
            <div className="border-b border-ink/6 bg-canvas/40 px-3 py-1 font-mono text-[9.5px] text-ink/45">
              … {truncatedPretty.skipped} earlier lines hidden
            </div>
          )}
          <JsonCodeBlock
            jsonString={truncatedPretty ? truncatedPretty.text : jsonResult.pretty}
            maxHeightClass="max-h-72"
            showHeader={false}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/30 px-3 py-1.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">Console Output</span>
            <CopyButton
              text={copyText}
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
              label="Copy"
            />
          </div>
          {/* Only the tail is mounted: a 1000-line log inside a 288px box drew
              ~15 visible rows and 985 nobody can see. `OutputWindow` reveals the
              rest in steps, and the highlight runs on the slice on screen. */}
          <OutputWindow
            lines={truncatedOutput.text.split('\n')}
            className="max-h-72 overflow-y-auto overscroll-contain p-3 font-mono text-[11px] leading-relaxed select-text"
            render={(visible) =>
              outputIsCode ? (
                <HighlightedCode
                  code={visible.join('\n')}
                  language={outputLang}
                  className="overflow-x-auto whitespace-pre text-ink/85 leading-relaxed"
                />
              ) : (
                visible.map((line, idx) => {
                  const isSuccessLine = line.includes('✓') || line.includes('built in') || line.includes('ready: 0 errors');
                  const isErrorLine = line.includes('Error:') || line.includes('error:') || line.includes('FAILED');
                  const isWarningLine = line.includes('warning:') || line.includes('warn:');

                  return (
                    <div
                      key={idx}
                      className={`whitespace-pre-wrap break-words ${
                        isSuccessLine
                          ? 'text-success font-medium'
                          : isErrorLine
                            ? 'text-error font-medium'
                            : isWarningLine
                              ? 'text-warning font-medium'
                              : 'text-ink/80'
                      }`}
                    >
                      {line || '\u00a0'}
                    </div>
                  );
                })
              )
            }
          />
        </div>
      )}
    </div>
  );
}
