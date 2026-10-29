import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { servePublicAsset } from '@/server/plugins/static';

// `public/` is the only asset root now: the client bundle is served by Bun's own
// routing table (`/_bun/*` in dev, `/chunk-*` in production), so there is no
// second build-output root to fall back to.
const STATIC_ROOT = mkdtempSync(join(tmpdir(), 'omp-static-'));
const PUBLIC_DIR = join(STATIC_ROOT, 'public');
const ROOTS = [PUBLIC_DIR] as const;

beforeAll(() => {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_DIR, 'icon.svg'), '<svg id="public"/>');
  writeFileSync(join(PUBLIC_DIR, 'manifest.webmanifest'), '{"name":"Kabmo"}');
  writeFileSync(join(PUBLIC_DIR, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(PUBLIC_DIR, 'index.html'), '<!doctype html><title>shell</title>');
  // Above the compression floor, and compressible: the production bundle is the
  // asset this rule exists for, so a fixture too small to compress would pass
  // while every real client still downloaded 10 MB.
  writeFileSync(join(PUBLIC_DIR, 'bundle.js'), `const x = 1;\n${'// padding\n'.repeat(200)}`);
  writeFileSync(join(PUBLIC_DIR, 'photo.png'), new Uint8Array(2048));
});

afterAll(() => {
  // The mkdtemp PARENT, not `public/`: removing only the child left an empty
  // `omp-static-*` directory in `$TMPDIR` on every run (measured).
  rmSync(STATIC_ROOT, { recursive: true, force: true });
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

describe('servePublicAsset compression', () => {
  const accept = (encoding: string) =>
    new Request('http://127.0.0.1/bundle.js', { headers: { 'accept-encoding': encoding } });

  test('sends a compressible asset compressed, and says so', async () => {
    const response = await servePublicAsset('/bundle.js', ROOTS, accept('gzip, zstd'));
    expect(response?.headers.get('content-encoding')).toBe('zstd');
    expect(response?.headers.get('vary')).toBe('accept-encoding');
    // The declared length is the COMPRESSED one, or a client that trusts it
    // would wait for bytes that are never sent.
    const body = new Uint8Array(await response!.arrayBuffer());
    expect(Number(response?.headers.get('content-length'))).toBe(body.byteLength);
    expect(body.byteLength).toBeLessThan(2000);
  });

  // The body must decode back to the file's own bytes, not merely be smaller.
  test('the compressed body decompresses to the file', async () => {
    const response = await servePublicAsset('/bundle.js', ROOTS, accept('gzip'));
    const body = new Uint8Array(await response!.arrayBuffer());
    expect(Bun.gunzipSync(body)).toEqual(new Uint8Array(await Bun.file(join(PUBLIC_DIR, 'bundle.js')).arrayBuffer()));
  });

  test('a client that accepts nothing gets the raw bytes, with no Vary claim to honour', async () => {
    const response = await servePublicAsset('/bundle.js', ROOTS, new Request('http://127.0.0.1/bundle.js'));
    expect(response?.headers.get('content-encoding')).toBeNull();
    expect(response?.headers.get('vary')).toBe('accept-encoding');
    expect(Number(response?.headers.get('content-length'))).toBe(
      (await Bun.file(join(PUBLIC_DIR, 'bundle.js')).stat()).size,
    );
  });

  // A PNG compresses to itself, so buffering one to find that out is work that
  // buys nothing — and `Vary` would fragment its cache entry for no reason.
  test('leaves an already-compressed type alone', async () => {
    const response = await servePublicAsset('/photo.png', ROOTS, accept('gzip, zstd'));
    expect(response?.headers.get('content-encoding')).toBeNull();
    expect(response?.headers.get('vary')).toBeNull();
  });

  // The `304` must carry `Vary` too: a shared cache that stored the identity
  // variant would otherwise hand it to a client that accepts gzip.
  test('the 304 carries the same Vary as the body it stands in for', async () => {
    const first = await servePublicAsset('/bundle.js', ROOTS, accept('gzip'));
    const etag = first!.headers.get('etag')!;
    const second = await servePublicAsset(
      '/bundle.js',
      ROOTS,
      new Request('http://127.0.0.1/bundle.js', { headers: { 'accept-encoding': 'gzip', 'if-none-match': etag } }),
    );
    expect(second?.status).toBe(304);
    expect(second?.headers.get('vary')).toBe('accept-encoding');
  });
});
