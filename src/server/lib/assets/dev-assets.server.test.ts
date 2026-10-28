/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { devAssetUpstreamPath, rewriteDevAssetUrls } from '@/server/lib/assets/dev-assets.server';

describe('rewriteDevAssetUrls', () => {
  test('moves the bundle and the assets to the proxied prefix', () => {
    const html = '<script src="/_bun/client/index-abc.js"></script><link href="/_bun/asset/x.css">';
    expect(rewriteDevAssetUrls(html)).toBe(
      '<script src="/_dev-assets/client/index-abc.js"></script><link href="/_dev-assets/asset/x.css">',
    );
  });

  // The HMR client dials `/_bun/hmr` from the bundle and the beacon posts to
  // `/_bun/unref`; both are Bun's own routes and must stay where Bun serves them.
  test('leaves the HMR socket and the unref beacon on Bun', () => {
    const html = '<script>new WebSocket("/_bun/hmr");navigator.sendBeacon("/_bun/unref")</script>';
    expect(rewriteDevAssetUrls(html)).toBe(html);
  });
});

describe('devAssetUpstreamPath', () => {
  test('maps a proxied asset back to the path Bun serves', () => {
    expect(devAssetUpstreamPath('/_dev-assets/client/index-abc.js')).toBe('/_bun/client/index-abc.js');
    expect(devAssetUpstreamPath('/_dev-assets/asset/x.css')).toBe('/_bun/asset/x.css');
  });

  test('claims nothing outside its prefix', () => {
    expect(devAssetUpstreamPath('/_bun/client/index-abc.js')).toBeNull();
    expect(devAssetUpstreamPath('/fonts.css')).toBeNull();
    expect(devAssetUpstreamPath('/')).toBeNull();
  });

  // A prefix match alone is not enough: `/_bun/hmr` is a WebSocket upgrade and
  // must never be proxied through a normal request handler.
  test('refuses a Bun path that is not a page-load asset', () => {
    expect(devAssetUpstreamPath('/_dev-assets/hmr')).toBeNull();
    expect(devAssetUpstreamPath('/_dev-assets/unref')).toBeNull();
  });
});
