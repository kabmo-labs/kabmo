import { useMemo } from 'preact/hooks';
import { Code } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CopyButton } from '@/client/components/common/CopyButton';
import { EnvelopeHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/EnvelopeHeader';
import { stripAnsiCodes } from '@/shared/lib/code/ansi';
import { outputMarkdown, readToolOutput } from '@/shared/lib/chat/tool-output';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';

interface FallbackOutputProps {
  /** Teks output mentah dari tool result. */
  text: string;
}

/** Blok "Output" generik untuk panel tanpa renderer khusus. Output selalu
 *  dirender sebagai markdown: envelope XML yang membungkus seluruh output
 *  dilepas dulu, dan konten verbatim (log/JSON/HTML) dipagari fence supaya
 *  parser tidak meremasnya jadi satu paragraf. */
export function FallbackOutput({ text }: FallbackOutputProps) {
  const stripped = useMemo(() => stripAnsiCodes(text), [text]);
  const output = useMemo(() => readToolOutput(stripped), [stripped]);
  const display = useMemo(() => truncateTailLines(output.content, MAX_OUTPUT_LINES), [output]);
  const markdown = useMemo(() => outputMarkdown(display.text, output.format), [display, output.format]);
  const lines = useMemo(() => output.content.split(/\r?\n/).length, [output.content]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
          <Code size={11} className="text-ink/40" />
          <span>Output</span>
          <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/45">
            {output.format}
          </span>
          {lines > 1 && (
            <span className="font-mono text-[10px] text-ink/35">
              {lines} lines
            </span>
          )}
        </div>
        <CopyButton
          text={output.content}
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
          onClick={(e) => e.stopPropagation()}
          label="Copy"
        />
      </div>
      {output.envelopes.length > 0 && <EnvelopeHeader envelopes={output.envelopes} />}
      {display.skipped > 0 && (
        <div className="font-mono text-[10px] text-ink/45">… {display.skipped} earlier lines hidden</div>
      )}
      <div className="max-h-72 overflow-auto rounded-lg border border-ink/8 bg-paper px-3 py-2.5 select-text">
        <MarkdownRenderer content={markdown} className="text-[12px] text-ink/85" />
      </div>
    </div>
  );
}
