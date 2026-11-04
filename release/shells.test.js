/**
 * The shell catalog, asserted against the tree.
 *
 * The five shells share one bump job and one commit now, so the failure this
 * file guards against is a shell that is MISSING from the loop: its version
 * would stop moving, every artifact it publishes would keep the old number, and
 * an installed app would never be offered the fix. `SHELLS` is the only list the
 * runner walks, and `release/<shell>.test.js` owns each entry's own rules.
 *
 * The catalog is checked against `packages/*\/version.properties` rather than
 * against a second hand-written list: a new shell directory with a version file
 * is exactly the shape that must not be forgotten, and the comparison makes the
 * omission a test failure instead of a silent no-op.
 */
import { afterEach, expect, test, describe } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readVersionName as androidRead,
  replaceVersionLine as androidReplace,
} from './android.js';
import { bumpVersion } from './bump.js';
import { readVersionName as linuxRead, replaceVersionLine as linuxReplace } from './linux.js';
import { readVersionName as macosRead, replaceVersionLine as macosReplace } from './macos.js';
import { SHELLS, shellById } from './shells.js';
import { runShellBumps } from './shells-run.js';
import { repoRoot } from './packages.mjs';

const scratch = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** Every directory under `packages/` that declares a shell version. */
function versionFilesOnDisk() {
  return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/version.properties`)
    .filter((file) => existsSync(join(repoRoot, file)))
    .sort();
}

describe('the catalog covers every shell', () => {
  test('it lists exactly the directories that declare a shell version', () => {
    const catalogued = SHELLS.map((shell) => shell.versionFile).sort();

    expect(catalogued).toEqual(versionFilesOnDisk());
  });

  test('every id is unique and resolvable', () => {
    const ids = SHELLS.map((shell) => shell.id);

    expect(new Set(ids).size, 'two shells share an id').toBe(ids.length);
    for (const id of ids) {
      expect(shellById(id)?.id, `shellById(${id}) must resolve`).toBe(id);
    }
    expect(shellById('nope'), 'an unknown id must resolve to null').toBeNull();
  });

  test('every entry reads its own version file', () => {
    // The one fact a typo in the catalog would break: a `versionFile` pointing
    // at another shell's file would bump the wrong number and leave its own
    // stale.
    for (const shell of SHELLS) {
      const source = readFileSync(join(repoRoot, shell.versionFile), 'utf8');
      const version = shell.readVersionName(source);

      expect(version, `${shell.versionFile} must declare ${shell.key}`).toMatch(/^\d+\.\d+\.\d+/);
      expect(shell.dir, `${shell.id} must own the directory of its version file`).toBe(
        shell.versionFile.slice(0, shell.versionFile.lastIndexOf('/')),
      );
    }
  });
});

describe('the runner is wired into the release', () => {
  test('release.yml bumps the shells in one job and stages every version file', () => {
    const release = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');

    expect(release, 'the one runner must be what the workflow calls').toContain(
      'node release/release-shells.mjs',
    );

    // Every shell's file must be named in the staged list, and the per-shell
    // runners must not come back: one commit is the whole point.
    for (const shell of SHELLS) {
      expect(release, `${shell.versionFile} must be staged`).toContain(shell.versionFile);
      expect(release, `release-${shell.id}.mjs must be gone`).not.toContain(
        `node release/release-${shell.id}.mjs`,
      );
    }

    expect(release.match(/chore\(release\): bump the shells \(/g) ?? []).toHaveLength(1);
  });
});

describe('the runner bumps every shell in one pass, or none of them', () => {
  /** A scratch tree of version files; each entry declares `versionName`. */
  function makeTree(ids) {
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-shells-run-'));
    scratch.push(dir);
    for (const id of ids) {
      mkdirSync(join(dir, 'packages', id), { recursive: true });
      writeFileSync(join(dir, 'packages', id, 'version.properties'), `# shell\nversionName=1.0.0\n`);
    }
    return dir;
  }

  /** One catalog-shaped entry, with the real parser/rewriter for its shell. */
  function entry(id, { reader, writer }, commits = [{ hash: 'a', message: 'fix(x): y' }]) {
    return {
      id,
      dir: `packages/${id}`,
      key: 'versionName',
      versionFile: `packages/${id}/version.properties`,
      commitsSinceWatermark: () => commits,
      readVersionName: reader,
      replaceVersionLine: writer,
    };
  }

  const android = { reader: androidRead, writer: androidReplace };
  const linux = { reader: linuxRead, writer: linuxReplace };
  const macos = { reader: macosRead, writer: macosReplace };

  const deps = (root, shells, overrides = {}) => ({
    shells,
    root,
    analyze: async () => 'patch',
    bump: bumpVersion,
    read: (path) => readFileSync(path, 'utf8'),
    write: (path, text) => writeFileSync(path, text),
    ...overrides,
  });

  test('every shell is bumped and rewritten in ONE pass', async () => {
    const root = makeTree(['android', 'linux']);
    const shells = [entry('android', android), entry('linux', linux)];

    const result = await runShellBumps(deps(root, shells));

    expect(result.failed).toBe(false);
    expect(result.written.map((outcome) => outcome.shell.id)).toEqual(['android', 'linux']);
    for (const id of ['android', 'linux']) {
      expect(readFileSync(join(root, `packages/${id}/version.properties`), 'utf8')).toContain('versionName=1.0.1');
    }
  });

  test('a descriptor that cannot be read aborts the run before ANY write', async () => {
    // The invariant the five sequential jobs could not hold: `android` plans a
    // bump, `macos` cannot be read, and the tree must be left exactly as it was.
    const root = makeTree(['android', 'macos']);
    const broken = {
      ...entry('macos', macos),
      readVersionName: () => null,
    };

    const result = await runShellBumps(deps(root, [entry('android', android), broken]));

    expect(result.failed).toBe(true);
    expect(result.written).toEqual([]);
    expect(readFileSync(join(root, 'packages/android/version.properties'), 'utf8')).toContain(
      'versionName=1.0.0',
    );
    expect(result.outcomes.find((outcome) => outcome.shell.id === 'macos')?.status).toBe('failed');
  });

  test('a rewrite that throws fails the run instead of committing a partial set', async () => {
    const root = makeTree(['android']);
    const shells = [entry('android', android)];

    const result = await runShellBumps(
      deps(root, shells, {
        write: () => {
          throw new Error('disk full');
        },
      }),
    );

    expect(result.failed).toBe(true);
    expect(result.written).toEqual([]);
  });

  test('no commits since the watermark writes nothing and reports no bump', async () => {
    const root = makeTree(['android']);
    const shells = [entry('android', android, [])];

    const result = await runShellBumps(deps(root, shells));

    expect(result.failed).toBe(false);
    expect(result.written).toEqual([]);
    expect(result.outcomes[0].status).toBe('unchanged');
  });

  test('a docs-only range asks for no version bump', async () => {
    const root = makeTree(['android']);
    const shells = [entry('android', android)];

    const result = await runShellBumps(deps(root, shells, { analyze: async () => null }));

    expect(result.failed).toBe(false);
    expect(result.outcomes[0].status).toBe('no-bump');
    expect(readFileSync(join(root, 'packages/android/version.properties'), 'utf8')).toContain(
      'versionName=1.0.0',
    );
  });

  test('a dry run reports the bumps it would make and writes nothing', async () => {
    const root = makeTree(['android']);
    const shells = [entry('android', android)];

    const result = await runShellBumps(deps(root, shells, { dryRun: true }));

    expect(result.outcomes[0].next).toBe('1.0.1');
    expect(result.written).toEqual([]);
    expect(readFileSync(join(root, 'packages/android/version.properties'), 'utf8')).toContain(
      'versionName=1.0.0',
    );
  });
});
