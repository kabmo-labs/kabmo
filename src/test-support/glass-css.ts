/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading the client's own CSS in a test.
 *
 * The glass contract is asserted against the stylesheets themselves — a token
 * declared in the wrong block is invisible to `getComputedStyle` in a way no
 * component test can see — so more than one spec needs to read a file and pull
 * one rule's body out of it. Both helpers live here rather than in each spec:
 * a second copy of `ruleBody`'s selector escaping is how one spec starts
 * matching a rule the other does not.
 */

const CLIENT_DIR = new URL('../client/', import.meta.url);

/** The text of a stylesheet under `src/client/`, e.g. `readClientCss('glass.css')`. */
export const readClientCss = (file: string): Promise<string> => Bun.file(new URL(file, CLIENT_DIR)).text();

/** The body of the first rule whose selector starts a line, e.g. `[x] {`. */
export function ruleBody(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'm'));
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  if (close < 0) throw new Error(`unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}
