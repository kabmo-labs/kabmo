import { useEffect, useMemo, useState } from 'preact/hooks';
import { FileCode, FileImage, FileText, Folder, FolderOpen, Info, Loader2 } from 'lucide-preact';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { highlightCode } from '@/shared/lib/code/syntax-highlight';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';
import { parseDirListing, parseNumberedCode } from '@/shared/lib/code/parser';
import { getImageMimeType } from '@/shared/lib/fs/file-kind';
import { buildFsRawUrl, isVirtualPath } from '@/shared/lib/fs/paths';
import { toolImageSrc } from '@/shared/lib/omp/session/tool-images';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import type { ToolCallData } from '@/shared/types/chat';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { extractLineMeta } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/read-line-meta';
import { ToolPanelHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolPanelHeader';
import { getToolInputPath } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';

interface ReadPanelProps {
  tool?: ToolCallData;
  targetFilePath?: string;
  output: string;
}

/** File & Directory content viewer untuk tool `read` / `view_file` / `read_file`. */
export function Read({ tool, targetFilePath, output }: ReadPanelProps) {
  const [lazyContent, setLazyContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const inputPath = getToolInputPath(tool?.input);
  const filePath = targetFilePath || inputPath || tool?.target || '';
  const cleanFetchPath = filePath.split('?')[0].split('#')[0].replace(/:\d+(?:-\d+)?$/, '');
  // A `proc://`/`xd://` path names no file: pointing `/api/fs/read` at it made
  // the route refuse and the panel print `// Loaded file: proc://…` as if that
  // were the file's contents.
  const virtualPath = isVirtualPath(cleanFetchPath);

  // A `read` of an image answers with the picture itself, so the panel paints
  // the result's own bytes. Reconstructing the image from the tool call's PATH
  // was the previous behaviour and it only worked for a file inside the browse
  // scope: `read` routinely names an absolute path outside it (`/tmp/x.png`),
  // `/api/fs/raw` refused it, and the panel drew a broken image while the bytes
  // sat in the result. The path is now the FALLBACK, for a result that carries
  // no image at all.
  const resultImage = useMemo(() => {
    for (const image of tool?.images ?? []) {
      const src = toolImageSrc(image);
      if (src) return { src, name: cleanFetchPath || 'Image' };
    }
    return null;
  }, [tool?.images, cleanFetchPath]);

  // The path fallback is only for a call that SUCCEEDED and still reported no
  // image: a `read` that failed ("Path '/tmp/x.png' not found") names a picture
  // that is not there, and pointing an <img> at it draws a broken thumbnail
  // over an output that is an error message. The failure renders as its own
  // text instead.
  const readFailed = tool?.status === 'error' || tool?.isError === true;
  const isPathImage = !resultImage && !readFailed && getImageMimeType(cleanFetchPath) !== null;
  const isImage = Boolean(resultImage) || isPathImage;
  const imageUrl = resultImage?.src ?? (isPathImage ? buildFsRawUrl({ path: cleanFetchPath }) : null);

  useEffect(() => {
    if (cleanFetchPath && !virtualPath && !isImage && !output && lazyContent === null && !loadingFile) {
      setLoadingFile(true);
      fetch(`/api/fs/read?path=${encodeURIComponent(cleanFetchPath)}`)
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { content?: unknown; error?: unknown } | null;
          // The route refuses a file it will not hand back as text — a binary
          // or an oversized one — with its own sentence. Reporting the refusal
          // is the point: `// Loaded file: <path>` used to be printed for those
          // exactly as it was for a virtual URL, describing a file whose
          // contents were never read.
          if (!res.ok || !data || typeof data.content !== 'string') {
            const reason = typeof data?.error === 'string' && data.error ? data.error : `HTTP ${res.status}`;
            setLazyContent(`// ${reason}`);
            return;
          }
          setLazyContent(data.content);
        })
        .catch(() => {
          setLazyContent(`// Could not read ${cleanFetchPath}`);
        })
        .finally(() => {
          setLoadingFile(false);
        });
    }
  }, [cleanFetchPath, virtualPath, output, lazyContent, loadingFile, isImage]);

  const details = (tool?.details ?? {}) as Record<string, any>;
  const rawContent =
    output ||
    (typeof details?.displayContent === 'object' && typeof details.displayContent?.text === 'string'
      ? details.displayContent.text
      : '') ||
    lazyContent ||
    '';
  const dirInfo = useMemo(() => parseDirListing(rawContent), [rawContent]);

  const lineMeta = useMemo(() => {
    return extractLineMeta(tool, filePath, rawContent);
  }, [tool, filePath, rawContent]);

  // Check for elision notices like "[…120ln elided; ...]" or "[Showing lines X-Y of Z...]"
  const { displayContent, elisionNotices } = useMemo(() => {
    if (dirInfo.isDirectory) return { displayContent: rawContent, elisionNotices: [] };
    const lines = rawContent.split(/\r?\n/);
    const notices: string[] = [];
    const codeLines: string[] = [];

    for (const l of lines) {
      const trimmed = l.trim();
      if (
        (trimmed.startsWith('[…') || trimmed.startsWith('[Showing lines ') || trimmed.startsWith('[1 results limit')) &&
        trimmed.endsWith(']')
      ) {
        notices.push(trimmed.slice(1, -1));
      } else {
        codeLines.push(l);
      }
    }

    // If no text notice was found but details.summary reports elidedLines, provide it
    if (
      notices.length === 0 &&
      details.summary &&
      typeof details.summary.elidedLines === 'number' &&
      details.summary.elidedLines > 0
    ) {
      notices.push(
        `…${details.summary.elidedLines}ln elided (${details.summary.lines ?? codeLines.length} lines shown)`
      );
    }

    // Trim trailing empty line if it was spacing before the elision notice and lineNumbers is shorter
    if (
      lineMeta.lineNumbers &&
      codeLines.length > lineMeta.lineNumbers.length &&
      codeLines[codeLines.length - 1].trim() === ''
    ) {
      codeLines.pop();
    }

    return { displayContent: codeLines.join('\n'), elisionNotices: notices };
  }, [rawContent, dirInfo.isDirectory, lineMeta.lineNumbers, details.summary]);

  const parsedCode = useMemo(() => {
    if (dirInfo.isDirectory || !displayContent) {
      return { lines: [], cleanCode: '', hasLineNumbers: false };
    }
    return parseNumberedCode(displayContent, lineMeta);
  }, [displayContent, dirInfo.isDirectory, lineMeta]);

  const isDir = dirInfo.isDirectory;
  const lang = getLanguageFromPath(filePath);
  // omp answers a `text/markdown` read with prose and draws it as prose
  // (`details.contentType === 'text/markdown' ? md(text) : code`). The panel had
  // no markdown branch, so `read skill://diagnose` rendered `# Diagnose ## Steps
  // 1. Reproduce` as one code block — the whole point of the file (its headings,
  // lists and links) came out as literal syntax.
  const isMarkdown = details.contentType === 'text/markdown' && !isDir && !isImage;
  const kindLabel = isDir ? 'Directory' : isImage ? 'Image' : isMarkdown ? 'Markdown' : lang;

  const visibleEntries = dirInfo.entries.slice(-MAX_OUTPUT_LINES);
  const skippedEntries = dirInfo.entries.length - visibleEntries.length;

  const truncatedCode = useMemo(() => truncateTailLines(parsedCode.cleanCode, MAX_OUTPUT_LINES), [parsedCode.cleanCode]);
  const visibleLines = truncatedCode.skipped > 0 ? parsedCode.lines.slice(truncatedCode.skipped) : parsedCode.lines;

  const syntaxReady = useSyntaxReady();
  const highlightedCode = useMemo(() => {
    if (!truncatedCode.text) return '';
    return highlightCode(truncatedCode.text, lang);
  }, [truncatedCode, lang, syntaxReady]);

  return (
    <div className="space-y-2">
      {/* Header Info */}
      <ToolPanelHeader
        icon={isDir ? <FolderOpen size={12} /> : isImage ? <FileImage size={12} /> : <FileCode size={12} />}
        label={filePath || resultImage?.name || (isDir ? 'Directory Listing' : 'File Content')}
        badge={kindLabel}
        copyText={rawContent && !isImage ? (parsedCode.hasLineNumbers ? parsedCode.cleanCode : rawContent) : undefined}
        copyLabel="Copy file content"
      />

      {isImage && imageUrl ? (
        /* An image read has no code to show: paint the bytes. */
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="flex max-h-80 items-center justify-center overflow-auto bg-canvas/60 p-3">
            <img
              src={imageUrl}
              alt={resultImage?.name ?? cleanFetchPath ?? 'Image'}
              title={resultImage?.name ?? cleanFetchPath}
              className="max-h-72 max-w-full object-contain"
            />
          </div>
        </div>
      ) : loadingFile ? (
        <div className="flex items-center gap-2 rounded-lg border border-ink/8 bg-paper px-3 py-3 font-mono text-[11px] text-ink/50">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading file content...</span>
        </div>
      ) : isDir ? (
        /* Render Directory Listing */
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          {skippedEntries > 0 && (
            <div className="flex items-center gap-1.5 border-b border-ink/8 bg-canvas/60 px-3 py-1.5 text-[10px] text-ink/50">
              <Info size={11} className="shrink-0" />
              <span>… {skippedEntries} earlier entries hidden</span>
            </div>
          )}
          <div className="max-h-72 divide-y divide-ink/[0.04] overflow-y-auto font-mono text-[11px]">
            {visibleEntries.map((entry, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-ink/[0.02]"
                style={{ paddingLeft: `${Math.max(12, (entry.indent + 1) * 16)}px` }}
              >
                {entry.isDir ? (
                  <Folder size={12} className="shrink-0 text-ink/60" />
                ) : (
                  <FileText size={12} className="shrink-0 text-ink/40" />
                )}
                <span
                  className={`min-w-0 flex-1 truncate ${
                    entry.isDir ? 'font-semibold text-ink' : 'text-ink/80'
                  }`}
                >
                  {entry.name}
                  {entry.isDir && '/'}
                </span>
                {entry.size && <span className="shrink-0 font-mono text-[9.5px] text-ink/40">{entry.size}</span>}
                {entry.time && (
                  <span className="shrink-0 rounded bg-ink/5 px-1 py-0.2 font-mono text-[9px] text-ink/45">
                    {entry.time}
                  </span>
                )}
              </div>
            ))}
          </div>
          {dirInfo.notice && (
            <div className="flex items-center gap-1.5 border-t border-ink/8 bg-canvas/60 px-3 py-1.5 text-[10px] text-ink/50">
              <Info size={11} className="shrink-0" />
              <span>{dirInfo.notice}</span>
            </div>
          )}
        </div>
      ) : isMarkdown ? (
        /* omp draws a `text/markdown` read as the document it is: headings,
           lists, links and code fences, not a code block of markdown syntax.
           The source is `parsedCode.cleanCode`, not `rawContent`: omp prefixes
           every row with its file line number (`1|# Diagnose`), and a markdown
           parser reads that prefix as content — the heading came out as the
           paragraph `1|# Diagnose`. */
        <div className="max-h-80 overflow-auto rounded-lg border border-ink/8 bg-paper px-3.5 py-3 select-text">
          <MarkdownRenderer content={parsedCode.cleanCode || displayContent} className="text-[12.5px] text-ink/85" />
        </div>
      ) : rawContent ? (
        /* Render Code Content with synchronized, straight line numbers and clean code */
        <div className="space-y-1.5">
          {truncatedCode.skipped > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 bg-canvas/50 px-3 py-1.5 font-mono text-[10.5px] text-ink/55">
              <Info size={12} className="shrink-0 text-ink/40" />
              <span>… {truncatedCode.skipped} earlier lines hidden</span>
            </div>
          )}
          <div className="relative flex max-h-80 items-start overflow-auto rounded-lg border border-ink/8 bg-paper font-mono text-[11px] leading-[20px] select-text overscroll-contain">
            {/* Gutter: Line numbers */}
            <div
              className="sticky left-0 z-10 flex-shrink-0 select-none border-r border-ink/8 bg-canvas/90 py-2.5 pl-3 pr-2.5 text-right font-mono text-[11px] leading-[20px] tabular-nums text-ink/35 backdrop-blur-xs"
              aria-hidden="true"
            >
              {visibleLines.map((line, idx) => (
                <div key={idx} className="h-[20px] leading-[20px]">
                  {line.lineNum}
                </div>
              ))}
            </div>

            {/* Code Body */}
            <pre
              className="m-0 flex-1 min-w-max overflow-visible py-2.5 pl-3 pr-4 font-mono text-[11px] leading-[20px] whitespace-pre text-ink/85 focus:outline-none"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </div>

          {/* Elision information banner */}
          {elisionNotices.map((notice, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 bg-canvas/50 px-3 py-1.5 font-mono text-[10.5px] text-ink/55"
            >
              <Info size={12} className="shrink-0 text-ink/40" />
              <span>{notice}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-ink/15 px-3 py-3 font-mono text-[11px] text-ink/45">
          File is ready for inspection.
        </div>
      )}
    </div>
  );
}
