/**
 * npm registry reads for the update check.
 *
 * npm is where both targets are actually published, and therefore the version an
 * install can move to: `kabmo update` runs `bun add -g @kabmo-labs/kabmo@<version>`,
 * and omp's own `omp update --check` resolves its metadata from the registry too
 * (verified against omp 18.6.0 with a header-recording stub: the check issued
 * exactly one request, `<registry>/@oh-my-pi%2fpi-coding-agent/latest`). Reading
 * the same channel the install comes from is what makes the reported version the
 * one that can be installed — the GitHub Releases API answered a different
 * question, and needed a token above 60 reads an hour plus a `gh` CLI fallback
 * when it answered nothing at all.
 *
 * One request per check: `/<pkg>/latest` is a single version manifest (~3 KB for
 * kabmo, ~16 KB for omp), where the packument is the whole publish history
 * (139 KB and 7 MB respectively). The release RANGE is read from the repository's
 * CHANGELOG.md instead — see ./changelog-file.
 */

/** Where a package is published unless the environment redirects the read. */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

/**
 * The package the product ships as; asked FIRST.
 *
 * SCOPED, and that is not cosmetic: npm refuses the bare name `kabmo` with
 * `403 — Package name too similar to existing package karma` (verified against
 * the registry: the name is unclaimed, so it is a typo-squat guard rather than
 * an ownership conflict). `@kabmo-labs/kabmo` publishes fine, and the `bin`
 * stays `kabmo`, so the COMMAND a user types did not change — only the
 * specifier `bun add -g` resolves.
 */
export const KABMO_PACKAGE = '@kabmo-labs/kabmo';

/**
 * The package name before the rename — a read-only fallback.
 *
 * An install that predates the rename still has `ompchamber` on disk and npm
 * still serves it, so a copy that cannot find `kabmo` is offered the legacy
 * name rather than being told it is up to date. Nothing writes this name.
 */
export const LEGACY_PACKAGE = 'ompchamber';

/**
 * Which package an update installs, and its newest published version.
 *
 * The product was renamed from `ompchamber` to `kabmo`, and an install that
 * predates the rename must still be able to move: the new name is asked first,
 * and the old one is the fallback — but ONLY for an install that is still on
 * the old name. Asking the legacy package unconditionally made a fresh `kabmo`
 * install report `ompchamber@4.23.0` as an available update and offer to
 * install it, which is a downgrade of the package NAME: the rename would be
 * undone by the very check meant to complete it. Measured on this checkout:
 * `kabmo update --check` printed "New version available: 4.23.0".
 *
 * `installedName` is the package on disk (see `readInstalledPackageName`), and
 * `null` means it could not be read — in which case only the current name is
 * considered, because an unknown install is not evidence that it is the old one.
 *
 * Never throws; a registry outage answers `latest: null` and the caller words
 * that as a status note.
 */
export async function resolveUpdatePackage(
  installedName: string | null = null,
): Promise<{ name: string; latest: string | null }> {
  const current = await fetchNpmLatest(KABMO_PACKAGE);
  if (current) return { name: KABMO_PACKAGE, latest: current };
  if (installedName !== LEGACY_PACKAGE) return { name: KABMO_PACKAGE, latest: null };
  const legacy = await fetchNpmLatest(LEGACY_PACKAGE);
  return { name: LEGACY_PACKAGE, latest: legacy };
}

/** oh-my-pi's package name: what `omp update` itself resolves against. */
export const OMP_PACKAGE = '@oh-my-pi/pi-coding-agent';

/** A hung registry must not hold the check open; this is one small GET. */
const TIMEOUT_MS = 10_000;

/**
 * The registry this process resolves against. Both names are honoured because
 * Bun's own installer reads either, and a user who redirected one of them
 * expects the update check to look where their installs come from.
 */
export function npmRegistry(): string {
  const configured = Bun.env.NPM_CONFIG_REGISTRY ?? Bun.env.BUN_CONFIG_REGISTRY;
  const base = configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_REGISTRY;
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * The newest version npm serves for `pkg` at `tag`, or null when it cannot be
 * read. Never throws: the caller words a null as a status note, and a registry
 * outage must not become a 500 in the update check.
 *
 * Only the slash of a scoped name is escaped (`@scope%2fname`), which is what
 * omp's own registry client sends; the registry answers the fully-encoded
 * spelling (`%40scope%2Fname`) identically.
 */
export async function fetchNpmLatest(pkg: string, tag = 'latest'): Promise<string | null> {
  try {
    const response = await fetch(`${npmRegistry()}${pkg.replace('/', '%2f')}/${tag}`, {
      headers: { 'User-Agent': 'kabmo' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: unknown };
    return typeof data?.version === 'string' && data.version.length > 0 ? data.version : null;
  } catch {
    return null;
  }
}
