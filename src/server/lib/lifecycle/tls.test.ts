/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * TLS certificate preparation.
 *
 * The behaviours that matter are the ones whose absence is invisible until it is
 * too late: a certificate that is not reused (silently invalidating the browser
 * exception the user already accepted), and a private key that is world-readable.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testPosix } from '@/test-support/platform';

import { ensureTlsCertificate, getTlsCertPath, getTlsKeyPath, isTlsEnabledByArgv, TLS_FLAG } from '@/server/lib/lifecycle/tls';

let tempDir: string;
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-tls-test-'));
  Bun.env.KABMO_DATA_DIR = tempDir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the tls flag', () => {
  test('is recognized only as the exact flag', () => {
    expect(isTlsEnabledByArgv(['bun', 'index.ts', TLS_FLAG])).toBe(true);
    expect(isTlsEnabledByArgv(['bun', 'index.ts'])).toBe(false);
    expect(isTlsEnabledByArgv(['bun', '--tls-verify'])).toBe(false);
  });
});

describe('ensureTlsCertificate', () => {
  test('generates a usable pair on first call', () => {
    const result = ensureTlsCertificate();

    expect(result.ok).toBe(true);
    expect(result.generated).toBe(true);
    expect(fs.existsSync(result.certPath)).toBe(true);
    expect(fs.existsSync(result.keyPath)).toBe(true);

    // A certificate the runtime cannot parse is not a certificate. Read it back
    // through `node:crypto` rather than `openssl x509 -ext`: the `-ext` flag is
    // OpenSSL 1.1.1+, and macOS ships LibreSSL 3.3.6 on PATH, where the flag is
    // rejected as an unknown option — a red test that says nothing about the pair.
    const parsed = new X509Certificate(fs.readFileSync(result.certPath));
    const san = parsed.subjectAltName ?? '';
    // Loopback under both names a browser may use, or the warning is a name
    // mismatch on top of the self-signed warning.
    expect(san).toContain('DNS:localhost');
    expect(san).toContain('IP Address:127.0.0.1');
  });

  test('reuses an existing pair rather than regenerating it', () => {
    const first = ensureTlsCertificate();
    const firstCert = fs.readFileSync(first.certPath, 'utf8');

    const second = ensureTlsCertificate();

    expect(second.generated).toBe(false);
    // Regenerating would invalidate the exception a browser already stored,
    // which is worse than a certificate with a stale address in its SAN.
    expect(fs.readFileSync(second.certPath, 'utf8')).toBe(firstCert);
  });

  // Windows has no POSIX permission bits: `statSync().mode & 0o777` reports a
  // synthesised 0o666/0o444, so nothing about the private key's 0600 can be
  // asserted there. The pair's usability and reuse are covered by the cases above.
  testPosix('the key is private to this user and the certificate is shareable', () => {
    const result = ensureTlsCertificate();

    const keyMode = fs.statSync(result.keyPath).mode & 0o777;
    const certMode = fs.statSync(result.certPath).mode & 0o777;
    // A world-readable private key is the whole TLS layer given away.
    expect(keyMode & 0o077).toBe(0);
    // The certificate is meant to be imported into a device trust store.
    expect(certMode & 0o044).not.toBe(0);
  });

  test('the paths live under the data directory, not the source tree', () => {
    expect(getTlsCertPath().startsWith(tempDir)).toBe(true);
    expect(getTlsKeyPath().startsWith(tempDir)).toBe(true);
    expect(getTlsCertPath()).not.toContain(`${os.homedir()}${path.sep}.kabmo`);
  });
});
