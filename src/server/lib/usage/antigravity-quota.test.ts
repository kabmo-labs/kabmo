/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local Antigravity quota reader.
 *
 * Every fixture below is the shape measured on this machine on 2026-11-24, not
 * a documented one: the endpoint is the Antigravity CLI's own
 * (`retrieveUserQuotaSummary`), its credential lives in the OS keyring, and the
 * project id in a cache file. The cases that matter are the ones a wrong reader
 * gets silently:
 *
 *  - `remainingFraction` is REMAINING, so `usedFraction` is `1 - remaining`;
 *    printing it as-is shows "99,9% used" on an account that used 0,1%.
 *  - A bucket is one row per model FAMILY (`gemini-*` → Google, `3p-*` → the
 *    shared Claude/GPT bucket), because the panel groups by that second id
 *    segment.
 *  - The Antigravity credential is wrapped (`{ token: {...} }`) and the file
 *    value is keyring-encoded; a flat, unwrapped reader finds no token at all.
 */

import { describe, expect, test } from 'bun:test';

import {
  antigravityBucketFamily,
  antigravityWindow,
  antigravityWindows,
  decodeKeyringSecret,
  parseAntigravityCredential,
  parseAntigravityProject,
} from '@/server/lib/usage/antigravity-quota';

/** The live body from `daily-cloudcode-pa` (2026-11-24), shortened to what is read. */
const QUOTA_SUMMARY = {
  groups: [
    {
      buckets: [
        {
          bucketId: 'gemini-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          resetTime: '2026-12-01T00:31:01Z',
          description: 'You have used some of your weekly limit, it will fully refresh in 6 days, 10 hours.',
          remainingFraction: 0.99892914,
        },
        {
          bucketId: 'gemini-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          resetTime: '2026-11-24T18:49:31Z',
          remainingFraction: 1,
        },
      ],
      displayName: 'Gemini Models',
    },
    {
      buckets: [
        {
          bucketId: '3p-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          resetTime: '2026-12-01T13:49:31Z',
          remainingFraction: 1,
        },
        {
          bucketId: '3p-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          resetTime: '2026-11-24T18:49:31Z',
          remainingFraction: 1,
        },
      ],
      displayName: 'Claude and GPT models',
    },
  ],
  description: 'Within each group, models share a weekly limit and a 5-hour limit.',
};

describe('decodeKeyringSecret', () => {
  test('reads the go-keyring base64 envelope', () => {
    const value = `go-keyring-base64:${Buffer.from('{"token":{"access_token":"a"}}').toString('base64')}`;
    expect(decodeKeyringSecret(value)).toEqual({ token: { access_token: 'a' } });
  });

  test('accepts a plain JSON file, which is what the on-disk copy holds', () => {
    expect(decodeKeyringSecret('{"token":{"access_token":"a"}}')).toEqual({ token: { access_token: 'a' } });
  });

  test('garbage is null, never a throw inside a request', () => {
    expect(decodeKeyringSecret('')).toBeNull();
    expect(decodeKeyringSecret('go-keyring-base64:not base64 json')).toBeNull();
    expect(decodeKeyringSecret('<xml/>')).toBeNull();
  });
});

describe('parseAntigravityCredential', () => {
  test('the Antigravity bundle is read through its `token` wrapper', () => {
    const parsed = parseAntigravityCredential({
      token: {
        access_token: 'access',
        token_type: 'Bearer',
        refresh_token: 'refresh',
        expiry: '2026-11-24T21:32:31.3275+07:00',
        expires_in: 3599,
      },
      auth_method: 'consumer',
      id_token_email: 'user@example.com',
    });
    expect(parsed?.accessToken).toBe('access');
    expect(parsed?.refreshToken).toBe('refresh');
    expect(parsed?.expiresAt).toBe(Date.parse('2026-11-24T21:32:31.3275+07:00'));
  });

  test('the flat gemini-style file works too, with a millisecond expiry', () => {
    const parsed = parseAntigravityCredential({
      access_token: 'access',
      refresh_token: 'refresh',
      expiry_date: 1795529163236,
    });
    expect(parsed?.expiresAt).toBe(1795529163236);
  });

  test('a credential without an access token is not a credential', () => {
    expect(parseAntigravityCredential({})).toBeNull();
    expect(parseAntigravityCredential({ token: { refresh_token: 'r' } })).toBeNull();
    expect(parseAntigravityCredential({ token: { access_token: '   ' } })).toBeNull();
    expect(parseAntigravityCredential('access')).toBeNull();
    expect(parseAntigravityCredential(null)).toBeNull();
  });

  test('an unparseable expiry keeps the token usable instead of dropping it', () => {
    const parsed = parseAntigravityCredential({ access_token: 'access', expiry: 'soon' });
    expect(parsed?.accessToken).toBe('access');
    expect(parsed?.expiresAt).toBeUndefined();
  });
});

describe('parseAntigravityProject', () => {
  test('the cache file holds one project id', () => {
    expect(parseAntigravityProject('default-cli-project\n')).toBe('default-cli-project');
  });

  test('an empty or multi-token file is not a project', () => {
    expect(parseAntigravityProject(null)).toBeNull();
    expect(parseAntigravityProject('')).toBeNull();
    expect(parseAntigravityProject('   \n')).toBeNull();
    expect(parseAntigravityProject('two words')).toBeNull();
  });
});

describe('antigravityBucketFamily', () => {
  test('the live bucket ids map onto the panel groups', () => {
    expect(antigravityBucketFamily('gemini-weekly', 'Weekly Limit Remaining')).toBe('google');
    expect(antigravityBucketFamily('gemini-argon-5h', 'Five Hour Limit Remaining')).toBe('google-argon');
    expect(antigravityBucketFamily('3p-weekly', 'Weekly Limit Remaining')).toBe('anthropic');
  });

  test('a display name decides when the id says nothing', () => {
    expect(antigravityBucketFamily('', 'Gemini Models')).toBe('google');
    expect(antigravityBucketFamily('', 'Claude and GPT models')).toBe('anthropic');
    expect(antigravityBucketFamily('other', 'Something else')).toBe('default');
  });
});

describe('antigravityWindow', () => {
  test('the two windows the endpoint reports', () => {
    expect(antigravityWindow('weekly')).toEqual({ id: 'weekly', label: 'Weekly limit', windowLabel: '7d' });
    expect(antigravityWindow('5h')).toEqual({ id: '5h', label: '5-hour limit', windowLabel: '5h' });
  });

  test('the spellings seen in other builds still resolve', () => {
    expect(antigravityWindow('7d').id).toBe('weekly');
    expect(antigravityWindow('five hour').id).toBe('5h');
    expect(antigravityWindow('daily').id).toBe('daily');
    expect(antigravityWindow('monthly')).toEqual({ id: 'default', label: 'Quota limit' });
  });
});

describe('antigravityWindows', () => {
  test('the live summary becomes one row per family and window, remaining inverted', () => {
    const windows = antigravityWindows(QUOTA_SUMMARY);
    expect(windows.map((window) => window.id)).toEqual([
      // Worst first: 0,1% used outranks the untouched buckets.
      'google-antigravity:google:default:weekly',
      'google-antigravity:google:default:5h',
      'google-antigravity:anthropic:default:weekly',
      'google-antigravity:anthropic:default:5h',
    ]);
    const weekly = windows[0]!;
    expect(weekly.usedFraction).toBeCloseTo(1 - 0.99892914, 8);
    expect(weekly.remaining).toBeCloseTo(99.892914, 5);
    expect(weekly.limit).toBe(100);
    expect(weekly.unit).toBe('percent');
    expect(weekly.status).toBe('ok');
    expect(weekly.resetsAt).toBe(Date.parse('2026-12-01T00:31:01Z'));
    expect(weekly.windowLabel).toBe('7d');
    // The bucket's own note travels: it is the only place the endpoint
    // explains WHEN the weekly window refreshes in words.
    expect(weekly.notes?.[0]).toContain('refresh in 6 days');
  });

  test('the provider id in the row is the caller\u2019s, so a CLI slug keeps its own row', () => {
    const windows = antigravityWindows(QUOTA_SUMMARY, 'antigravity-cli');
    expect(windows.every((window) => window.id.startsWith('antigravity-cli:'))).toBe(true);
  });

  test('status follows the remaining fraction, not the used one', () => {
    const windows = antigravityWindows({
      groups: [{ buckets: [
        { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.05 },
        { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0 },
      ] }],
    });
    expect(windows.find((window) => window.id.endsWith(':5h'))?.status).toBe('warning');
    expect(windows.find((window) => window.id.endsWith(':weekly'))?.status).toBe('exhausted');
  });

  test('a bucket with no fraction still appears, as an unknown reading', () => {
    const windows = antigravityWindows({
      groups: [{ buckets: [{ bucketId: 'gemini-5h', window: '5h', displayName: 'Five Hour Limit Remaining' }] }],
    });
    expect(windows).toHaveLength(1);
    expect(windows[0]?.status).toBe('unknown');
    expect(windows[0]?.usedFraction).toBeUndefined();
    expect('remaining' in (windows[0] ?? {})).toBe(false);
  });

  test('a disabled bucket, an empty group and a malformed body contribute nothing', () => {
    expect(antigravityWindows({
      groups: [
        { buckets: [{ bucketId: 'gemini-5h', window: '5h', disabled: true }] },
        { buckets: [] },
        {},
      ],
    })).toEqual([]);
    expect(antigravityWindows(null)).toEqual([]);
    expect(antigravityWindows({ groups: 'nope' })).toEqual([]);
  });

  test('the same bucket in two groups is one row, not two identical readings', () => {
    const shared = { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.5 };
    const windows = antigravityWindows({
      groups: [{ buckets: [shared] }, { buckets: [{ ...shared }] }],
    });
    expect(windows).toHaveLength(1);
  });
});
