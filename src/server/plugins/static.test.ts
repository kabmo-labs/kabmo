import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { servePublicAsset } from '@/server/plugins/static';

// `public/` is the only asset root now: the client bundle is served by Bun's own
// routing table (`/_bun/*` in dev, `/chunk-*` in production), so there is no
// second build-output root to fall back to.
const PUBLIC_DIR = join(mkdtempSync(join(tmpdir(), 'omp-static-')), 'public');
const ROOTS = [PUBLIC_DIR] as const;

beforeAll(() => {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_DIR, 'icon.svg'), '<svg id="public"/>');
  writeFileSync(join(PUBLIC_DIR, 'manifest.webmanifest'), '{"name":"Kabmo"}');
  writeFileSync(join(PUBLIC_DIR, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(PUBLIC_DIR, 'index.html'), '<!doctype html><title>shell</title>');
});

afterAll(() => {
  rmSync(PUBLIC_DIR, { recursive: true, force: true });
});

describe('servePublicAsset', () => {
  test('serves a public asset with its own content type', async () => {
    const response = await servePublicAsset('/icon.svg', ROOTS);
    expect(response?.headers.get('content-type')).toBe('image/svg+xml');
    expect(await response?.text()).toBe('<svg id="public"/>');
  });

  test('serves the web manifest and the service worker', async () => {
    expect((await servePublicAsset('/manifest.webmanifest', ROOTS))?.headers.get('content-type'))
      .toBe('application/manifest+json');
    // The service worker is only referenced from an inline script in the shell,
    // so the HTML loader never copies it — this route is what serves it.
    expect(await (await servePublicAsset('/sw.js', ROOTS))?.text()).toContain('addEventListener');
  });

  test('leaves the HTML shell to the SSR route', async () => {
    expect(await servePublicAsset('/index.html', ROOTS)).toBeNull();
  });

  test('keeps a sibling of the root unreachable', async () => {
    const outside = join(PUBLIC_DIR, '..', 'secret.txt');
    writeFileSync(outside, 'not an asset');
    expect(await servePublicAsset('/../secret.txt', ROOTS)).toBeNull();
    expect(await servePublicAsset('/%2e%2e/secret.txt', ROOTS)).toBeNull();
  });

  test('short-caches, because these filenames carry no content hash', async () => {
    const response = await servePublicAsset('/icon.svg', ROOTS);
    expect(response?.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  test('returns null for a missing asset so the request reaches the app', async () => {
    expect(await servePublicAsset('/nope.svg', ROOTS)).toBeNull();
  });
});
