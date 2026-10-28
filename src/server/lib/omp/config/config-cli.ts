/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp config CLI bridge — schema-aware get/set/list/reset over the real
 * `omp config` command (550-key registry with {value,type,description}
 * metadata). Shell-out instead of RPC because omp exposes no config get/set
 * RPC command; the CLI is fast (~0.3s) and authoritative.
 *
 * BOTH streams are returned, and the failure sentence is read from stderr —
 * the same shape `plugin-cli.ts` uses. omp reports a rejected key or value
 * there and exits 1:
 *
 *   $ omp config set providers.openai-codex.codeMode off
 *   Unknown setting: providers.openai-codex.codeMode
 *
 *   Run 'omp config list' to see available keys
 *
 * Reading stdout alone threw `exited with code 1` and dropped the one sentence
 * that explains the refusal, so a stale panel row (a key removed upstream) was
 * indistinguishable from a typo, a permission failure or a timeout. Measured at
 * 18.11.0: two rows the committed schema still offered — `codeMode` and
 * `codeModeDirectTools`, removed upstream in 18.10.4 — failed exactly this way.
 */

import { isMockMode } from '@/server/mock.server';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { childEnv } from '@/server/lib/fs/child-env';

export interface ConfigEntry {
  value?: unknown;
  type: string;
  description: string;
}

/** One `omp config …` invocation's outcome. Never thrown for a non-zero exit. */
export interface ConfigCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const LIST_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 15_000;

/** Run one `omp config …` command. Never throws for a non-zero exit. */
async function runOmp(args: string[], timeoutMs: number): Promise<ConfigCommandResult> {
  const bin = resolveOmpBin();
  if (!bin) return { ok: false, stdout: '', stderr: 'omp binary not found' };
  try {
    const proc = Bun.spawn({
      env: childEnv(),
      cmd: [bin, 'config', ...args],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The failure sentence of a `omp config` result, or `null` when both streams
 * are empty (a timeout or a spawn failure, where the caller's label is all
 * there is).
 *
 * stderr's FIRST non-empty line, not its last: omp puts the reason first and a
 * generic hint after it ("Run 'omp config list' to see available keys"), so the
 * last line is the one line guaranteed to say nothing about this call. This is
 * where the config bridge differs from `pluginCliError`, whose failures END with
 * the sentence and whose generic text comes first.
 */
export function configFailureLine(result: ConfigCommandResult): string | null {
  const raw = result.stderr.trim() || result.stdout.trim();
  // The status glyph survives on a non-TTY stream (omp drops ANSI colour, not
  // the mark), so leading non-word characters are stripped to leave the
  // sentence itself.
  const line = (raw.split('\n').map((row) => row.trim()).find(Boolean) ?? '').replace(/^[^\w@/]*/, '').trim();
  return line || null;
}

/** Full schema snapshot: key → {value?, type, description}. Empty in mock mode. */
export async function listOmpConfig(): Promise<Record<string, ConfigEntry>> {
  if (isMockMode()) return {};
  const result = await runOmp(['list', '--json'], LIST_TIMEOUT_MS);
  if (!result.ok) throw new Error(configFailureLine(result) ?? 'omp config list failed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('omp config list returned unexpected JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('omp config list returned unexpected JSON');
  }
  const entries: Record<string, ConfigEntry> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    entries[key] = {
      value: record.value,
      type: typeof record.type === 'string' ? record.type : 'unknown',
      description: typeof record.description === 'string' ? record.description : '',
    };
  }
  return entries;
}

/** Read one config key's current value (undefined when unset). */
export async function getOmpConfigValue(key: string): Promise<unknown> {
  if (isMockMode()) return undefined;
  const result = await runOmp(['get', key], WRITE_TIMEOUT_MS);
  if (!result.ok) throw new Error(configFailureLine(result) ?? `omp config get ${key} failed`);
  const text = result.stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Write one config key; returns the value omp reports after the write.
 * Arrays/records serialize to JSON strings, which `omp config set` parses
 * against the key's schema type. */
export async function setOmpConfigValue(
  key: string,
  value: string | number | boolean | unknown[] | Record<string, unknown>,
): Promise<unknown> {
  if (isMockMode()) throw new Error('config writes are unavailable in mock mode');
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const result = await runOmp(['set', key, serialized], WRITE_TIMEOUT_MS);
  if (!result.ok) throw new Error(configFailureLine(result) ?? `omp config set ${key} failed`);
  return getOmpConfigValue(key);
}

/** Reset one config key to its schema default. */
export async function resetOmpConfigKey(key: string): Promise<unknown> {
  if (isMockMode()) throw new Error('config writes are unavailable in mock mode');
  const result = await runOmp(['reset', key], WRITE_TIMEOUT_MS);
  if (!result.ok) throw new Error(configFailureLine(result) ?? `omp config reset ${key} failed`);
  return getOmpConfigValue(key);
}
