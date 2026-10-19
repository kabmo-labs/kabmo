/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TLS for Kabmo's own listener.
 *
 * Without it, a UI password is close to decorative on a network: the login POST
 * carries the password in cleartext, and every later request carries the session
 * cookie the same way. Anything able to read a packet — another device on the
 * Wi-Fi, an ARP-spoofing neighbour — reads both. Measured before this existed:
 * a raw TCP capture of `POST /api/auth/login` showed `{"password":"…"}` verbatim.
 *
 * The certificate is SELF-SIGNED and generated once, on first use. That is the
 * honest option for a single-user console: a public CA cannot issue for
 * `192.168.x.x`, and asking for a domain would be a deployment project. The
 * browser therefore shows a warning the first time, which is the trade — a
 * deliberate click instead of a silent cleartext password. The certificate's SAN
 * lists `localhost`, `127.0.0.1` and the machine's LAN address, so the warning is
 * about trust rather than a name mismatch.
 *
 * `openssl` is used rather than a JS X.509 writer: it is present on every macOS
 * and virtually every Linux install, and hand-rolling certificate encoding would
 * be far more code than the one command it replaces. When it is missing, the
 * failure names the flag that avoids the whole path.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { getDataDir } from '@/server/lib/lifecycle/paths';

/**
 * argv flag that turns TLS on for this run.
 *
 * argv rather than env, for the reason `lifecycle/launch-mode.ts` records for its
 * own flag: env is inherited by every descendant, so a `bun run dev` started
 * inside Kabmo's terminal would silently inherit the choice.
 */
export const TLS_FLAG = '--tls';

/** Whether this process was started with TLS requested. */
export function isTlsEnabledByArgv(argv: readonly string[] = Bun.argv): boolean {
  return argv.includes(TLS_FLAG);
}

/** Directory holding the generated certificate pair. */
export function getTlsDir(): string {
  return path.join(getDataDir(), 'tls');
}

export function getTlsCertPath(): string {
  return path.join(getTlsDir(), 'cert.pem');
}

export function getTlsKeyPath(): string {
  return path.join(getTlsDir(), 'key.pem');
}

/**
 * The addresses the certificate should be valid for: loopback under both names a
 * browser may use, plus every non-internal IPv4 address so a LAN client sees a
 * name match rather than a mismatch on top of the self-signed warning.
 */
function subjectAltNames(): string[] {
  const names = new Set(['DNS:localhost', 'IP:127.0.0.1', 'IP:::1']);
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) names.add(`IP:${entry.address}`);
      }
    }
  } catch {
    // A host that cannot enumerate interfaces still gets the loopback names.
  }
  return [...names];
}

export interface EnsureTlsResult {
  ok: boolean;
  certPath: string;
  keyPath: string;
  /** Why it failed, when `ok` is false. */
  error?: string;
  /** True when this call created the pair rather than reusing one. */
  generated: boolean;
}

/**
 * The certificate pair, generating it on first use.
 *
 * Reuses an existing pair unconditionally: regenerating would silently invalidate
 * the exception a browser already has stored, which is worse than a stale SAN for
 * an address the machine no longer has.
 */
export function ensureTlsCertificate(): EnsureTlsResult {
  const certPath = getTlsCertPath();
  const keyPath = getTlsKeyPath();

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { ok: true, certPath, keyPath, generated: false };
  }

  const openssl = Bun.which('openssl');
  if (!openssl) {
    return {
      ok: false,
      certPath,
      keyPath,
      generated: false,
      error: 'openssl was not found on PATH, so a certificate cannot be generated.\n'
        + '  Install it, or run without --tls (plain HTTP — do not use that on a network).',
    };
  }

  try {
    fs.mkdirSync(getTlsDir(), { recursive: true, mode: 0o700 });
  } catch (error) {
    return {
      ok: false,
      certPath,
      keyPath,
      generated: false,
      error: `Could not create ${getTlsDir()}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = Bun.spawnSync({
    cmd: [
      openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '3650',
      '-subj', '/CN=Kabmo',
      // One SAN entry per name; openssl rejects a duplicate list.
      '-addext', `subjectAltName=${subjectAltNames().join(',')}`,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0 || !fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    const detail = result.stderr.toString().trim().split('\n').slice(-3).join('\n');
    return {
      ok: false,
      certPath,
      keyPath,
      generated: false,
      error: `openssl could not generate a certificate${detail ? `:\n${detail}` : '.'}`,
    };
  }

  // The key is private to this user; the certificate is public and may be
  // imported into a device's trust store, so it stays world-readable.
  try {
    fs.chmodSync(keyPath, 0o600);
    fs.chmodSync(certPath, 0o644);
  } catch {
    // Best-effort: the umask already limits these on most systems.
  }

  return { ok: true, certPath, keyPath, generated: true };
}
