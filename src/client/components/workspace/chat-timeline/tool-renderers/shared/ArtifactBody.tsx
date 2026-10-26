/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The body of the "Full output" reader: one artifact's text through the
 * renderer its shape calls for.
 *
 * Every surface in the repo that shows tool output follows one rule — detect
 * the format, then render it with the surface that format needs
 * (`readToolOutput` → `FallbackOutput`, `Read`, `Eval`, `Edit`). This modal was
 * the one exception: it put the whole stream in a `<pre>`. That is wrong for
 * every shape omp actually spills — measured over one install's 1,684
 * artifacts: a JSON dump arrives unformatted, a numbered excerpt welds its
 * gutter onto the code, a markdown document shows its source, a diff reads as
 * prose.
 *
 * The renderers are the SAME ones the timeline panels use — `DiffView`,
 * `JsonCodeBlock`, `parseNumberedCode` (the `Read`/`edit` gutter),
 * `MarkdownRenderer` — so a spilled stream and the truncated body it was cut
 * from cannot render two different ways.
 *
 * Nothing here is bounded: the modal's body is the single scroller, and a
 * nested `max-h-72` box inside it would clip the very output the reader opened.
 * How much is MOUNTED still follows the shared policy (`truncateTailLines` +
 * `OutputWindow`) — the artifacts measured up to 13 MB, and mounting one is the
 * 34s blocked-main-thread shape the search panel already documented.
 */

import { useMemo } from 'preact/hooks';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { DiffView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/DiffView';
import { JsonCodeBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/JsonCodeBlock';
import { OutputWindow } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/OutputWindow';
import { NumberedCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/numbered-code';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { artifactViewKind } from '@/shared/lib/chat/tool/artifact-view';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { parseNumberedCode } from '@/shared/lib/code/parser';
import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';

interface ArtifactBodyProps {
  /** The whole artifact, verbatim. */
  text: string;
  /** File the artifact belongs to — selects the grammar for a code excerpt. */
  path?: string;
}

/** The artifact's text, rendered as whatever it is. */
export function ArtifactBody({ text, path = '' }: ArtifactBodyProps) {
  const kind = useMemo(() => artifactViewKind(text), [text]);

  // A diff and a JSON body have their own surfaces; everything else goes
  // through the shared line window.
  const windowed = useMemo(
    () => (kind === 'diff' || kind === 'json' ? '' : truncateTailLines(text, MAX_OUTPUT_LINES).text),
    [kind, text],
  );

  const json = useMemo(() => {
    if (kind !== 'json') return '';
    try {
      return JSON.stringify(JSON.parse(text.trim()), null, 2);
    } catch {
      return '';
    }
  }, [kind, text]);

  if (json) {
    return <JsonCodeBlock jsonString={json} title="Full output" maxHeightClass="max-h-none" />;
  }

  if (kind === 'diff') {
    return <DiffView text={text} path={path} maxHeightClass="max-h-none" />;
  }

  const code = kind === 'code';
  const markdown = kind === 'markdown';
  return (
    <OutputWindow
      lines={windowed.split('\n')}
      className="px-5 py-4"
      render={(visible) =>
        code ? (
          <ArtifactCode lines={visible} path={path} />
        ) : markdown ? (
          <MarkdownRenderer content={visible.join('\n')} className="text-[12px] text-ink/85" />
        ) : (
          <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink/85 select-text">
            {visible.join('\n')}
          </pre>
        )
      }
    />
  );
}

/**
 * A numbered excerpt, drawn the way the `read` panel draws one: the numbers omp
 * printed are a GUTTER, not content. `parseNumberedCode` is the same predicate
 * and parser that panel uses, so it accepts both of omp's spellings (`121:code`
 * and `121|code`) and a blank line keeps its place in the count.
 */
function ArtifactCode({ lines, path }: { lines: string[]; path: string }) {
  const parsed = useMemo(() => parseNumberedCode(lines.join('\n')), [lines]);
  const lang = getLanguageFromPath(path);
  const html = useDeferredHighlightLines(parsed.cleanCode, lang);
  const rendered = useMemo(
    () => parsed.lines.map((_line, index) => html[index] ?? ''),
    [parsed.lines, html],
  );

  return (
    <NumberedCode
      numbers={parsed.lines.map((line) => line.lineNum)}
      lines={rendered}
      className="select-text"
      gutterClassName="border-r border-ink/8 bg-canvas/90 py-2.5 pl-3 pr-2.5 text-ink/35"
      codeClassName="py-2.5 pl-3 pr-4 text-ink/85"
    />
  );
}
