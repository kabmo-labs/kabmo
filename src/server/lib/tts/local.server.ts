/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's own local text-to-speech, driven through the public `omp say` command.
 *
 * Why the CLI and not omp's internal TTS worker: the worker is private,
 * version-fragile and — measured on omp 19.1.1 for its sibling `stt` worker —
 * dies ~25 ms after spawn because its transport changed. `omp say --out` is a
 * documented command that writes a WAV file, so Kabmo can use it without
 * speaking an undocumented protocol.
 *
 * The text travels through a temp file, never argv: answers routinely exceed
 * the platform's argument limit, and a file has no shell to escape.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveOmpBin } from '@kabmo-labs/kabmo-omp/cli';
import { TtsEngineError, type TtsAudio } from '@/server/lib/tts/engines/adapter';
import type { TtsLocalCapability } from '@/shared/lib/tts/capability';

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const SYNTH_TIMEOUT_MS = 120_000;

let cachedProbe: { at: number; value: TtsLocalCapability } | null = null;

export function invalidateLocalTtsCapability(): void {
  cachedProbe = null;
}

/** Whether this install has an omp binary that knows the `say` command. */
export async function localTtsCapability(force = false): Promise<TtsLocalCapability> {
  if (!force && cachedProbe && Date.now() - cachedProbe.at < PROBE_TTL_MS) return cachedProbe.value;

  const bin = resolveOmpBin();
  if (!bin) {
    const value: TtsLocalCapability = {
      available: false,
      reason: 'omp is not installed. Install omp, or pick a hosted engine in Settings → Voice → Speech.',
    };
    cachedProbe = { at: Date.now(), value };
    return value;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = Bun.spawn({
      cmd: [bin, 'say', '--help'],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      env: process.env,
    });
    const timeout = Promise.withResolvers<number>();
    timer = setTimeout(() => {
      child.kill();
      timeout.reject(new Error('timed out'));
    }, PROBE_TIMEOUT_MS);
    const code = await Promise.race([child.exited, timeout.promise]);
    const value: TtsLocalCapability = code === 0
      ? { available: true }
      : {
          available: false,
          reason: `This omp build has no \`say\` command (exit ${code}). Update omp, or pick a hosted engine.`,
        };
    cachedProbe = { at: Date.now(), value };
    return value;
  } catch {
    const value: TtsLocalCapability = {
      available: false,
      reason: 'This omp build did not answer `omp say --help`. Update omp, or pick a hosted engine.',
    };
    cachedProbe = { at: Date.now(), value };
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/** The argv a synthesis run uses; exported so a test can pin the contract. */
export function buildSayArgs(
  bin: string,
  textPath: string,
  outPath: string,
  voice: string,
  speed: number,
): string[] {
  const args = [bin, 'say', '--file', textPath, '--out', outPath];
  if (voice) args.push('--voice', voice);
  if (speed !== 1) args.push('--speed', String(speed));
  return args;
}

/** Synthesize one chunk locally, returning the WAV bytes. */
export async function synthesizeWithOmp(input: {
  text: string;
  voice: string;
  speed: number;
}): Promise<TtsAudio> {
  const bin = resolveOmpBin();
  if (!bin) {
    throw new TtsEngineError(
      'omp is not installed. Install omp, or pick a hosted engine in Settings → Voice → Speech.',
      false,
    );
  }
  if (input.voice && !/^[a-z0-9_-]{1,40}$/i.test(input.voice)) {
    throw new TtsEngineError('That is not an omp voice id.', false);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kabmo-tts-'));
  const textPath = path.join(dir, 'text.txt');
  const outPath = path.join(dir, 'speech.wav');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Bun.write(textPath, input.text);
    await fs.chmod(textPath, 0o600);

    const child = Bun.spawn({
      cmd: buildSayArgs(bin, textPath, outPath, input.voice, input.speed),
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
      env: process.env,
      cwd: dir,
    });
    const stderrText = new Response(child.stderr).text().catch(() => '');
    const timeout = Promise.withResolvers<number>();
    timer = setTimeout(() => {
      child.kill();
      timeout.reject(new Error('timed out'));
    }, SYNTH_TIMEOUT_MS);
    let code: number;
    try {
      code = await Promise.race([child.exited, timeout.promise]);
    } catch {
      throw new TtsEngineError('Local speech did not finish within two minutes.', true);
    }
    if (code !== 0) {
      const stderr = await stderrText;
      const detail = stderr.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 200);
      throw new TtsEngineError(
        `Local speech failed (exit ${code})${detail ? ` — ${detail}` : ''}.`,
        true,
      );
    }

    const bytes = new Uint8Array(await Bun.file(outPath).arrayBuffer());
    if (bytes.byteLength === 0) throw new TtsEngineError('Local speech returned no audio.', true);
    return { bytes, mimeType: 'audio/wav' };
  } finally {
    clearTimeout(timer);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
