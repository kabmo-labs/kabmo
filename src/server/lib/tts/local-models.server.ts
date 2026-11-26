/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Installed local speech models: where they live, how one arrives, and how a
 * request finds it.
 *
 * A model is a directory of ONNX weights under `<data>/tts-models/<id>/` plus a
 * `model.json` that states what it is. The manifest is the source of truth for
 * "which languages does this model speak" — deliberately, because the runtime
 * answers that question wrongly (it validates the code against its own list, not
 * the loaded model: the English-only Supertonic v1 bundle synthesizes Indonesian
 * text on request).
 *
 * Installs are long (100–150 MB) and the settings page has to show progress, so
 * the job state is process-wide and readable between requests. A second install
 * of the same id joins the running job instead of starting another download.
 */

import fs from 'fs/promises';
import path from 'path';
import { getTtsModelsDir } from '@kabmo-labs/kabmo-paths/paths';
import {
  catalogModel,
  type InstallJob,
  type LocalTtsModelInfo,
} from '@/shared/lib/tts/local-models';
import {
  catalogForUrl,
  detectArch,
  modelIdFromUrl,
  writeManifest,
} from '@/server/lib/tts/model-manifest.server';
import { modelEntries, probeLocalModel, forgetLocalModel } from '@/server/lib/tts/engines/sherpa';

/** A model is 100–150 MB; anything past this is not a speech model. */
const MAX_ARCHIVE_BYTES = 1_500_000_000;
/** Extraction of a 150 MB archive on a slow disk is minutes, not seconds. */
const EXTRACT_TIMEOUT_MS = 300_000;

interface InstallState {
  jobs: Map<string, InstallJob>;
}

function state(): InstallState {
  const key = Symbol.for('kabmo.tts.installs');
  const holder = globalThis as unknown as Record<symbol, InstallState | undefined>;
  let value = holder[key];
  if (!value) {
    value = { jobs: new Map() };
    holder[key] = value;
  }
  return value;
}

/** Live install jobs, for the settings page. */
export function installJobs(): InstallJob[] {
  return [...state().jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function setJob(id: string, patch: Partial<InstallJob> & { label: string }): InstallJob {
  const current = state().jobs.get(id);
  const next: InstallJob = {
    id,
    label: patch.label,
    status: patch.status ?? current?.status ?? 'downloading',
    received: patch.received ?? current?.received ?? 0,
    total: patch.total ?? current?.total ?? 0,
    progress: patch.progress ?? current?.progress ?? 0,
    ...(patch.error ? { error: patch.error } : {}),
    url: patch.url ?? current?.url,
    startedAt: current?.startedAt ?? Date.now(),
  };
  state().jobs.set(id, next);
  return next;
}

/** Stream a URL to a file, reporting bytes as they land. */
async function download(url: string, target: string, id: string, label: string): Promise<number> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`The download answered HTTP ${response.status}.`);
  const total = Number(response.headers.get('content-length') ?? 0);
  if (total > MAX_ARCHIVE_BYTES) throw new Error('That archive is too large to be a speech model.');
  if (!response.body) throw new Error('The server sent no body.');

  const handle = await fs.open(target, 'w');
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_ARCHIVE_BYTES) throw new Error('That archive is too large to be a speech model.');
      await handle.write(value);
      setJob(id, {
        label,
        status: 'downloading',
        received,
        total,
        progress: total > 0 ? Math.min(0.99, received / total) : 0,
      });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }
  if (received === 0) throw new Error('The download was empty.');
  return received;
}

/** Extract an archive into `into`, with the platform `tar` (Bun has no bzip2). */
async function extract(archive: string, into: string): Promise<void> {
  await fs.mkdir(into, { recursive: true });
  const child = Bun.spawn({
    cmd: ['tar', '-xf', archive, '-C', into, '--no-same-owner'],
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    env: process.env,
  });
  const stderr = new Response(child.stderr).text().catch(() => '');
  const timer = setTimeout(() => child.kill(), EXTRACT_TIMEOUT_MS);
  try {
    const code = await child.exited;
    if (code !== 0) {
      const detail = (await stderr).trim().split('\n').filter(Boolean).at(-1)?.slice(0, 200);
      throw new Error(`The archive could not be unpacked${detail ? ` — ${detail}` : ''}.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** The directory that holds the weights: the archive's single top folder, or itself. */
async function modelRoot(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (dirs.length === 1 && files.length === 0) return path.join(dir, dirs[0]!.name);
  return dir;
}

/** Move `from`'s contents into `to`, then drop `from`. */
async function adopt(from: string, to: string): Promise<void> {
  await fs.rm(to, { recursive: true, force: true });
  await fs.rename(from, to);
}

/**
 * Install a model: curated id, or a URL to a `.tar.bz2`/`.tar.gz` bundle.
 *
 * The job is registered BEFORE the first byte arrives, so the settings page can
 * poll a download that has not started writing yet, and a failure leaves a job
 * with its error rather than a silent disappearance.
 */
export async function installModel(input: { id?: string; url?: string }): Promise<InstallJob> {
  const curated = input.id ? catalogModel(input.id) : undefined;
  const url = (curated?.sourceUrl ?? input.url ?? '').trim();
  if (!url) throw new Error('Pick a model, or paste a link to one.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('That is not a link.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('A model link must be http or https.');
  }

  const fromCatalog = curated ?? catalogForUrl(url);
  const id = curated?.id ?? modelIdFromUrl(url);
  const label = fromCatalog?.label ?? id;
  const existing = state().jobs.get(id);
  if (existing && existing.status !== 'ready' && existing.status !== 'error') return existing;

  const job = setJob(id, { label, url, status: 'downloading', received: 0, total: 0, progress: 0 });
  void runInstall({ id, label, url, fromCatalog }).catch((error: unknown) => {
    setJob(id, {
      label,
      url,
      status: 'error',
      error: error instanceof Error ? error.message : 'The install failed.',
    });
  });
  return job;
}

async function runInstall(input: {
  id: string;
  label: string;
  url: string;
  fromCatalog: LocalTtsModelInfo | undefined;
}): Promise<void> {
  const root = getTtsModelsDir();
  const staging = path.join(root, `.install-${input.id}-${Date.now()}`);
  const archive = path.join(staging, 'bundle');
  const target = path.join(root, input.id);
  try {
    await fs.mkdir(staging, { recursive: true });
    const bytes = await download(input.url, archive, input.id, input.label);

    setJob(input.id, { label: input.label, url: input.url, status: 'extracting', received: bytes, progress: 1 });
    const unpacked = path.join(staging, 'unpacked');
    await extract(archive, unpacked);
    const source = await modelRoot(unpacked);
    const entries = await modelEntries(source);
    const arch = detectArch(entries);
    if (!arch) {
      throw new Error(
        'That archive is not a speech model this build can run. It needs either the Supertonic '
        + 'files (tts.json, voice.bin, duration_predictor/text_encoder/vector_estimator/vocoder) '
        + 'or the Kokoro ones (model.onnx, voices.bin, tokens.txt).',
      );
    }

    setJob(input.id, { label: input.label, url: input.url, status: 'probing', received: bytes, progress: 1 });
    await adopt(source, target);
    const probed = await probeLocalModel(target, arch);
    const installedAt = new Date().toISOString();
    const info: LocalTtsModelInfo = {
      id: input.id,
      label: input.fromCatalog?.label ?? input.label,
      arch,
      // A curated bundle states its languages; a pasted one states nothing, and
      // the settings page says so instead of inventing a list.
      languages: input.fromCatalog?.languages ?? [],
      defaultLanguage: input.fromCatalog?.defaultLanguage ?? 'en',
      voices: probed.voices,
      ...(input.fromCatalog?.voiceLabels ? { voiceLabels: input.fromCatalog.voiceLabels } : {}),
      sampleRate: probed.sampleRate,
      sizeBytes: bytes,
      sourceUrl: input.url,
      installedAt,
      ...(input.fromCatalog?.notes ? { notes: input.fromCatalog.notes } : {}),
    };
    await writeManifest(target, info);
    setJob(input.id, { label: info.label, url: input.url, status: 'ready', received: bytes, progress: 1 });
  } catch (error: unknown) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Remove an installed model, and its loaded engine with it. */
export async function removeModel(id: string): Promise<void> {
  if (!/^[a-z0-9._-]{1,64}$/.test(id)) throw new Error('That is not a model id.');
  const dir = path.join(getTtsModelsDir(), id);
  forgetLocalModel(dir);
  await fs.rm(dir, { recursive: true, force: true });
  state().jobs.delete(id);
}
