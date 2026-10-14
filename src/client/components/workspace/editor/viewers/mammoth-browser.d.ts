/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for mammoth's PREBUILT browser bundle.
 *
 * `DocxView` imports `mammoth/mammoth.browser.js` rather than `mammoth`, and
 * that is load-bearing: mammoth's `browser` field (which swaps `lib/unzip.js`
 * for `browser/unzip.js`) is applied by Bun's `--target=browser` bundler but NOT
 * by the AOT production build, which runs `target: 'bun'` because its entrypoint
 * is the SERVER. Without the explicit bundle, the production build pulls in
 * `lib/unzip.js` → `fs`/`stream` and fails with "Browser build cannot require()
 * Node.js builtin". Verified: `bun build index.html --target=bun` fails with the
 * bare specifier and succeeds with this one.
 *
 * The package ships no declaration for that file, so this declares its default
 * export as the same surface `mammoth/lib/index.d.ts` describes — the subset the
 * viewer uses.
 */

declare module 'mammoth/mammoth.browser.js' {
  interface DocxResult {
    value: string;
    messages: unknown[];
  }

  interface MammothBrowser {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>): Promise<DocxResult>;
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<DocxResult>;
  }

  const mammoth: MammothBrowser;
  export default mammoth;
}
