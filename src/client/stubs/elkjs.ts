/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Browser replacement for `elkjs`, aliased through `tsconfig.json` `paths`.
 *
 * The alias moved there when the client build moved to Bun: Bun's bundler does
 * not read an `alias` option (it is absent from `Bun.build`'s config and from
 * `bun-types`; passing one is silently ignored — verified), while `paths` it
 * honours for both internal aliases and package specifiers.
 *
 * Mermaid 12 changed the global `layout` default from `dagre` to `elk`, so every
 * flowchart pulled in `elkjs/lib/elk.bundled.js` whether the diagram asked for
 * ELK or not — the single largest artifact in the client build (~1.4 MB raw,
 * 434 kB gzip). `src/shared/lib/markdown/mermaid.ts` pins `layout: 'dagre'`,
 * which is what makes this stub safe: with dagre selected explicitly, mermaid
 * never calls into `runElkLayoutCore`, the only code path that constructs an ELK
 * instance (verified across 20 diagram types, byte-identical results to a build
 * with the real elkjs).
 *
 * `layout: 'elk'` is still a valid *request* — a diagram using the
 * `flowchart-elk` directive, or a syntax flagged `@config{layout: "elk"}`. Those
 * now fail loudly here instead of silently rendering with a different layout
 * than asked for. Throwing is deliberate: mermaid's `render()` propagates the
 * error to the caller, and `mermaid.ts` already renders a fallback block on
 * failure, so a mis-specified diagram degrades to a visible message rather than
 * a wrong diagram.
 */

function unavailable(): never {
  throw new Error('elkjs is not bundled in this build; use the default dagre layout');
}

export class ELK {}

export default new Proxy(ELK as unknown as object, {
  construct: unavailable,
  apply: unavailable,
  get: unavailable,
}) as unknown as typeof ELK;
