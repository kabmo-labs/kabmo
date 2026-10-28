/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The credential-origin rules, which decide what the panel may offer.
 *
 * Each assertion is a way the panel lied before: a login provider reported as
 * `omp auth credentials` whatever store it came from, and `sign out` offered on
 * a provider whose credential is an environment variable — where the only
 * possible outcome is a failure.
 */

import { describe, expect, test } from 'bun:test';
import {
  resolveCredentialOrigin,
  type AgentDbCredentialIndex,
} from '@/server/lib/models/credential-origin.server';
import { canSignOut, connectOffers, credentialOriginLabel } from '@/shared/lib/models/provider/origin';

function index(apiKey: string[] = [], oauth: string[] = []): AgentDbCredentialIndex {
  return { apiKey: new Set(apiKey), oauth: new Set(oauth) };
}

const base = {
  slug: 'anthropic',
  authenticated: false,
  inModelsYml: false,
  hasModelsYmlKey: false,
  credentials: index(),
};

describe('resolveCredentialOrigin', () => {
  test('a models.yml key wins over a stored credential', () => {
    // The file is what the user edits in this panel; reporting `api key` would
    // hide the entry's own key behind a store they cannot see.
    expect(resolveCredentialOrigin({
      ...base,
      hasModelsYmlKey: true,
      credentials: index(['anthropic'], ['anthropic']),
    })).toBe('models.yml');
  });

  test('an OAuth credential is named as a login', () => {
    expect(resolveCredentialOrigin({ ...base, credentials: index([], ['anthropic']) })).toBe('login');
  });

  test('an api-key credential is named as such', () => {
    expect(resolveCredentialOrigin({ ...base, credentials: index(['anthropic']) })).toBe('api-key');
  });

  test('an authenticated provider with nothing stored is the environment', () => {
    // omp resolves ANTHROPIC_API_KEY and friends, which no store on disk names.
    expect(resolveCredentialOrigin({ ...base, authenticated: true })).toBe('environment');
  });

  test('an unauthenticated provider with nothing stored has no origin', () => {
    expect(resolveCredentialOrigin(base)).toBeUndefined();
  });

  test('the slug is matched case-insensitively', () => {
    expect(resolveCredentialOrigin({
      ...base,
      slug: 'Anthropic',
      credentials: index([], ['anthropic']),
    })).toBe('login');
  });
});

describe('canSignOut', () => {
  test('only the two stored kinds can be removed', () => {
    expect(canSignOut('login')).toBe(true);
    expect(canSignOut('api-key')).toBe(true);
    // A models.yml key is removed by clearing the field in the entry editor;
    // an environment credential has nothing on disk at all.
    expect(canSignOut('models.yml')).toBe(false);
    expect(canSignOut('environment')).toBe(false);
    expect(canSignOut(undefined)).toBe(false);
  });
});

describe('credentialOriginLabel', () => {
  test('every origin has its own words', () => {
    const labels = [
      credentialOriginLabel('models.yml'),
      credentialOriginLabel('login'),
      credentialOriginLabel('api-key'),
      credentialOriginLabel('environment'),
      credentialOriginLabel(undefined),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('connectOffers', () => {
  test('an OAuth provider with no file entry signs in', () => {
    expect(connectOffers({ oauth: true })).toMatchObject({ login: true, edit: false });
    expect(connectOffers({ oauth: true, inModelsYml: false })).toMatchObject({ login: true, edit: false });
  });

  test('a models.yml entry is edited in place', () => {
    expect(connectOffers({ inModelsYml: true })).toMatchObject({ login: false, edit: true });
  });

  test('a provider that is BOTH offers both, because both writes are real', () => {
    // An Anthropic override pointing at a proxy: an OAuth login AND a file
    // entry. One button made whichever lost unreachable.
    expect(connectOffers({ oauth: true, inModelsYml: true, auth: 'oauth' }))
      .toMatchObject({ login: true, edit: true });
  });

  test('a file key that shadows the login removes the sign-in button', () => {
    // omp resolves the entry's apiKey first, so a login stored here would be
    // written and then ignored.
    expect(connectOffers({ oauth: true, inModelsYml: true, credentialOrigin: 'models.yml' }))
      .toMatchObject({ login: false, edit: true });
  });

  test('a keyless provider has no login flow to complete', () => {
    expect(connectOffers({ oauth: true, auth: 'none' })).toMatchObject({ login: false, edit: false });
    expect(connectOffers({ oauth: true, auth: 'none', inModelsYml: true }))
      .toMatchObject({ login: false, edit: true });
  });

  test('a discovered provider offers nothing, with the reason', () => {
    const offers = connectOffers({});
    expect(offers.login).toBe(false);
    expect(offers.edit).toBe(false);
    expect(offers.reason).toContain('discovers this provider');
  });
});
