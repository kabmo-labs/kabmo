import { useState } from 'preact/hooks';
import { AlignLeft, Code, Eye, FileCode, FileText, Layers, Terminal } from 'lucide-preact';
import type { ParsedTaskNotice } from '@/shared/lib/chat/task-result-parser';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CopyButton } from '@/client/components/common/CopyButton';
import { isCodeLike } from '@/shared/lib/code/language';
import { highlightCode } from '@/shared/lib/code/syntax-highlight';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';

interface TaskResultContentProps {
  task: ParsedTaskNotice;
}

export function TaskResultContent({ task }: TaskResultContentProps) {
  useSyntaxReady();
  const structured = task.structuredOutput;
  const isRawCode = !task.formattedJson && isCodeLike(task.rawOutput);

  const [activeTab, setActiveTab] = useState<'formatted' | 'raw'>(
    structured || !isRawCode ? 'formatted' : 'raw'
  );

  return (
    <div className="space-y-3">
      {/* Top action toolbar / tab toggles */}
      <div className="flex items-center justify-between border-b border-ink/8 pb-2">
        <div className="flex items-center gap-1.5">
          {(structured || !isRawCode) && (
            <button
              type="button"
              onClick={() => setActiveTab('formatted')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeTab === 'formatted'
                  ? 'bg-ink/10 text-ink'
                  : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              <Eye size={12} />
              <span>{structured ? 'Overview' : 'Markdown'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('raw')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeTab === 'raw'
                ? 'bg-ink/10 text-ink'
                : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
            }`}
          >
            <Code size={12} />
            <span>{task.formattedJson ? 'Raw JSON' : isRawCode ? 'Code' : 'Raw Text'}</span>
          </button>
        </div>

        <CopyButton
          text={task.formattedJson || task.rawOutput}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
          iconSize={12}
          title="Copy payload"
          resetMs={1800}
          wrapLabel
          copiedLabelClassName="text-success"
          label="Copy"
        />
      </div>

      {/* Tab: Formatted Structured View or Rich Markdown */}
      {activeTab === 'formatted' && (
        structured ? (
          <div className="space-y-3 text-[11.5px]">
            {/* Summary Callout */}
            {structured.summary && (
              <div className="rounded-lg border border-ink/10 bg-canvas/60 p-2.5">
                <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink/70">
                  <AlignLeft size={11} className="text-ink/60" />
                  <span>Summary</span>
                </div>
                <div className="leading-relaxed text-ink/85">
                  <MarkdownRenderer content={structured.summary} className="text-[11.5px]" />
                </div>
              </div>
            )}

            {/* Architecture info */}
            {structured.architecture && (
              <div className="rounded-lg border border-ink/8 bg-paper p-2.5">
                <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-semibold text-ink/70 uppercase tracking-wider">
                  <Layers size={11} className="text-ink/60" />
                  <span>Architecture</span>
                </div>
                <p className="leading-relaxed text-ink/80">{structured.architecture}</p>
              </div>
            )}

            {/* Inspected Files List */}
            {Array.isArray(structured.files) && structured.files.length > 0 && (
              <div className="rounded-lg border border-ink/8 bg-paper p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-ink/70 uppercase tracking-wider">
                    <FileCode size={11} className="text-ink/60" />
                    <span>Files Inspected</span>
                  </div>
                  <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] text-ink/50">
                    {structured.files.length} items
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {structured.files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col justify-between rounded border border-ink/6 bg-canvas/40 p-1.5 transition-colors hover:border-ink/15"
                    >
                      <span className="font-mono text-[10.5px] font-medium text-ink truncate">
                        {file.path}
                      </span>
                      {file.description && (
                        <span className="text-[10px] text-ink/60 leading-tight line-clamp-2 mt-0.5">
                          {file.description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Markdown Report */}
            {structured.report && (
              <div className="rounded-lg border border-ink/8 bg-paper p-2.5">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold text-ink/70 uppercase tracking-wider">
                  <FileText size={11} className="text-ink/60" />
                  <span>Report</span>
                </div>
                <div className="max-h-72 overflow-auto rounded border border-ink/6 bg-canvas/30 p-2 text-ink/85 scrollbar-overlay-container">
                  <MarkdownRenderer content={structured.report} className="text-[11.5px] leading-relaxed" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-ink/8 bg-paper p-3 text-[11.5px] leading-relaxed text-ink/85 max-h-72 overflow-auto scrollbar-overlay-container">
            <MarkdownRenderer content={task.rawOutput} />
          </div>
        )
      )}

      {/* Tab: Raw Code/JSON View */}
      {activeTab === 'raw' && (
        <pre
          className="max-h-64 overflow-auto rounded-lg border border-ink/8 bg-paper p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink/80 scrollbar-overlay-container"
          dangerouslySetInnerHTML={{
            __html: highlightCode(
              task.formattedJson || task.rawOutput,
              task.formattedJson ? 'json' : isRawCode ? 'javascript' : 'markdown'
            ),
          }}
        />
      )}

      {/* Outro & Follow-up URI Links */}
      {task.outro && (
        <div className="rounded-lg border border-ink/10 bg-canvas/60 p-2.5 text-[11px] text-ink/75">
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink/50">
            <Terminal size={11} />
            <span>Follow-up & Transcript</span>
          </div>
          <div className="text-[11.5px] leading-relaxed text-ink/85">
            <MarkdownRenderer content={task.outro} />
          </div>
        </div>
      )}
    </div>
  );
}
