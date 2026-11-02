/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Give an SVG document its own id namespace.
 *
 * Two defects are one defect: an id namespace authored in isolation being
 * shared with the page it is drawn into.
 *
 * 1. **DOMPurify DELETES an id the page already owns.** Its clobbering guard
 *    drops an `id`/`name` whose value is `in document` (`SANITIZE_DOM`, on by
 *    default), and `document.body`, `document.title` and friends are always in
 *    it. Measured in Chromium on a real app icon: the `<linearGradient
 *    id="body">` lost its id while `fill="url(#body)"` stayed, so the two
 *    shapes that gradient paints — the chicken's body and head — came out
 *    filled with the background's dark green instead of cream, and nothing was
 *    logged. Prefixing the id is what satisfies the guard. `SANITIZE_NAMED_PROPS`
 *    is NOT a substitute: it prefixes the declaration (`user-content-body`) and
 *    leaves `url(#body)` pointing at the old name, which is a worse break —
 *    measured, `urlRefRewritten: false`.
 * 2. **Two previews share every definition.** `defs` ids are document-scoped,
 *    so the same icon opened twice — or a file reusing a name the app's own
 *    inline SVG already defines — silently resolves to the FIRST match, and the
 *    second picture paints with the first one's gradient.
 *
 * The rewrite is TEXT, deliberately: it runs on markup that has not been
 * sanitized yet, and parsing untrusted SVG into the live document is the thing
 * the sanitizer exists to prevent (a detached `<img src onerror>` still fires).
 * Renaming a string cannot execute anything.
 *
 * Every reference form that can carry an id is rewritten with its declaration,
 * because a rename that missed one would silently point at nothing: `url(#id)`
 * (fill, stroke, filters, clip-path, mask, marker-*, and the same values inside
 * a `<style>` block), `href`/`xlink:href`, `#id` selectors in a `<style>`
 * block, and the ARIA idref lists. Bare-name references are NOT rewritten:
 * SMIL's `begin="id.click"` would be one, and DOMPurify strips `<animate>`/`<set>`
 * outright, so a rewrite there would invent a rule with no example.
 */

/** An `id="…"` declaration, any quote style, any spacing around `=`. */
const ID_DECLARATION = /(\sid\s*=\s*)(["'])([^"']*)\2/g;

/** `url(#id)`, quoted or not — how a paint server, filter or clip is referenced. */
const URL_REFERENCE = /url\(\s*(["']?)#([A-Za-z_][\w-]*)\1\s*\)/g;

/** `href="#id"` / `xlink:href="#id"`: a same-document fragment ONLY. */
const HREF_FRAGMENT = /(\s(?:xlink:href|href)\s*=\s*)(["'])(#[^"']*)\2/g;

/** The ARIA attributes whose value is a whitespace-separated list of ids. */
const ARIA_IDREF =
  /(\saria-(?:labelledby|describedby|controls|owns|flowto|activedescendant|details|errormessage)\s*=\s*)(["'])([^"']*)\2/g;

/** A `<style>` element, whose body is stylesheet text rather than markup. */
const STYLE_ELEMENT = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/g;

/** One stylesheet rule, split so only the SELECTOR half is read for ids. */
const STYLE_RULE = /([^{}]*)\{([^{}]*)\}/g;

/** A `#name` token inside a selector. */
const SELECTOR_REFERENCE = /#([A-Za-z_][\w-]*)/g;

/**
 * Prefix every id in `markup` with `prefix`, and rewrite the references that
 * point at them.
 *
 * `prefix` must be unique in the page and XML-name safe (`svg3-`, not `3-`).
 * Markup with no id is returned as the SAME string, so a caller can tell
 * nothing was scoped.
 */
export function scopeSvgIds(markup: string, prefix: string): string {
  if (!markup || !markup.includes('id')) return markup;

  const renamed = new Map<string, string>();
  for (const match of markup.matchAll(ID_DECLARATION)) {
    const id = match[3];
    if (id && !id.startsWith(prefix)) renamed.set(id, `${prefix}${id}`);
  }
  if (renamed.size === 0) return markup;

  return (
    markup
      .replace(ID_DECLARATION, (all, head: string, quote: string, id: string) => {
        const next = renamed.get(id);
        return next ? `${head}${quote}${next}${quote}` : all;
      })
      .replace(URL_REFERENCE, (all, quote: string, name: string) => {
        const next = renamed.get(name);
        return next ? `url(${quote}#${next}${quote})` : all;
      })
      // Only a fragment is ours. `href="other.svg#id"` names an id in ANOTHER
      // document, which this prefix has no authority over.
      .replace(HREF_FRAGMENT, (all, head: string, quote: string, value: string) => {
        const next = renamed.get(value.slice(1));
        return next ? `${head}${quote}#${next}${quote}` : all;
      })
      .replace(ARIA_IDREF, (all, head: string, quote: string, value: string) => {
        const next = value
          .split(/\s+/)
          .map((name) => renamed.get(name) ?? name)
          .join(' ');
        return next === value ? all : `${head}${quote}${next}${quote}`;
      })
      // A stylesheet's DECLARATIONS may hold `url(#id)`, already rewritten
      // above; only its selector half can hold a bare `#id`. Reading the
      // declaration half would rewrite a hex colour that happens to be shaped
      // like a name (`fill:#abc` where an id `abc` exists).
      .replace(STYLE_ELEMENT, (all, open: string, body: string, close: string) => {
        const next = body.replace(STYLE_RULE, (rule, selector: string, declarations: string) => {
          const rewritten = selector.replace(SELECTOR_REFERENCE, (token, name: string) => {
            const mapped = renamed.get(name);
            return mapped ? `#${mapped}` : token;
          });
          return rewritten === selector ? rule : `${rewritten}{${declarations}}`;
        });
        return next === body ? all : `${open}${next}${close}`;
      })
  );
}

/**
 * A prefix no other preview shares.
 *
 * A module counter, not `useId`: measured, two Preact roots mounted on one page
 * both allocate `P0-0`, so two previews in two roots would collide on exactly
 * the ids this exists to keep apart. A process counter cannot.
 */
let sequence = 0;

export function nextSvgScopePrefix(): string {
  sequence += 1;
  return `svg${sequence}-`;
}
