/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The installed-model manifest: what a directory on disk is, and which model a
 * request should load.
 *
 * A model is `<data>/tts-models/<id>/` plus a `model.json`. The manifest is the
 * source of truth for "which languages does this model speak" — deliberately,
 * because the runtime answers that question wrongly: it validates the language
 * code against its own 32-code list, not the loaded model, so the English-only
 * Supertonic v1 bundle synthesizes Indonesian text on request.
 *
 * Split out of the installer so the read path never imports the download path:
 * listing models must work while an install is running, and on a machine that
 * has no network at all.
 */

import fs from 'fs/promises';
import path from 'path';
import { getTtsModelsDir } from '@kabmo-labs/kabmo-paths/paths';
import {
  LOCAL_TTS_CATALOG,
  type LocalTtsArch,
  type LocalTtsModelInfo,
} from '@/shared/lib/tts/local-models';

export const MANIFEST = 'model.json';

export interface InstalledModel extends LocalTtsModelInfo {
  /** Absolute directory the runtime loads from. */
  dir: string;
}

/** The id a model directory gets: its name, restricted to a filesystem-safe set. */
export function modelIdFromUrl(url: string): string {
  let name = url.split(/[?#]/)[0]?.split('/').pop() ?? '';
  name = name.replace(/\.(tar\.bz2|tar\.gz|tgz|tar|zip)$/i, '');
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return safe || 'model';
}

/** The catalog entry a pasted URL is identical to, if any — it carries metadata. */
export function catalogForUrl(url: string): LocalTtsModelInfo | undefined {
  const wanted = url.trim();
  return LOCAL_TTS_CATALOG.find((model) => model.sourceUrl === wanted);
}

/**
 * Which runtime architecture a bundle is, from its file names.
 *
 * Refuses rather than guessing: a bundle that matches neither shape is either
 * not a speech model or one this build cannot load, and both deserve a sentence
 * instead of a stack trace from the native addon.
 */
export function detectArch(entries: readonly string[]): LocalTtsArch | null {
  const has = (name: string) => entries.includes(name);
  const supertonic = ['tts.json', 'voice.bin', 'unicode_indexer.bin'].every(has)
    && entries.some((name) => /^duration_predictor(\.int8)?\.onnx$/.test(name))
    && entries.some((name) => /^text_encoder(\.int8)?\.onnx$/.test(name))
    && entries.some((name) => /^vector_estimator(\.int8)?\.onnx$/.test(name))
    && entries.some((name) => /^vocoder(\.int8)?\.onnx$/.test(name));
  if (supertonic) return 'supertonic';
  const kokoro = has('voices.bin') && has('tokens.txt')
    && entries.some((name) => /^model(\.int8)?\.onnx$/.test(name));
  return kokoro ? 'kokoro' : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A manifest read from disk, narrowed field by field — it is user-editable JSON. */
export function toModelInfo(id: string, raw: Record<string, unknown>): LocalTtsModelInfo {
  return {
    id,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : id,
    arch: raw.arch === 'kokoro' ? 'kokoro' : 'supertonic',
    languages: strings(raw.languages),
    defaultLanguage: typeof raw.defaultLanguage === 'string' ? raw.defaultLanguage : 'en',
    voices: number(raw.voices),
    ...(Array.isArray(raw.voiceLabels) ? { voiceLabels: strings(raw.voiceLabels) } : {}),
    sampleRate: number(raw.sampleRate),
    ...(typeof raw.sizeBytes === 'number' ? { sizeBytes: raw.sizeBytes } : {}),
    ...(typeof raw.sourceUrl === 'string' ? { sourceUrl: raw.sourceUrl } : {}),
    ...(typeof raw.installedAt === 'string' ? { installedAt: raw.installedAt } : {}),
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

export async function writeManifest(dir: string, info: LocalTtsModelInfo): Promise<void> {
  const body: Record<string, unknown> = {
    label: info.label,
    arch: info.arch,
    languages: info.languages,
    defaultLanguage: info.defaultLanguage,
    voices: info.voices,
    sampleRate: info.sampleRate,
    sizeBytes: info.sizeBytes,
    sourceUrl: info.sourceUrl,
    installedAt: info.installedAt,
    ...(info.voiceLabels ? { voiceLabels: info.voiceLabels } : {}),
    ...(info.notes ? { notes: info.notes } : {}),
  };
  await fs.writeFile(path.join(dir, MANIFEST), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}

async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, MANIFEST), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every installed model, newest first. A directory without a manifest is skipped. */
export async function listInstalledModels(): Promise<InstalledModel[]> {
  const root = getTtsModelsDir();
  let ids: string[];
  try {
    ids = (await fs.readdir(root, { withFileTypes: true }))
      // A symlink counts: a model can live on another disk with a link here,
      // and the manifest read is what decides whether it is really a model.
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const found: InstalledModel[] = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    const raw = await readManifest(dir);
    // No manifest (a half-finished install, a hand-made directory) is not a model.
    if (raw) found.push({ ...toModelInfo(id, raw), dir });
  }
  return found.sort((a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? ''));
}

/** One installed model by id. */
export async function readInstalledModel(id: string): Promise<InstalledModel | null> {
  if (!/^[a-z0-9._-]{1,64}$/.test(id)) return null;
  const dir = path.join(getTtsModelsDir(), id);
  const raw = await readManifest(dir);
  return raw ? { ...toModelInfo(id, raw), dir } : null;
}