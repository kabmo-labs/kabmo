/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { normalizeBaseUrl } from '@/shared/lib/net/base-url';

describe('normalizeBaseUrl', () => {
  test('accepts http(s) and strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
    expect(normalizeBaseUrl('  http://127.0.0.1:8000/v1  ')).toBe('http://127.0.0.1:8000/v1');
  });

  test('refuses a scheme the server would not fetch', () => {
    expect(normalizeBaseUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeBaseUrl('ftp://example.com')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
    expect(normalizeBaseUrl('')).toBeNull();
  });

  test('refuses embedded credentials, which would be forwarded silently', () => {
    expect(normalizeBaseUrl('https://user:pass@example.com/v1')).toBeNull();
  });
});
