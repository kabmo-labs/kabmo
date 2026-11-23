import { useEffect, useMemo, useState } from 'preact/hooks';
import { FileCode, FileImage, FolderOpen, Info, Loader2 } from 'lucide-preact';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';
import { parseDirListing, parseNumberedCode } from '@/shared/lib/code/parser';
import { getPaintableImageMimeType, SVG_MIME } from '@/shared/lib/fs/mime';
import { buildFsRawUrl, isVirtualPath, stripReadSelector } from '@/shared/lib/fs/paths';
import { toolImageSrc } from '@/shared/lib/omp/session/tool-images';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { xmlSectionsToHeadings } from '@/shared/lib/markdown/xml-sections';
import type { ToolCallData } from '@/shared/types/chat';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { extractLineMeta } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/read-line-meta';
import { ToolPanelHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolPanelHeader';
import { NumberedCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/numbered-code';
import { getToolInputPath } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';
import { ReadImage } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/ReadImage';
import { ReadDirectory } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/ReadDirectory';
import { isXdDocRead } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

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
  const cleanFetchPath = stripReadSelector(filePath);
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
  const pathImageMime = getPaintableImageMimeType(cleanFetchPath);
  const isPathImage = !resultImage && !readFailed && pathImageMime !== null;
  const isImage = Boolean(resultImage) || isPathImage;
  const imageUrl = resultImage?.src ?? (isPathImage ? buildFsRawUrl({ path: cleanFetchPath }) : null);
  /**
   * An SVG read is the one picture the panel ALSO has text for: omp hands an
   * `<svg>` back as source (it has no magic bytes, so the reader treats it as
   * XML), and the file itself is a picture. So the preview is ADDED above the
   * source instead of replacing it — the reader gets the rendering, and the
   * markup the tool actually returned stays readable and copyable.
   */
  const svgPreviewUrl = isPathImage && pathImageMime === SVG_MIME ? imageUrl : null;

  /**
   * True when the card draws a picture and nothing else: a raster image (from
   * the result's bytes or the path fallback) with no source text to show. An
   * SVG is the exception — its preview sits above the markup — so the lazy text
   * read still runs for it.
   */
  const isPictureOnly = isImage && !svgPreviewUrl;

  useEffect(() => {
    if (cleanFetchPath && !virtualPath && !isPictureOnly && !output && lazyContent === null && !loadingFile) {
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
  }, [cleanFetchPath, virtualPath, output, lazyContent, loadingFile, isPictureOnly]);

  const details = (tool?.details ?? {}) as Record<string, any>;
  /** omp's own display text: the rows it drew, WITHOUT the `1|` line-number
   *  gutter its raw output carries. omp's own reader prefers it the same way
   *  (`details?.displayContent?.text ?? stripOutputNotice(rawText)`), and it is
   *  what a markdown read must parse — the gutter stripper needs TWO numbered
   *  rows to recognise the format, so a one-row document (`read xd://propose`)
   *  kept its `1|` prefix and rendered as the paragraph `1|Write your plan…`. */
  const displayText =
    typeof details?.displayContent === 'object' && typeof details.displayContent?.text === 'string'
      ? details.displayContent.text
      : '';
  const rawContent = output || displayText || lazyContent || '';
  /**
   * A `read` that answers with a DOCUMENT, and therefore renders as prose.
   *
   * omp tags a file read `text/markdown`, and it answers a `read xd://…` — the
   * device's documentation: `# <name> — <label>`, `## Schema`, a ```ts fence —
   * the same way except for the content type, which its `XdProtocolHandler`
   * hardcodes to `text/plain`. The payload is markdown in both cases, so both
   * take the markdown branch; only the content type has to be widened.
   *
   * A FAILED read is excluded: `read xd://nope` answers "No such tool: …",
   * which is a message rather than a document and belongs in the code surface
   * the failure already rendered in.
   */
  const isDocRead =
    !readFailed && (details.contentType === 'text/markdown' || (tool ? isXdDocRead(tool) : false));
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
  // lists and links) came out as literal syntax. `isDocRead` widens that to the
  // `xd://` device docs, whose payload is the same markdown behind a
  // `text/plain` content type.
  const isMarkdown = isDocRead && !isDir;
  const kindLabel = isDir
    ? 'Directory'
    : svgPreviewUrl
      ? 'SVG'
      : isImage
        ? 'Image'
        : isMarkdown
          ? 'Markdown'
          : lang;
  /** The document a markdown read draws — and what Copy copies. omp's own
   *  `displayContent.text` first: it is the gutter-free text, and the gutter
   *  stripper that serves every other read keeps a one-row document's `1|`
   *  prefix (it needs two numbered rows to recognise the format). */
  const markdownContent = displayText || parsedCode.cleanCode || displayContent;
  /** An omp doc marks some sections with XML wrappers (`<instruction>…`), and
   *  prose escapes its own HTML: parse them as headings. Copy keeps the file. */
  const markdownSource = useMemo(() => xmlSectionsToHeadings(markdownContent), [markdownContent]);

  const visibleEntries = dirInfo.entries.slice(-MAX_OUTPUT_LINES);
  const skippedEntries = dirInfo.entries.length - visibleEntries.length;

  const truncatedCode = useMemo(() => truncateTailLines(parsedCode.cleanCode, MAX_OUTPUT_LINES), [parsedCode.cleanCode]);
  const visibleLines = truncatedCode.skipped > 0 ? parsedCode.lines.slice(truncatedCode.skipped) : parsedCode.lines;

  // The tokenizer runs off the render that a tap scheduled (see
  // `deferred-highlight`): a 1000-line read measured a 220–300 ms long task on
  // a throttled phone, all of it before the card could paint. The plain-text
  // frame it draws first carries the same characters, and a block already in
  // the memo renders highlighted on that first paint.
  //
  // Per LINE, not one block: the gutter is one element per line, so the code
  // has to be too. A single `<pre>` with `<br>` separators cannot be counted
  // against the numbers — a trailing separator or an empty last line moves the
  // text and leaves the numbers behind.
  const highlightedLines = useDeferredHighlightLines(
    visibleLines.map((line) => line.code).join('\n'),
    lang,
  );

  return (
    <div className="space-y-2">
      {/* Header Info */}
      <ToolPanelHeader
        icon={isDir ? <FolderOpen size={12} /> : isImage || svgPreviewUrl ? <FileImage size={12} /> : <FileCode size={12} />}
        label={filePath || resultImage?.name || (isDir ? 'Directory Listing' : 'File Content')}
        badge={kindLabel}
        copyText={
          rawContent && !isPictureOnly
            ? isMarkdown
              ? markdownContent
              : parsedCode.hasLineNumbers
                ? parsedCode.cleanCode
                : rawContent
            : undefined
        }
        copyLabel="Copy file content"
      />

      {/* An SVG is a picture AND text: omp returns the markup, and the file
          renders. The preview goes above the source the reader can still copy. */}
      {svgPreviewUrl && <ReadImage src={svgPreviewUrl} name={cleanFetchPath || 'Image'} />}

      {isPictureOnly && imageUrl ? (
        /* An image read has no code to show: paint the bytes, and open them at
           full size on click — the same surface the `eval` screenshots use. */
        <ReadImage src={imageUrl} name={resultImage?.name ?? cleanFetchPath ?? 'Image'} />
      ) : loadingFile ? (
        <div className="flex items-center gap-2 rounded-lg border border-ink/8 bg-paper px-3 py-3 font-mono text-[11px] text-ink/50">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading file content...</span>
        </div>
      ) : isDir ? (
        /* Render Directory Listing */
        <ReadDirectory entries={visibleEntries} skipped={skippedEntries} notice={dirInfo.notice} />
      ) : isMarkdown ? (
        /* omp draws a `text/markdown` read (and an `xd://` doc read) as the
           document it is: headings, lists, links and code fences, not a code
           block of markdown syntax. The source is omp's own `displayContent.text`
           — the rows it drew — and never the raw output: omp prefixes every row
           there with its file line number (`1|# Diagnose`), which a markdown
           parser reads as content, turning the heading into the paragraph
           `1|# Diagnose`. The gutter stripper is the fallback because it needs
           two numbered rows to recognise the format, so a one-row document
           (`read xd://propose`) kept its prefix through it. */
        <div className="max-h-80 overflow-auto rounded-lg border border-ink/8 bg-paper px-3.5 py-3 select-text">
          <MarkdownRenderer content={markdownSource} className="text-[12.5px] text-ink/85" />
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
          {/* The gutter and the code are ONE component (`NumberedCode`) because
              they were two columns that had to agree about a line box, and
              every panel that stated that box itself drifted: the code was a
              single `<pre>` with `<br>` separators, so a trailing separator or
              an empty last line moved the text and left the numbers behind. */}
          <NumberedCode
            numbers={visibleLines.map((line) => line.lineNum)}
            lines={highlightedLines}
            className="relative max-h-80 overflow-auto rounded-lg border border-ink/8 bg-paper select-text overscroll-contain"
            gutterClassName="border-r border-ink/8 bg-canvas/90 py-2.5 pl-3 pr-2.5 text-ink/35 backdrop-blur-xs"
            codeClassName="py-2.5 pl-3 pr-4 text-ink/85"
          />

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
