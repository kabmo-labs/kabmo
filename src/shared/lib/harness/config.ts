/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-harness configuration: what a user may change about ONE ACP agent.
 *
 * The launch table is the build's knowledge of how to start an agent on a stock
 * machine. It is wrong for anyone whose CLI lives elsewhere, who authenticates
 * against their own provider, or who always wants the same model — and the only
 * way to express that used to be editing the source. These four knobs cover the
 * cases that came up, and each has a reason to exist:
 *
 *  - **`command`** — the binary is not on PATH (`~/bin/agy`, a wrapper that
 *    signs in first). Empty means "use the table".
 *  - **`env`** — provider selection and credentials that the agent reads from
 *    its environment (`GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL`,
 *    `CODEX_PATH`). A real provider choice for an ACP agent IS an env or a
 *    config-selector value; there is no Kabmo-side routing for it.
 *  - **`provider`** — which provider's models this harness should start on. ACP
 *    publishes each model as `provider/model`, so a provider is a filter over
 *    that list, not a separate setting the agent understands.
 *  - **`model`, `thinking`, `mode`** — the defaults a new chat starts on, so the
 *    first prompt does not run on whatever the agent happens to prefer.
 *
 * Everything is a STRING or empty: absent means "the build's default", never a
 * silent zero. `parseHarnessConfig` is pure so the merge and the validation can
 * be asserted without a database.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';

export interface HarnessConfig {
  /** Launch command, space-separated. Empty = the build's table. */
  command: string;
  /** `KEY=VALUE` lines, one per line. Empty = the build's env, if any. */
  env: string;
  /** Provider prefix the model list should start on (`command-code`, `anthropic`). */
  provider: string;
  /** Default model VALUE as the agent spells it (`command-code/claude-sonnet-5`). */
  model: string;
  /** Default thinking level / effort. */
  thinking: string;
  /** Default mode (`plan`, `auto-accept`, …). */
  mode: string;
}

export const EMPTY_HARNESS_CONFIG: HarnessConfig = {
  command: '',
  env: '',
  provider: '',
  model: '',
  thinking: '',
  mode: '',
};

/** The stored shape is partial and untrusted: a database row from an older build,
 *  a hand-edited value, a plugin write. Every field falls back to empty. */
export function parseHarnessConfig(raw: unknown): HarnessConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_HARNESS_CONFIG };
  const source = raw as Record<string, unknown>;
  const text = (key: keyof HarnessConfig): string => (
    typeof source[key] === 'string' ? (source[key] as string) : ''
  );
  return {
    command: text('command'),
    env: text('env'),
    provider: text('provider'),
    model: text('model'),
    thinking: text('thinking'),
    mode: text('mode'),
  };
}

/**
 * Split a launch line into a command vector.
 *
 * Quoted segments survive (`"my tool" --acp` is two tokens, not three), because
 * a path with a space is the most common reason someone overrides the command at
 * all. An unterminated quote keeps the rest as one token rather than dropping it:
 * a half-typed line should fail at spawn with the agent's own error, not
 * silently lose the argument.
 */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

/**
 * Parse `KEY=VALUE` lines into an env map.
 *
 * A line without `=` is SKIPPED and reported, never treated as a key with an
 * empty value: an empty env var is a real thing to set, and a typo should not
 * quietly become one. `VALUE=` with nothing after it is kept for that reason.
 */
export function parseEnvLines(text: string): { env: Record<string, string>; invalid: string[] } {
  const env: Record<string, string> = {};
  const invalid: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) {
      invalid.push(line);
      continue;
    }
    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      invalid.push(line);
      continue;
    }
    env[key] = line.slice(equals + 1);
  }
  return { env, invalid };
}

/** The provider half of an ACP model selector (`provider/model`). */
export function modelProvider(value: string): string {
  const slash = value.indexOf('/');
  return slash <= 0 ? '' : value.slice(0, slash);
}

/**
 * Set these variables in a config's env, replacing any the user already had.
 *
 * Importing a provider into a harness whose credential is an ENV var (codex's
 * `env_key`, an `environment` harness) writes the value here, and appending the
 * line would leave two lines for one key — the same variable set twice in one
 * form, where a reader cannot tell which the spawn uses. The merge is by KEY,
 * through the same parser the spawn uses, so a line the parser rejects cannot
 * survive as a duplicate.
 */
export function withEnvValues(config: HarnessConfig, values: Record<string, string>): HarnessConfig {
  if (Object.keys(values).length === 0) return config;
  const { env } = parseEnvLines(config.env);
  const merged = { ...env, ...values };
  return {
    ...config,
    env: Object.entries(merged).map(([key, value]) => `${key}=${value}`).join('\n'),
  };
}

/**
 * Which model value a harness should start on, from its config and the models
 * the agent published.
 *
 * Exact `model` wins when the agent still lists it — a model the agent dropped
 * must not be written, so a stale default falls through instead of failing the
 * spawn. Otherwise the first model of the configured PROVIDER. Otherwise null:
 * the agent's own default, which is what an empty config means.
 */
export function resolveDefaultModel(
  config: HarnessConfig,
  models: readonly { value: string }[],
): string | null {
  if (config.model && models.some((option) => option.value === config.model)) return config.model;
  if (config.provider) {
    const fromProvider = models.find((option) => modelProvider(option.value) === config.provider);
    if (fromProvider) return fromProvider.value;
  }
  return null;
}

/** Every provider the agent's model list mentions, in the order it published. */
export function providerChoices(models: readonly { value: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of models) {
    const provider = modelProvider(option.value);
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

/** A config with nothing set, for a harness the user never configured. */
export function isHarnessConfigured(config: HarnessConfig): boolean {
  return Object.values(config).some((value) => value.trim() !== '');
}

/** The key a harness's config lives under in `app_settings`. */
export function harnessConfigKey(id: HarnessId): string {
  return `omp_harness_config:${id}`;
}
