/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The cloudflared config: where it is, what it says, and the copy cloudflared
 * actually runs.
 *
 * Two facts decide the tunnel's destination. The config path is a stored
 * preference (page), an environment override (`CLOUDFLARED_CONFIG`) or the
 * documented default; the ingress `service:` is what cloudflared dials, and it
 * must be THIS instance's port or a second Kabmo silently gets the first one's
 * traffic. `--url` cannot fix that — see `deriveCloudflaredRunConfig`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@kabmo-labs/kabmo-settings-store';

/** `app_settings` key holding the config path chosen on the Connect page. */
const CLOUDFLARE_CONFIG_KEY = 'connect.cloudflareConfigPath';

export interface CloudflaredConfig {
  /** The tunnel name or UUID from `tunnel:`. */
  tunnel: string | null;
  /** The first public hostname in the ingress list. */
  hostname: string | null;
}

/** Where cloudflared looks for its config, honouring the documented override. */
export function cloudflaredConfigPath(): string {
  const override = (Bun.env.CLOUDFLARED_CONFIG ?? '').trim();
  if (override) return override;
  return path.join(os.homedir(), '.cloudflared', 'config.yml');
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

/**
 * The config the Connect page and the start path agree on.
 *
 * A path saved on the page wins over `CLOUDFLARED_CONFIG`, which wins over
 * `~/.cloudflared/config.yml`. The page allows the override because a config
 * kept outside the home directory (a secret store, a work profile) is a normal
 * setup, and editing an environment variable before every start is not.
 */
export async function resolveCloudflaredConfigPath(): Promise<string> {
  const db = await getDb();
  const stored = await readSettingsJson<unknown>(db, CLOUDFLARE_CONFIG_KEY, null);
  if (typeof stored === 'string' && stored.trim()) return stored.trim();
  return cloudflaredConfigPath();
}

export interface SaveConfigOutcome {
  ok: boolean;
  /** The path now in effect, when the save succeeded. */
  path: string | null;
  reason: string | null;
}

/**
 * Persist a config path after proving cloudflared could run from it.
 *
 * A saved path that is missing or has no ingress hostname would put a dead
 * switch on the page, so the write is refused with the reason the reader can
 * act on. An empty string resets to the environment/default path.
 */
export async function saveCloudflaredConfigPath(raw: unknown): Promise<SaveConfigOutcome> {
  if (typeof raw !== 'string') {
    return { ok: false, path: null, reason: 'Expected a config path.' };
  }
  const db = await getDb();
  const trimmed = raw.trim();
  if (!trimmed) {
    await writeSettingsJson(db, CLOUDFLARE_CONFIG_KEY, null);
    return { ok: true, path: cloudflaredConfigPath(), reason: null };
  }

  const expanded = expandHome(trimmed);
  if (!path.isAbsolute(expanded)) {
    return { ok: false, path: null, reason: 'The config path must be absolute.' };
  }
  const resolved = path.resolve(expanded);
  let isFile = false;
  try {
    isFile = fs.statSync(resolved).isFile();
  } catch {
    return { ok: false, path: null, reason: `No config file at ${resolved}.` };
  }
  if (!isFile) {
    return { ok: false, path: null, reason: `${resolved} is not a file.` };
  }

  const config = readCloudflaredConfig(resolved);
  if (!config) {
    return {
      ok: false,
      path: null,
      reason: `${resolved} is not a cloudflared config: it has no tunnel: or ingress: entry.`,
    };
  }
  if (!config.hostname) {
    return {
      ok: false,
      path: null,
      reason: `The config at ${resolved} has no ingress hostname, so there is no public URL to show.`,
    };
  }

  await writeSettingsJson(db, CLOUDFLARE_CONFIG_KEY, resolved);
  return { ok: true, path: resolved, reason: null };
}

/**
 * Read the two facts this page needs out of the YAML.
 *
 * A line scan rather than a YAML parser: the file is written by
 * `cloudflared tunnel create` and by hand, and the only fields read here are a
 * top-level `tunnel:` and the first `hostname:` under `ingress:`. Pulling in a
 * parser for two scalars would be a dependency the rest of the server does not
 * have, and a malformed file must degrade to "not configured" rather than throw.
 */
export function readCloudflaredConfig(file: string): CloudflaredConfig | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let tunnel: string | null = null;
  let hostname: string | null = null;
  let inIngress = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (/^tunnel:\s*/.test(line)) {
      tunnel = line.replace(/^tunnel:\s*/, '').trim().replace(/^["']|["']$/g, '') || null;
      continue;
    }
    if (/^ingress:\s*$/.test(line)) {
      inIngress = true;
      continue;
    }
    if (inIngress && /^\S/.test(line)) {
      // A new top-level key ends the ingress block.
      inIngress = false;
    }
    if (inIngress && hostname === null) {
      const match = /^\s*-\s*hostname:\s*(\S+)/.exec(line) ?? /^\s*hostname:\s*(\S+)/.exec(line);
      if (match?.[1]) hostname = match[1].replace(/^["']|["']$/g, '');
    }
  }

  if (!tunnel && !hostname) return null;
  return { tunnel, hostname };
}

/**
 * The config cloudflared actually runs with, pointed at this instance's port.
 *
 * `--url` does NOT override an `ingress:` block: cloudflared parses the config's
 * rules first and only falls back to the CLI origin when `ingress` is empty
 * (`ingress.ParseIngressFromConfigAndCLI`). Kabmo refuses a config without an
 * ingress hostname, so every config it accepts would ignore `--url` and send
 * traffic to whatever `service:` names — often a different port or a different
 * app. The first rule that names a hostname therefore gets its `service:`
 * rewritten in a runtime copy; the user's file is never touched.
 *
 * Returns null when there is no ingress rule with a hostname to rewrite.
 */
export function deriveCloudflaredRunConfig(text: string, port: number): string | null {
  const lines = text.split('\n');
  const ingressAt = lines.findIndex((line) => /^ingress:\s*$/.test(line.replace(/\s+#.*$/, '')));
  if (ingressAt === -1) return null;

  // A new top-level key ends the ingress block.
  let end = lines.length;
  for (let i = ingressAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Only items at the first rule's indentation start a new rule; a nested
  // `ipRules:` list under `originRequest` must not cut the rule in two.
  const itemPattern = /^(\s*)-\s/;
  const items: Array<{ at: number; indent: string }> = [];
  for (let i = ingressAt + 1; i < end; i++) {
    const item = itemPattern.exec(lines[i]);
    if (item) items.push({ at: i, indent: item[1] });
  }
  if (items.length === 0) return null;
  const ruleIndent = items[0].indent;
  const starts = items.filter((item) => item.indent === ruleIndent).map((item) => item.at);

  const hostnamePattern = /^(\s*)(-\s*)?hostname:\s*(\S+)/;
  const servicePattern = /^(\s*)service:\s*/;
  for (let rule = 0; rule < starts.length; rule++) {
    const from = starts[rule];
    const to = rule + 1 < starts.length ? starts[rule + 1] : end;
    let hostnameAt = -1;
    for (let i = from; i < to; i++) {
      if (hostnamePattern.test(lines[i])) {
        hostnameAt = i;
        break;
      }
    }
    if (hostnameAt === -1) continue;

    const copy = lines.slice();
    for (let i = from; i < to; i++) {
      const service = servicePattern.exec(lines[i]);
      if (!service) continue;
      const cr = lines[i].endsWith('\r') ? '\r' : '';
      copy[i] = `${service[1]}service: http://127.0.0.1:${port}${cr}`;
      return copy.join('\n');
    }

    // The rule has a hostname but no service of its own: add one beside it.
    const hostname = hostnamePattern.exec(lines[hostnameAt]) as RegExpExecArray;
    const indent = hostname[1] + (hostname[2] ? '  ' : '');
    const cr = lines[hostnameAt].endsWith('\r') ? '\r' : '';
    copy.splice(hostnameAt + 1, 0, `${indent}service: http://127.0.0.1:${port}${cr}`);
    return copy.join('\n');
  }

  return null;
}
