/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The HTML bundle, in development only.
 *
 * `index.html` is the client's entrypoint: importing it makes Bun bundle the
 * page and register it as an HTML route, which is what injects the HMR client
 * and what `renderShell` fetches back. Production does not need it — the client
 * is built ahead of time by `scripts/build-client.ts` and the shell is read
 * from `dist/client/index.html` — and importing it there would drag the whole
 * client graph into the server build, which is exactly what prevents the client
 * from being code-split.
 *
 * The import is dynamic and guarded so the server build can mark `*.html`
 * external: the specifier survives into the bundle, and the branch that would
 * resolve it is never taken in production. A static import cannot work here —
 * it is evaluated at module load in every mode, so the server build would
 * bundle the client graph and production would resolve an HTML bundle it never
 * serves.
 */

import { DEV_ASSETS_ENABLED } from '@/server/lib/assets/dev-assets.server';

export const shellBundle = DEV_ASSETS_ENABLED
  ? (await import('@/../index.html')).default
  : null;
