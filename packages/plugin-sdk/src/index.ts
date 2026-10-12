/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel-plugin contract.
 *
 * Two halves, and the split is what keeps a plugin bundle small:
 *
 * - This root export is TYPE-ONLY plus the two `definePluginApp` helpers. It is
 *   the shape a plugin author compiles against and it costs a few bytes,
 *   because nothing here runs.
 * - `@ompchamber/plugin-sdk/app` is the same contract — the build marks it
 *   external, and the host answers it from its own runtime, so a plugin never
 *   bundles a second copy of anything the host already has.
 *
 * The contract itself lives in `./app`; this module only decides what the root
 * entry exposes.
 *
 * `./backend` is the SERVER half: the API a plugin's `server.ts` receives. It
 * is exported from the root rather than from a subpath because a plugin's
 * server entry is never bundled for the browser — nothing shims it, so there is
 * no specifier for a build to rewrite and no reason to split it out.
 *
 * `./slots` is the LIST half of the app contract: the slots a plugin may
 * contribute several of (a chat row action, a composer command, a file opener),
 * as opposed to the four positional ones `./app` owns. Split out because the
 * two are different KINDS of registration — one of something versus a row among
 * rows — and the rule that follows from it differs (refuse a second, versus
 * key it and return a disposer).
 */

export * from './app';
export * from './backend';
export * from './scope';
export * from './slots';
export * from './slots-sidebar';
