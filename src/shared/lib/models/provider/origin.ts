/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the panel names a provider's credential origin.
 *
 * The four values mirror omp's own `/login` selector (`--api-key`, `config`,
 * `login`, `api key`, `env`) folded to the ones that change what the panel may
 * offer — and the fold is the point: `environment` and `models.yml` have
 * NOTHING in omp's credential store, so `sign out` cannot remove them, while
 * `login` and `api-key` are exactly what it removes. Offering the control
 * everywhere made it a button whose only outcome was a failure on half the
 * providers.
 *
 * Shared (not server-only) because the dialog labels and the registry both need
 * the same words, and two copies is how one of them drifts.
 */

import type { ProviderCredentialOrigin } from '@/shared/types/settings/provider';

/** The label a provider row prints. */
export function credentialOriginLabel(origin: ProviderCredentialOrigin | undefined): string {
  switch (origin) {
    case 'models.yml': return 'models.yml key';
    case 'login': return 'OAuth login';
    case 'api-key': return 'stored API key';
    case 'environment': return 'environment variable';
    default: return 'no credential';
  }
}

/**
 * True when `sign out` can do anything.
 *
 * `models.yml` is deliberately false: its key lives in the provider entry this
 * panel edits, so removing it is the editor's job (clear the field), not a
 * credential-store deletion. `environment` is false because there is nothing on
 * disk to delete.
 */
export function canSignOut(origin: ProviderCredentialOrigin | undefined): boolean {
  return origin === 'login' || origin === 'api-key';
}

/**
 * Which connection controls a provider offers — and it can be BOTH.
 *
 * A provider is two independent facts, and the panel used to collapse them into
 * one button:
 *
 * - **login** — omp's own `/login` flow can sign it in. Offered when it is an
 *   OAuth provider, is not declared keyless, and no `models.yml` key shadows the
 *   credential (a file entry with `auth: apiKey` is what omp uses, so a login
 *   there would be stored and then ignored).
 * - **edit** — it has a `models.yml` entry, whose endpoint, credential and
 *   dialect are writable in place.
 *
 * A provider can be both: an Anthropic override pointing at a proxy carries an
 * entry AND is signed in through OAuth. Offering only the editor made the sign-in
 * flow unreachable for exactly those providers; offering only sign-in hid the
 * entry. The panel draws one button per available control.
 *
 * Neither is offered for a provider omp DISCOVERED from an endpoint (a keyless
 * local server, a search backend): no login flow, no entry. The editor used to
 * open there and refuse with "add the provider first", so the button says why
 * instead.
 */
export interface ConnectOffers {
  login: boolean;
  edit: boolean;
  /** Why neither is available, when neither is. */
  reason?: string;
}

export function connectOffers(provider: {
  oauth?: boolean;
  inModelsYml?: boolean;
  auth?: string;
  credentialOrigin?: string;
}): ConnectOffers {
  const login = provider.oauth === true
    && provider.auth !== 'none'
    // A models.yml key wins over a stored login, so a login here would be
    // written and then shadowed — a button whose effect nothing reads.
    && provider.credentialOrigin !== 'models.yml';
  const edit = provider.inModelsYml === true;
  if (login || edit) return { login, edit };
  return {
    login: false,
    edit: false,
    reason: 'omp discovers this provider itself — its models come from its own endpoint, so there is no login flow and no entry to edit.',
  };
}
