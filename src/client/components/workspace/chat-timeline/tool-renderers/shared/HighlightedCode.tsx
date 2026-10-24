/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A `<pre>` whose contents are tokenized off the render that asked for them.
 *
 * A hook cannot be called inside a `render` callback (Bash's `OutputWindow` and
 * SearchTool's per-file rows both draw code from one), so the deferred highlight
 * lives in this component instead: a caller hands over the code and the
 * language, and the markup arrives one idle slice later.
 *
 * The `shiki` class is on the `<pre>` from the first paint, so the plain-text
 * frame and the tokenized one are the same element — the swap changes colour
 * and nothing else.
 */

import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';

interface HighlightedCodeProps {
  code: string;
  language: string;
  className?: string;
}

export function HighlightedCode({ code, language, className = '' }: HighlightedCodeProps) {
  const lines = useDeferredHighlightLines(code, language);
  return (
    <pre
      className={`shiki ${className}`}
      dangerouslySetInnerHTML={{ __html: lines.join('\n') }}
    />
  );
}
