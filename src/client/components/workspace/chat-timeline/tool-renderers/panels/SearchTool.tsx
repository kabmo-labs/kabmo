import { useMemo, useState } from 'preact/hooks';
import { FileSearch, FolderSearch } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { CopyButton } from '@/client/components/common/CopyButton';
import { FileMatches } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/FileMatches';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';

interface MatchLine {
  lineNum: number;
  text: string;
  isMatch: boolean;
}

interface ParsedFileMatches {
  path: string;
  lines: MatchLine[];
  matchCount: number;
}

function queryOf(tool: ToolCallData): string {
  const input = tool.input;
  if (input && typeof input === 'object') {
    if (typeof input.pattern === 'string') return input.pattern;
    if (typeof input.path === 'string') return input.path;
    if (typeof input.glob === 'string') return input.glob;
    if (typeof input.query === 'string') return input.query;
    if (typeof input.regex === 'string') return input.regex;
    if (typeof input.search === 'string') return input.search;
    if (typeof input.text === 'string') return input.text;
  }
  if (typeof tool.target === 'string' && tool.target !== '.') return tool.target;
  return '';
}

/** Parses markdown hierarchical output or standard ripgrep/grep tool output */
function parseGrepOutput(output: string): { files: ParsedFileMatches[]; totalMatches: number; isGlobList: boolean } {
  const lines = output.split(/\r?\n/);
  const files: ParsedFileMatches[] = [];
  const dirStack: string[] = [];
  let currentFile: ParsedFileMatches | null = null;
  let isGlobList = true;

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();
    if (!trimmed) continue;

    // Filter out pagination/limit notices (e.g. "[20 results limit reached...]", "Showing files 1-20 of 41...")
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      /^Showing files \d+/i.test(trimmed) ||
      /^Found \d+ matches/i.test(trimmed)
    ) {
      continue;
    }

    // 1. Detect standard ripgrep format: "path/to/file.tsx:18:code" or "path/to/file.tsx:18:5:code"
    const standardRgMatch = trimmed.match(/^([^:\n]+(?:\.[a-zA-Z0-9_-]+|\/[^:\n]+)):(\d+)(?::\d+)?:(.*)$/);
    if (standardRgMatch) {
      isGlobList = false;
      const filePath = standardRgMatch[1].trim();
      const lineNum = parseInt(standardRgMatch[2], 10) || 1;
      const text = standardRgMatch[3];

      let targetFile = files.find((f) => f.path === filePath);
      if (!targetFile) {
        if (currentFile && currentFile.lines.length > 0 && !files.includes(currentFile)) {
          files.push(currentFile);
        }
        targetFile = { path: filePath, lines: [], matchCount: 0 };
        files.push(targetFile);
        currentFile = targetFile;
      }
      targetFile.lines.push({ lineNum, text, isMatch: true });
      targetFile.matchCount++;
      continue;
    }

    // 1b. Detect standard ripgrep context line: "path/to/file.tsx-17-code"
    const standardRgCtx = trimmed.match(/^([^:\n]+(?:\.[a-zA-Z0-9_-]+|\/[^:\n]+))-(\d+)-(.*)$/);
    if (standardRgCtx) {
      isGlobList = false;
      const filePath = standardRgCtx[1].trim();
      const lineNum = parseInt(standardRgCtx[2], 10) || 1;
      const text = standardRgCtx[3];

      let targetFile = files.find((f) => f.path === filePath);
      if (!targetFile) {
        if (currentFile && currentFile.lines.length > 0 && !files.includes(currentFile)) {
          files.push(currentFile);
        }
        targetFile = { path: filePath, lines: [], matchCount: 0 };
        files.push(targetFile);
        currentFile = targetFile;
      }
      targetFile.lines.push({ lineNum, text, isMatch: false });
      continue;
    }

    // 2. Detect heading lines like "# app/", "## components/", "#### File.tsx"
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const name = headingMatch[2].trim();

      // Adjust directory stack based on heading depth
      dirStack.length = Math.min(dirStack.length, level - 1);

      if (name.endsWith('/')) {
        dirStack[level - 1] = name;
      } else {
        // File heading
        if (currentFile && currentFile.lines.length > 0 && !files.includes(currentFile)) {
          files.push(currentFile);
        }
        const fullDir = dirStack.filter(Boolean).join('');
        const fullPath = fullDir ? `${fullDir.replace(/\/+$/, '')}/${name}` : name;
        currentFile = { path: fullPath, lines: [], matchCount: 0 };
      }
      continue;
    }

    // 3. Match code line format: " 18|..." or "*19|..." or "18:..." or "18│..." (unicode \u2502)
    const codeMatch = trimmed.match(/^(\*?)(\s*\d+)[|:\u2502](.*)$/);
    if (codeMatch) {
      isGlobList = false;
      const isMatch = codeMatch[1] === '*';
      const lineNum = parseInt(codeMatch[2].trim(), 10) || 1;
      const text = codeMatch[3];

      if (!currentFile) {
        currentFile = { path: 'Results', lines: [], matchCount: 0 };
        files.push(currentFile);
      }

      currentFile.lines.push({ lineNum, text, isMatch });
      if (isMatch) currentFile.matchCount++;
      continue;
    }

    // 4. Handle plain file list output (glob format)
    if (!trimmed.startsWith('#') && !codeMatch) {
      if (trimmed.includes('|') || trimmed.includes(':') || trimmed.includes('\u2502')) {
        isGlobList = false;
      }
      const fullDir = dirStack.filter(Boolean).join('');
      const fullPath = fullDir ? `${fullDir.replace(/\/+$/, '')}/${trimmed}` : trimmed;
      files.push({
        path: fullPath,
        lines: [],
        matchCount: 1,
      });
    }
  }

  if (currentFile && currentFile.lines.length > 0 && !files.includes(currentFile)) {
    files.push(currentFile);
  }

  const totalMatches = files.reduce((acc, f) => acc + (f.matchCount || f.lines.length || 1), 0);
  return { files, totalMatches, isGlobList };
}

/** Panel untuk tool pencarian file — grep/glob/ast_grep dengan visualisasi hierarkis & readable. */
export function SearchTool({ tool }: { tool: ToolCallData }) {
  const [filterText, setFilterText] = useState('');
  const details = (tool.details ?? {}) as Record<string, any>;
  const output = tool.output || (typeof details.displayContent === 'string' ? details.displayContent : '');
  const query = queryOf(tool);
  const isGlob = tool.type === 'glob' || tool.name === 'glob';

  const display = useMemo(() => truncateTailLines(output, MAX_OUTPUT_LINES), [output]);
  const { files, totalMatches, isGlobList } = useMemo(() => parseGrepOutput(display.text), [display.text]);

  const filteredFiles = useMemo(() => {
    if (!filterText) return files;
    const lower = filterText.toLowerCase();
    return files
      .map((file) => {
        const pathMatches = file.path.toLowerCase().includes(lower);
        const matchingLines = file.lines.filter((l) => l.text.toLowerCase().includes(lower));
        if (pathMatches) return file;
        if (matchingLines.length > 0) {
          return { ...file, lines: matchingLines };
        }
        return null;
      })
      .filter((f): f is ParsedFileMatches => f !== null);
  }, [files, filterText]);

  if (!output && files.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2.5 text-[11.5px] text-ink/45">
        {isGlob ? <FolderSearch size={13} className="shrink-0" /> : <FileSearch size={13} className="shrink-0" />}
        <span>No {isGlob ? 'files' : 'matches'} found{query ? ` for "${query}"` : ''}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/8 bg-paper px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-ink/5 text-ink/60">
            {isGlob || isGlobList ? <FolderSearch size={12} /> : <FileSearch size={12} />}
          </span>
          <span className="font-semibold text-ink">
            {isGlob || isGlobList ? 'Files Found' : 'Search Matches'}
          </span>
          <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[10px] text-ink/60">
            {totalMatches} {totalMatches === 1 ? 'match' : 'matches'}
          </span>
          {files.length > 1 && (
            <span className="font-mono text-[10px] text-ink/40">
              in {files.length} {files.length === 1 ? 'file' : 'files'}
            </span>
          )}
          {query && (
            <span className="rounded border border-ink/10 bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink/75">
              "{query}"
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {files.length > 4 && (
            <input
              type="text"
              placeholder="Filter paths..."
              value={filterText}
              onChange={(e) => setFilterText(e.currentTarget.value)}
              className="h-6 w-28 rounded border border-ink/10 bg-canvas px-2 text-[10.5px] text-ink placeholder:text-ink/30 focus:border-ink/30 focus:outline-none"
            />
          )}
          <CopyButton
            text={output}
            className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            label="Copy"
          />
        </div>
      </div>

      {/* Results Container */}
      {display.skipped > 0 && (
        <div className="rounded-lg border border-dashed border-ink/15 bg-canvas/50 px-3 py-1.5 font-mono text-[10.5px] text-ink/55">
          … {display.skipped} earlier lines hidden
        </div>
      )}
      <div className="max-h-80 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
        {filteredFiles.map((file, fileIdx) => (
          <FileMatches
            key={fileIdx}
            path={file.path}
            lines={file.lines}
            matchCount={file.matchCount}
            isGlobList={isGlobList}
          />
        ))}

        {filteredFiles.length === 0 && (
          <div className="rounded-lg border border-dashed border-ink/15 p-4 text-center font-mono text-[11px] text-ink/40">
            No results match filter "{filterText}"
          </div>
        )}
      </div>
    </div>
  );
}
