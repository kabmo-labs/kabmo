/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stylesheets are modules, but only to a bundler.
 *
 * Every `.css` import in this tree is a side-effect import whose RESULT is the
 * bundler's business: `Bun.build` inlines it (Tailwind through
 * `src/server/lib/bundler/css.ts`) and the browser never resolves the specifier
 * itself. TypeScript cannot see that, so it reports TS2882 for each one under
 * `noUncheckedSideEffectImports` (which `bun check` turns on).
 *
 * The declaration states what is true — importing a stylesheet is valid and has
 * no type surface — rather than teaching the checker an exception per file.
 */

declare module '*.css';
