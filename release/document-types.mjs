/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The document types the Kabmo shell can open, in ONE table.
 *
 * Kabmo renders PDF, Word, Excel, images, markdown, CSV and text in its own
 * editor — so it can be the app a person picks from Finder's "Open With", and
 * the app a `.docx` lands in when they drop it on the Dock icon. Each platform
 * declares that differently and each declaration is a separate file:
 *
 * - **macOS** — `CFBundleDocumentTypes` in the bundle's `Info.plist`, written by
 *   `packages/macos/scripts/build-app.sh` from this table's UTIs.
 * - **Linux** — the `MimeType=` key of the `.desktop` entry, filled in by
 *   `packages/linux/scripts/install.sh` from the MIME list.
 * - **Windows** — `[Registry]` entries in the Inno Setup script, from the
 *   generated `packages/windows/installer/document-types.iss`.
 * - **Android** — `intent-filter` blocks in `AndroidManifest.xml`, from the
 *   generated `packages/android/app/src/main/res/xml/document_types.xml`.
 * - **iOS** — `CFBundleDocumentTypes` in `Resources/Info.plist`, from the
 *   generated `packages/ios/Resources/DocumentTypes.plist`.
 *
 * The table exists because those files drifted the moment one of them was
 * edited alone: a format added to the editor and declared on macOS only is a
 * format Windows users cannot double-click. `scripts/shell-document-types.mjs`
 * renders each artifact from here, and `release/document-types.test.js` asserts
 * every rendered artifact against this table.
 *
 * **Every entry is a VIEWER, never a handler.** `CFBundleTypeRole: Viewer` and
 * `LSHandlerRank: Alternate` on macOS and iOS, `OpenWithProgids` (never
 * `Progid`) on Windows, and on Android no `android:priority` on the filters:
 * Kabmo must never take over a user's PDF reader or their `.md` editor. It
 * offers itself; the user decides.
 *
 * Only types the editor can actually draw are listed. A `.zip` or a `.pages`
 * file would open a tab whose whole content is a refusal, which is a worse
 * answer than the OS saying "no application knows how to open this".
 */

/** One document type, as every platform declares it. */
export const HANDLED_DOCUMENTS = [
  {
    name: 'PDF Document',
    uti: 'com.adobe.pdf',
    mime: 'application/pdf',
    extensions: ['pdf'],
  },
  {
    name: 'Word Document',
    uti: 'org.openxmlformats.wordprocessingml.document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
  },
  {
    name: 'Excel Workbook',
    uti: 'org.openxmlformats.spreadsheetml.sheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
  },
  {
    name: 'Excel Macro-Enabled Workbook',
    uti: 'org.openxmlformats.spreadsheetml.sheet.macroEnabled.12',
    mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    extensions: ['xlsm'],
  },
  {
    name: 'Markdown Document',
    uti: 'net.daringfireball.markdown',
    mime: 'text/markdown',
    extensions: ['md', 'markdown', 'mdx'],
  },
  {
    name: 'CSV Document',
    uti: 'public.comma-separated-values-text',
    mime: 'text/csv',
    extensions: ['csv'],
  },
  {
    name: 'TSV Document',
    uti: 'public.tab-separated-values-text',
    mime: 'text/tab-separated-values',
    extensions: ['tsv'],
  },
  {
    name: 'SVG Image',
    uti: 'public.svg-image',
    mime: 'image/svg+xml',
    extensions: ['svg'],
  },
  {
    // One row for the raster formats: `public.image` already covers every
    // concrete image UTI on macOS, and Windows/Linux only need the extensions.
    name: 'Image',
    uti: 'public.image',
    mime: 'image/png',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  },
  {
    name: 'Plain Text',
    uti: 'public.plain-text',
    mime: 'text/plain',
    extensions: ['txt', 'log', 'text'],
  },
  {
    name: 'JSON Document',
    uti: 'public.json',
    mime: 'application/json',
    extensions: ['json'],
  },
];

/** Every extension, deduplicated and in table order. */
export function documentExtensions() {
  return [...new Set(HANDLED_DOCUMENTS.flatMap((entry) => entry.extensions))];
}

/** Every MIME type, deduplicated and in table order. */
export function documentMimes() {
  return [...new Set(HANDLED_DOCUMENTS.map((entry) => entry.mime))];
}

/**
 * Every UTI, deduplicated.
 *
 * `public.image` is kept as ONE row rather than expanded per format: macOS
 * resolves a `.webp` to it, and listing `public.png`/`public.jpeg` beside it
 * would make the Open With menu show three Kabmo rows for one file.
 */
export function documentUtis() {
  return [...new Set(HANDLED_DOCUMENTS.map((entry) => entry.uti))];
}
