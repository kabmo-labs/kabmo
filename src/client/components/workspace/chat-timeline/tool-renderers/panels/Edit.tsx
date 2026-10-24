import { useMemo } from 'preact/hooks';
import { ArrowRight, FileCode, FileEdit, FilePlus } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { DiffView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/DiffView';
import { HashlinePatch } from '@/client/components/workspace/chat-timeline/tool-renderers/hashline-patch';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { EnvelopeHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/EnvelopeHeader';
import { ExcerptCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ExcerptCode';
import { ToolPanelHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolPanelHeader';
import { parseEditOutput } from '@/shared/lib/chat/excerpt';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { useDeferredHighlight } from '@/client/hooks/code/deferred-highlight';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { outputMarkdown, readToolOutput } from '@/shared/lib/chat/tool-output';
import { hashlinePatchFromArgs } from '@/shared/lib/omp/session/hashline-patch';
import { formatBytes } from '@/shared/lib/format/number';

/** Synthesize a standard unified diff from old_string and new_string */
function createUnifiedDiff(oldStr: string, newStr: string, filePath = 'diff'): string {
  const oldLines = oldStr ? oldStr.split(/\r?\n/) : [];
  const newLines = newStr ? newStr.split(/\r?\n/) : [];

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const contextBefore = oldLines.slice(Math.max(0, prefix - 2), prefix);
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  const contextAfter = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + 2);

  const cleanPath = filePath || 'diff';
  const diffLines: string[] = [
    `--- a/${cleanPath}`,
    `+++ b/${cleanPath}`,
    `@@ -1,${oldLines.length || 1} +1,${newLines.length || 1} @@`,
  ];

  for (const line of contextBefore) {
    diffLines.push(` ${line}`);
  }
  for (const line of removed) {
    diffLines.push(`-${line}`);
  }
  for (const line of added) {
    diffLines.push(`+${line}`);
  }
  for (const line of contextAfter) {
    diffLines.push(` ${line}`);
  }

  return diffLines.join('\n');
}

/** Panel khusus untuk operasi edit file (write, edit, edit_file, create_file). */
export function Edit({ tool }: { tool: ToolCallData }) {
  const isWrite = tool.type === 'write' || tool.name === 'write' || tool.type === 'create_file';
  const input = tool.input;
  const inputObj = typeof input === 'object' && input !== null ? (input as Record<string, any>) : undefined;

  // omp's hashline `edit` sends the patch text instead of path/old/new strings.
  const hashline = useMemo(() => hashlinePatchFromArgs(inputObj), [inputObj]);

  const targetPath =
    tool.target ||
    hashline?.sections[0].path ||
    (inputObj?.path as string) ||
    (inputObj?.TargetFile as string) ||
    (inputObj?.targetFile as string) ||
    (inputObj?.FilePath as string) ||
    (inputObj?.filePath as string) ||
    (inputObj?.AbsolutePath as string) ||
    (inputObj?.absolutePath as string) ||
    (typeof tool.details?.path === 'string' ? tool.details.path : undefined) ||
    (typeof input === 'string' && (input.includes('/') || input.includes('.')) ? input : undefined) ||
    '';

  const newContent =
    typeof inputObj?.content === 'string'
      ? inputObj.content
      : typeof inputObj?.Content === 'string'
        ? inputObj.Content
        : undefined;

  const oldString =
    typeof inputObj?.old_string === 'string'
      ? inputObj.old_string
      : typeof inputObj?.oldString === 'string'
        ? inputObj.oldString
        : typeof inputObj?.TargetContent === 'string'
          ? inputObj.TargetContent
          : typeof inputObj?.targetContent === 'string'
            ? inputObj.targetContent
            : undefined;

  const newString =
    typeof inputObj?.new_string === 'string'
      ? inputObj.new_string
      : typeof inputObj?.newString === 'string'
        ? inputObj.newString
        : typeof inputObj?.ReplacementContent === 'string'
          ? inputObj.ReplacementContent
          : typeof inputObj?.replacementContent === 'string'
            ? inputObj.replacementContent
            : undefined;

  const replacementChunks = Array.isArray(inputObj?.ReplacementChunks)
    ? (inputObj.ReplacementChunks as Array<{ TargetContent?: string; ReplacementContent?: string }>)
    : undefined;

  const explicitDiff =
    tool.diff?.diffText ||
    (typeof tool.details?.diff === 'string' ? tool.details.diff : undefined) ||
    (typeof tool.details?.patch === 'string' ? tool.details.patch : undefined);

  const diffText = useMemo(() => {
    if (explicitDiff) return explicitDiff;
    if (replacementChunks && replacementChunks.length > 0) {
      return replacementChunks
        .map((chunk) => createUnifiedDiff(chunk.TargetContent || '', chunk.ReplacementContent || '', targetPath))
        .join('\n');
    }
    if (oldString || newString) {
      return createUnifiedDiff(oldString || '', newString || '', targetPath);
    }
    return undefined;
  }, [explicitDiff, replacementChunks, oldString, newString, targetPath]);

  const output = tool.output || '';
  const lang = getLanguageFromPath(targetPath);

  const truncatedOld = useMemo(() => (oldString ? truncateTailLines(oldString, MAX_OUTPUT_LINES) : null), [oldString]);
  const truncatedNew = useMemo(() => (newString ? truncateTailLines(newString, MAX_OUTPUT_LINES) : null), [newString]);
  const previewLineCount = useMemo(() => (newContent ? newContent.split('\n').length : 0), [newContent]);

  /**
   * Which of the three blocks this card actually DRAWS.
   *
   * They are mutually exclusive in the markup below — a card with a diff shows
   * neither the replacement pair nor the write preview — and the highlights
   * used to run for all three on every render regardless: three tokenizer passes
   * to paint one block, measured as the largest single contributor to an `edit`
   * card's expand. Gating the input on the branch that renders it makes the two
   * unused passes `''`, which the hook treats as nothing to compute.
   */
  const showsReplacement = !diffText && Boolean(oldString || newString);
  const showsPreview = !diffText && !oldString && !newString && Boolean(newContent);
  const highlightedOld = useDeferredHighlight(
    showsReplacement && truncatedOld ? truncatedOld.text : '',
    lang,
  );
  const highlightedNew = useDeferredHighlight(
    showsReplacement && truncatedNew ? truncatedNew.text : '',
    lang,
  );
  const highlightedPreview = useDeferredHighlight(
    showsPreview && newContent ? newContent.split('\n').slice(0, 80).join('\n') : '',
    lang,
  );

  // omp answers an edit with the excerpt it touched, not with prose: numbered
  // rows under a `[path#TAG]` header. Rendered as markdown that is one plain
  // code block whose first line is the path; the rows and the notes around them
  // are separated here so each gets the surface it needs.
  const sections = useMemo(() => {
    if (!output) return [];
    return parseEditOutput(output).map((section) => {
      const notes = section.notes.join('\n').trim();
      if (!notes) return { ...section, notesMarkdown: '', envelopes: [] };
      const read = readToolOutput(notes);
      return { ...section, notesMarkdown: outputMarkdown(read.content, read.format), envelopes: read.envelopes };
    });
  }, [output]);

  return (
    <div className="space-y-2.5">
      {/* Target Path Bar */}
      <ToolPanelHeader
        icon={isWrite ? <FilePlus size={12} /> : <FileEdit size={12} />}
        label={targetPath || 'File modification'}
        badge={isWrite ? 'Write' : 'Edit'}
        copyText={newContent || newString || hashline?.text || output || undefined}
        copyLabel="Copy change"
      />

      {/* Unified Diff if available */}
      {diffText && (
        <div className="space-y-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">Diff Changes</div>
          <DiffView text={diffText} path={targetPath} />
        </div>
      )}

      {/* Hashline patch (omp `edit` args) — shown until the toolResult carries
          the applied diff in `details.diff`/`details.patch`. */}
      {!diffText && hashline && <HashlinePatch sections={hashline.sections} />}

      {/* Replacement Diff (old_string vs new_string) */}
      {!diffText && (oldString || newString) && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">Replacement Changes</div>
          <div className="overflow-hidden rounded-lg border border-ink/8">
            {oldString && (
              <div className="border-b border-ink/6 bg-error/[0.04] p-2.5">
                <div className="mb-1 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-error">
                  <span>- Original Content</span>
                </div>
                {truncatedOld && truncatedOld.skipped > 0 && (
                  <div className="mb-1 font-mono text-[9.5px] text-ink/45">… {truncatedOld.skipped} earlier lines hidden</div>
                )}
                <pre
                  className="max-h-40 overflow-x-auto font-mono text-[11px] leading-relaxed text-error/90 whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: highlightedOld }}
                />
              </div>
            )}
            {newString && (
              <div className="bg-success/[0.04] p-2.5">
                <div className="mb-1 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-success">
                  <span>+ Replaced With</span>
                </div>
                {truncatedNew && truncatedNew.skipped > 0 && (
                  <div className="mb-1 font-mono text-[9.5px] text-ink/45">… {truncatedNew.skipped} earlier lines hidden</div>
                )}
                <pre
                  className="max-h-48 overflow-x-auto font-mono text-[11px] leading-relaxed text-success/90 whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: highlightedNew }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Written File Content Preview for write/create_file */}
      {!diffText && !oldString && !newString && newContent && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">
            <span className="flex items-center gap-1">
              <FileCode size={11} />
              <span>Written File Preview</span>
            </span>
            <span className="font-mono text-[9px] text-ink/50">
              {previewLineCount} lines · {formatBytes(newContent.length)}
            </span>
          </div>
          <div className="flex max-h-64 items-start overflow-x-auto rounded-lg border border-ink/8 bg-paper font-mono text-[11px] leading-[20px] select-text overscroll-contain">
            <div
              className="sticky left-0 z-10 flex-shrink-0 select-none border-r border-ink/8 bg-canvas/60 py-2.5 pl-2.5 pr-2 text-right font-mono text-[11px] leading-[20px] tabular-nums text-ink/25"
              aria-hidden="true"
            >
              {Array.from({ length: Math.min(previewLineCount, 80) }, (_, idx) => (
                <div key={idx} className="h-[20px] leading-[20px]">
                  {idx + 1}
                </div>
              ))}
              {previewLineCount > 80 && <div className="h-[20px] leading-[20px]">…</div>}
            </div>
            <div
              className="m-0 flex-1 min-w-max overflow-visible py-2.5 pl-3 pr-4 leading-[20px] whitespace-pre text-ink/85"
              dangerouslySetInnerHTML={{ __html: highlightedPreview }}
            />
          </div>
        </div>
      )}

      {/* Execution Result — excerpt rows bergutter per file, catatan sebagai markdown */}
      {sections.length > 0 && (
        <div className="space-y-2 rounded-lg border border-ink/8 bg-paper p-2.5 select-text">
          <div className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">
            <ArrowRight size={11} className="text-success" />
            <span>Execution Output</span>
          </div>
          {sections.map((section, index) => (
            <div key={index} className="space-y-2">
              {section.envelopes.length > 0 && <EnvelopeHeader envelopes={section.envelopes} />}
              {section.lines.length > 0 && (
                <ExcerptCode lines={section.lines} path={section.path || targetPath} tag={section.tag} />
              )}
              {section.notesMarkdown && (
                <MarkdownRenderer content={section.notesMarkdown} className="text-[11.5px] text-ink/85" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
