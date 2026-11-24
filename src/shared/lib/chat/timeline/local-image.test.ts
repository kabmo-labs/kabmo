/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A chat answer names a generated picture as a path on this machine. The
 * renderer has to move that path off `src` (the browser would request
 * `/Users/…` from the app's origin or refuse `file:///…`) while keeping it in
 * the markup for the session image route.
 */

import { describe, expect, test } from 'bun:test';
import {
  localImageReference,
  localizeFileImageSources,
  markLocalImageSources,
  sessionImageUrl,
} from '@/shared/lib/chat/timeline/local-image';

describe('localImageReference', () => {
  test('accepts the shapes an agent writes', () => {
    expect(localImageReference('/Users/me/General/shot.jpg')).toBe('/Users/me/General/shot.jpg');
    expect(localImageReference('file:///Users/me/My%20Picture.png')).toBe('/Users/me/My Picture.png');
    expect(localImageReference('docs/hero.webp')).toBe('docs/hero.webp');
    expect(localImageReference('C:\\work\\shot.png')).toBe('C:\\work\\shot.png');
  });

  test('leaves URLs and non-pictures alone', () => {
    for (const source of [
      'https://x.test/a.png',
      '//cdn.test/a.png',
      'data:image/png;base64,AA',
      'blob:http://x/1',
      '/api/fs/raw?path=a.png',
      '#anchor',
      'photo.pdf',
      '',
    ]) {
      expect(localImageReference(source)).toBeNull();
    }
  });

  test('a file URL whose target is not a picture is not a preview', () => {
    expect(localImageReference('file:///tmp/report.pdf')).toBeNull();
  });
});

describe('markLocalImageSources', () => {
  test('moves a local src to the marker and keeps the rest of the tag', () => {
    const html = '<p><img alt="shot" src="/Users/me/General/shot.jpg" width="640"></p>';
    expect(markLocalImageSources(html)).toBe(
      '<p><img alt="shot" data-local-image="/Users/me/General/shot.jpg" width="640"></p>',
    );
  });

  test('a remote image keeps its src', () => {
    const html = '<img src="https://x.test/a.png">';
    expect(markLocalImageSources(html)).toBe(html);
  });

  test('every local image in one message is marked', () => {
    const html = '<img src="a.png"><img src="file:///tmp/b.png">';
    expect(markLocalImageSources(html)).toBe(
      '<img data-local-image="a.png"><img data-local-image="/tmp/b.png">',
    );
  });

  test('a file URL is localized before the sanitizer sees it', () => {
    expect(localizeFileImageSources('<img alt="shot" src="file:///tmp/a.png">')).toBe(
      '<img alt="shot" src="/tmp/a.png">',
    );
    expect(localizeFileImageSources('<img src="https://x.test/a.png">')).toBe(
      '<img src="https://x.test/a.png">',
    );
    expect(localizeFileImageSources('<img src="file:///tmp/report.pdf">')).toBe(
      '<img src="file:///tmp/report.pdf">',
    );
  });
});

describe('sessionImageUrl', () => {
  test('encodes both the session and the path', () => {
    expect(sessionImageUrl('s/1', '/Users/me/a b.png')).toBe(
      '/api/sessions/s%2F1/local-image?path=%2FUsers%2Fme%2Fa%20b.png',
    );
  });
});
