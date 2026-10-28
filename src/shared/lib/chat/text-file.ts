/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deciding whether a file's contents are text, and what language to fence them
 * under, from the file itself rather than from its metadata.
 *
 * Split out of `attachments.ts` because it is the one part of classification
 * that reads BYTES: everything else there works from `name`/`type`/`size`,
 * which is what a replayed attachment has.
 */

/**
 * Extensions treated as inline-able text when the browser reports no useful
 * MIME type. `File.type` is empty for many code files, so the extension is the
 * only signal — a dropped `script.py` used to attach without its contents ever
 * reaching the prompt.
 */
export const TEXT_FILE_EXTENSIONS: Record<string, true> = {
  txt: true,
  text: true,
  md: true,
  markdown: true,
  mdx: true,
  json: true,
  jsonc: true,
  yaml: true,
  yml: true,
  toml: true,
  ini: true,
  env: true,
  csv: true,
  tsv: true,
  log: true,
  xml: true,
  html: true,
  htm: true,
  css: true,
  scss: true,
  less: true,
  js: true,
  mjs: true,
  cjs: true,
  jsx: true,
  ts: true,
  mts: true,
  cts: true,
  tsx: true,
  py: true,
  rb: true,
  go: true,
  rs: true,
  java: true,
  kt: true,
  kts: true,
  swift: true,
  c: true,
  h: true,
  cc: true,
  cpp: true,
  cxx: true,
  hpp: true,
  hh: true,
  cs: true,
  php: true,
  pl: true,
  lua: true,
  r: true,
  sql: true,
  sh: true,
  bash: true,
  zsh: true,
  fish: true,
  ps1: true,
  bat: true,
  cmd: true,
  dockerfile: true,
  makefile: true,
  gitignore: true,
  editorconfig: true,
  diff: true,
  patch: true,
};

/** MIME types the browser reports for text-ish files it does know. */
export function isTextMimeType(type: string): boolean {
  if (!type) return false;
  if (type === 'text/plain' || type === 'text/markdown') return true;
  return type.startsWith('text/')
    || type === 'application/json'
    || type === 'application/xml'
    || type === 'application/x-yaml'
    || type === 'application/yaml'
    || type === 'application/javascript'
    || type === 'application/x-sh'
    || type === 'application/sql'
    || type.endsWith('+json')
    || type.endsWith('+xml');
}

/** Bytes sampled to decide whether an unclassified file is text. */
const SNIFF_BYTES = 4096;

/**
 * Whether an unclassified file's own bytes read as text.
 *
 * Some hosts hand over a file whose name and MIME say nothing useful: a
 * promised-file drag from another app arrives as `document` with an empty type,
 * and an opaque download as `application/octet-stream`. Deciding from the name
 * alone left those attached but never inlined — the chip rendered, the model saw
 * nothing.
 *
 * Three signals, because control-character density alone misses a short binary:
 * a NUL byte (no text encoding this app handles contains one), an invalid UTF-8
 * sequence (a lone continuation or lead byte), and the control-character ratio
 * a browser applies to a Blob. `TextDecoder` in fatal mode is the cheapest
 * correct UTF-8 validator available.
 */
export async function looksLikeTextFile(
  file: Pick<File, 'slice'>,
  /**
   * Bytes already read while the drop's permission was live. A dropped file
   * cannot be `slice()`d after that window closes, so the sniff is served from
   * the primed read where one exists. See `file-reads.ts`.
   */
  primed?: Uint8Array,
): Promise<boolean> {
  try {
    const bytes = primed ?? new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    if (bytes.length === 0) return false;
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return false;
    }
    let control = 0;
    for (const byte of bytes) {
      if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
    }
    return control / bytes.length <= 0.3;
  } catch {
    return false;
  }
}

