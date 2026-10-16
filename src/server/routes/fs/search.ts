import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, resolveRoot } from '@/server/lib/fs/root';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';
import { runRipgrep } from '@/server/lib/fs/ripgrep';
import { createSseStream } from '@/server/lib/sse';
import { MAX_SEARCH_RESULTS } from '@/shared/lib/fs/search-list';

export interface SearchMatch {
  file: string;
  line: string;
  content: string;
  /** Character ranges within `content` the query matched, in document order. */
  ranges: { start: number; end: number }[];
}

interface RgSubmatch {
  start?: number;
  end?: number;
}

interface RgMatchFrame {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    /** Byte offsets within `lines.text`, one entry per occurrence on the line. */
    submatches?: RgSubmatch[];
  };
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/**
 * The line as every consumer displays it, with the match ranges shifted onto
 * it — `content` has its surrounding whitespace and line terminator dropped, so
 * `ranges` are character offsets into exactly the string that travels beside
 * them. Trimming on the CLIENT instead would misplace every highlight by the
 * width of the indentation, since the ranges would still be offsets into the
 * untrimmed line.
 *
 * Ripgrep's own offsets are BYTES in the raw line, and bytes are only
 * characters when it is pure ASCII: decoding the prefix is what keeps a line
 * with one accented character from shifting every range after it by one. A
 * range that no longer fits the trimmed text (a whitespace-only match) is
 * dropped — there is nothing left on screen to paint.
 */
function trimWithRanges(raw: string, submatches: RgSubmatch[] | undefined): { content: string; ranges: { start: number; end: number }[] } {
  const content = raw.trim();
  const lead = raw.length - raw.trimStart().length;
  if (!submatches || submatches.length === 0) return { content, ranges: [] };
  const bytes = UTF8_ENCODER.encode(raw);
  const ranges: { start: number; end: number }[] = [];
  for (const submatch of submatches) {
    const start = submatch.start;
    const end = submatch.end;
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) continue;
    const from = UTF8_DECODER.decode(bytes.slice(0, start)).length - lead;
    const to = from + UTF8_DECODER.decode(bytes.slice(start, end)).length;
    if (from < 0 || to > content.length || to <= from) continue;
    ranges.push({ start: from, end: to });
  }
  return { content, ranges };
}

/**
 * Builds the rg argument vector from the search form fields. Flag semantics
 * match the previous `grep -r` call: literal search by default, `-e` opts into
 * regex, `-w` whole word, `-i` case-insensitive.
 *
 * The pattern travels as `--regexp=<q>`, never as the bare positional. rg's
 * positional parser reads a token starting with `-` as a FLAG, so the queries a
 * developer most often searches for by hand were the ones that broke, and they
 * broke silently: `-webkit-transform` was taken as flags `-w`/`-e`/`-b`… with
 * `bkit-transform` left as the pattern (exit 1, "No results found"), `--help`
 * printed rg's help to stdout (exit 0, no match frames), and `->` exited 2 with
 * "unrecognized flag". Attaching the value to the flag removes the positional
 * slot entirely, so no query can be mistaken for an option. `-F` keeps literal
 * mode; `--regexp` is rg's long spelling of `-e`, so regex mode is unchanged.
 */
export function buildArgs(q: string, matchCase: boolean, wholeWord: boolean, useRegex: boolean, includeFiles: string): string[] {
  const args: string[] = ['--json', '--glob', '!node_modules/**', '--glob', '!.git/**', '--glob', '!dist/**'];
  if (!matchCase) args.push('-i');
  if (wholeWord) args.push('-w');
  if (!useRegex) args.push('-F');
  if (includeFiles) {
    includeFiles.split(',').map(p => p.trim()).filter(Boolean).forEach(p => args.push('--glob', p));
  }
  args.push(`--regexp=${q}`, '.');
  return args;
}

/**
 * Parses one rg `--json` line into a match; null for begin/end/summary frames.
 *
 * Exported because the byte→character range conversion is the part of this
 * route a client depends on for its highlights, and it is not observable
 * through a live ripgrep run without a fixture directory per encoding case.
 */
export function parseRgLine(line: string): SearchMatch | null {
  if (!line.startsWith('{')) return null;
  try {
    const frame = JSON.parse(line) as RgMatchFrame;
    if (frame.type !== 'match') return null;
    const data = frame.data;
    const file = data?.path?.text;
    const text = data?.lines?.text;
    if (!file || text === undefined || data?.line_number === undefined) return null;
    const { content, ranges } = trimWithRanges(text, data.submatches);
    return {
      file: file.replace(/^\.\//, ''),
      line: String(data.line_number),
      content,
      ranges,
    };
  } catch {
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const q = formData.get('q') as string;
  const matchCase = formData.get('matchCase') === 'true';
  const wholeWord = formData.get('wholeWord') === 'true';
  const useRegex = formData.get('useRegex') === 'true';
  const includeFiles = formData.get('includeFiles') as string;

  if (!q) {
    return json({ results: [] });
  }

  let targetDir: string;
  try {
    const baseDir = await resolveRoot(formData.get('root') as string, await getDefaultFsRoot(isMockMode()));
    targetDir = await scopeToRepo(baseDir, formData.get('repo') as string);
  } catch (error: unknown) {
    console.error(error);
    return json({ error: String(error) }, { status: 500 });
  }

  // SSE frame per flushed batch so the panel paints results while rg is still
  // walking the tree. `--json` output is line-delimited, so newline buffering
  // suffices to slice match frames.
  const stream = createSseStream({
    headers: { 'Cache-Control': 'no-cache, no-transform' },
    async onStart(handlers) {
      const send = (event: string, data: unknown) => handlers.send(event, data);

      const decoder = new TextDecoder();
      let pending = '';
      let count = 0;
      let stderrText = '';
      // The cap is the route's, so the panel and the server describe the same
      // limit; `truncated` is reported on `done` rather than as its own frame,
      // since it is a property of the run as a whole.
      let truncated = false;
      const cap = new AbortController();

      try {
        const code = await runRipgrep(buildArgs(q, matchCase, wholeWord, useRegex, includeFiles), targetDir, {
          signal: cap.signal,
          onStdout(chunk) {
            if (truncated) return;
            pending += decoder.decode(chunk, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            const batch: SearchMatch[] = [];
            for (const line of lines) {
              const match = parseRgLine(line);
              if (match) batch.push(match);
            }
            if (!batch.length) return;
            // One batch may cross the cap; the overflow is dropped rather than
            // overshooting it, so the number the notice prints is the number of
            // hits the panel holds.
            const room = MAX_SEARCH_RESULTS - count;
            const accepted = batch.length > room ? batch.slice(0, room) : batch;
            count += accepted.length;
            if (accepted.length) send('matches', accepted);
            if (accepted.length < batch.length) {
              truncated = true;
              cap.abort();
            }
          },
          onStderr(chunk) {
            stderrText += decoder.decode(chunk, { stream: true });
          },
        });
        // rg exit codes: 0 = matches, 1 = no matches, 2 = error (bad regex, IO failure).
        // A capped run was killed, so its signal code is not a failure.
        if (code === 2 && !truncated) send('error', { error: stderrText.trim() || 'ripgrep failed' });
      } catch (error: unknown) {
        send('error', { error: String(error) });
      }

      send('done', { count, truncated, limit: MAX_SEARCH_RESULTS });
      handlers.close();
    },
  });

  return stream.response;
}
