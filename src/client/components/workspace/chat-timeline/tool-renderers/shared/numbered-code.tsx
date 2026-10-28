/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A numbered code block: a gutter of line numbers beside the code they belong
 * to, both drawn from ONE line box.
 *
 * Six panels used to state that box themselves — `Read`, `Edit`'s write
 * preview, `ExcerptCode`, `Eval` (twice), `JsonCodeBlock` and `ArtifactBody` —
 * and three of them had drifted. Measured in the browser:
 *
 * - `JsonCodeBlock` was the worst: the gutter was `text-[10px]` and the code
 *   `text-[11px]`, both under an inherited `leading-relaxed` — a RATIO, so the
 *   row boxes were 16.25px against 17.875px and every number sat 1.63px higher
 *   than its line. By line 20 the number was **30.9px** above the code it
 *   labels. It backs the Bash console output, the `eval` result, the card's
 *   input JSON, `task` results and the full-output reader, so the defect was
 *   visible almost everywhere.
 * - `ExcerptCode` set the gutter to `text-[10.5px]` under the same 20px box,
 *   which is a constant −1px: half-leading is `(box − font) / 2`, so a smaller
 *   face sits higher even when the box matches.
 * - `Edit`'s write preview rendered an extra gutter row for its `…` marker, so
 *   the number column ran one line past the code.
 *
 * So the two rules live HERE, once, and are unrepresentable at a call site:
 *
 * 1. **The box is an explicit px pair applied to both columns as inline
 *    style** — never a ratio class, and never a Tailwind arbitrary value that a
 *    build could drop.
 * 2. **Both columns carry the same font size.** A gutter is differentiated by
 *    colour and weight, never by size: `(lineHeight − fontSize) / 2` is the
 *    half-leading, so two sizes under one box cannot both be centred.
 *
 * Rows are one element per line on BOTH sides, so the counts cannot disagree
 * either — a single `<pre>` with `<br>` separators and a row-per-number gutter
 * is a pair that only agrees by coincidence (a trailing `<br>`, an empty last
 * line, and a highlight that dropped a fragment all move one side and not the
 * other).
 */

interface NumberedCodeProps {
  /** One entry per rendered line: the number shown, or `''` for a blank row. */
  numbers: Array<string | number>;
  /** One highlighted HTML fragment per line, aligned 1:1 with `numbers`. */
  lines: string[];
  /** Line box in px. The whole point of this component — see the header. */
  lineHeight?: number;
  /** Font size in px, applied to both columns. */
  fontSize?: number;
  /** The scroll box: height ceiling, border, rounding, background. */
  className?: string;
  /** Padding and tone for the number column. */
  gutterClassName?: string;
  /** Padding for the code column. */
  codeClassName?: string;
}

/** A numbered code block with a gutter that cannot drift from its code. */
export function NumberedCode({
  numbers,
  lines,
  lineHeight = 20,
  fontSize = 11,
  className = '',
  gutterClassName = '',
  codeClassName = '',
}: NumberedCodeProps) {
  const box = {
    height: `${lineHeight}px`,
    lineHeight: `${lineHeight}px`,
    fontSize: `${fontSize}px`,
    // Numbers must stay in a fixed-width cell WITHOUT claiming the family: the
    // `.tabular-nums` class also sets `font-family: 'Fira Code'` (see
    // `tailwind.css`), which beat the code column's own utility and put the two
    // sides in different faces — a measured 1px ink offset on every row. The
    // feature is set inline so the family is inherited identically by both.
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div className={`flex items-start font-mono ${className}`}>
      <div
        className={`sticky left-0 z-10 flex-shrink-0 select-none text-right ${gutterClassName}`}
        aria-hidden="true"
      >
        {numbers.map((number, index) => (
          <div key={index} style={box} className="whitespace-pre">
            {number}
          </div>
        ))}
      </div>
      <div className={`shiki min-w-max flex-1 whitespace-pre ${codeClassName}`}>
        {lines.map((html, index) => (
          <div key={index} style={box} dangerouslySetInnerHTML={{ __html: html || '' }} />
        ))}
      </div>
    </div>
  );
}
