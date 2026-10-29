import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import pkg from '@/../package.json';
import { isAuthEnabled } from '@/server/lib/auth/guard';
import { countOpenFileDescriptors } from '@/server/lib/lifecycle/fd-pressure';
import { resolveLaunchMode } from '@/server/lib/lifecycle/launch-mode';
import { isTrayEnabledByArgv } from '@/server/lib/lifecycle/argv-flags';
import { isTlsEnabledByArgv } from '@/server/lib/lifecycle/tls';
import { isMockMode } from '@/server/mock.server';
import { pluginPlatformReady } from '@/server/lib/plugins/loader.server';

const STARTED_AT = Date.now();
const STARTED_ISO = new Date(STARTED_AT).toISOString();

/**
 * GET /api/health — lightweight readiness probe for the `kabmo status` CLI.
 * Dependency-light by design: never touches the database and never throws.
 *
 * It does sweep the descriptor table (`countOpenFileDescriptors`, ~12 ms over
 * the real 61440-entry table; ~2 ms when capped at the old constant): a dev
 * server walks toward the descriptor ceiling where every `Bun.spawn` in the
 * process fails, and the sweep is the only way to say so *before* the terminal
 * panel, the omp child and git all break at once. Null where the host cannot
 * answer.
 */
export async function loader() {
  return json(
    {
      ok: true,
      service: 'kabmo',
      version: pkg.version,
      pid: process.pid,
      uptime: Math.round((Date.now() - STARTED_AT) / 10) / 100,
      startedAt: STARTED_ISO,
      mock: isMockMode(),
      runtime: 'bun',
      bun: Bun.version,
      // Identity of the listener itself, read by the CLI and by a starting
      // server deciding whether this port belongs to Kabmo: `mode` and
      // `launchMode` are what `status` prints, and the pair with `pid` is what
      // separates a dev server from a stale published build.
      mode: Bun.env.NODE_ENV === 'production' ? 'prod' : 'dev',
      launchMode: resolveLaunchMode(),
      port: Number(Bun.env.PORT) || 3000,
      host: Bun.env.HOST || 'localhost',
      // Whether a UI password is in force. `status` prints it beside the bind
      // address, so a LAN-bound instance with no password — reachable by anyone
      // on the network — is visible from the CLI instead of only from a browser.
      authEnabled: isAuthEnabled(),
      // Reported so discovery does not have to guess the scheme: `status` and
      // `findLiveInstance` read it to build the URL they print and probe.
      tls: isTlsEnabledByArgv(),
      // Whether the boot's plugin pass has finished. The listener answers before
      // it runs, so a client that reloads on "a different process answers" can
      // land in a server whose plugin halves are still loading; this is the fact
      // that lets it retry a `plugin_not_loaded` RPC instead of reporting it as
      // a plugin that is not running.
      pluginsReady: pluginPlatformReady(),
      // Whether this run raises a tray icon. Reported so discovery can carry it
      // into a replacement's argv: a restart is spawned by a different process,
      // and the flag is not recoverable from the running server any other way.
      tray: isTrayEnabledByArgv(),
      fds: countOpenFileDescriptors(),
    },
    { headers: NO_STORE_HEADERS },
  );
}
