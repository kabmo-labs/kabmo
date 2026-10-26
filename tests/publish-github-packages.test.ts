/**
 * The GitHub Packages publish path, asserted.
 *
 * Two classes of failure are covered, and neither is visible from reading the
 * workflow:
 *
 *  1. A change to a MANIFEST or to an existing publish step could silently
 *     redirect the release pipeline to GitHub Packages. That registry refuses
 *     anonymous reads for every package, public ones included, so
 *     `kabmo update` (`registry.npmjs.org/@kabmo-labs%2fkabmo/latest`), a plain
 *     `bun add -g @kabmo-labs/kabmo`, and the plugin installer's credential-less
 *     `bun install` would all answer 401 for every user. `publishConfig.registry`
 *     is the one field that would do it, and the app's own `release.yml` must
 *     never call this workflow.
 *
 *  2. The script's three-way answer — "already published", "not published yet",
 *     "the credential was refused" — because two of those look identical to a
 *     shell pipeline. Measured: with the check written as a pipeline, a 401 fell
 *     through to the publish and only failed there, one step later and with the
 *     registry's message instead of the actionable one.
 *
 * The script is driven against a STUB registry, not the real one: the skip and
 * refuse branches are unreachable against `npm.pkg.github.com` without
 * credentials, and a test that needed them would not run anywhere.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const SCRIPT = join(ROOT, '.github/scripts/publish-github-packages.sh');
const TOKEN = 'good-token';

/**
 * The script is bash, and `bun test` runs the whole suite on the Windows runner
 * too (`gates.yml`). Git Bash is on that image's PATH, so this is a guard
 * against a runner that lacks it rather than an expected skip — the same shape
 * `install.server.test.ts` uses for `git`.
 */
const hasBash = Boolean(Bun.which('bash'));

/** A registry that keeps versions, refuses a bad token, and records the calls. */
interface StubRegistry {
  server: Bun.Server<unknown>;
  versions: Map<string, string[]>;
  calls: string[];
}

function startRegistry(): StubRegistry {
  const versions = new Map<string, string[]>();
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const name = decodeURIComponent(url.pathname.slice(1));
      calls.push(`${request.method} ${name} auth=${request.headers.get('authorization') ?? 'none'}`);
      if (request.method === 'GET') {
        if (request.headers.get('authorization') !== `Bearer ${TOKEN}`) {
          return new Response('{"error":"unauthorized"}', { status: 401 });
        }
        const held = versions.get(name);
        if (!held) return new Response('{"error":"not found"}', { status: 404 });
        return Response.json({
          name,
          versions: Object.fromEntries(held.map((v) => [v, { name, version: v }])),
        });
      }
      if (request.method === 'PUT') {
        if (request.headers.get('authorization') !== `Bearer ${TOKEN}`) {
          return new Response('{"error":"bad token"}', { status: 401 });
        }
        const body = (await request.json()) as { versions?: Record<string, unknown> };
        const held = versions.get(name) ?? [];
        versions.set(name, [...held, ...Object.keys(body.versions ?? {})]);
        return Response.json({ ok: true });
      }
      return new Response('no', { status: 405 });
    },
  });
  return { server, versions, calls };
}

/** A two-package workspace in a temp directory, named like the real packages. */
function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'kabmo-ghp-'));
  for (const [name, version] of [
    ['@kabmo-labs/kabmo-sdk', '1.0.0'],
    ['@kabmo-labs/kabmo-ui', '2.0.0'],
  ]) {
    const dir = join(root, 'packages', name.split('/')[1]!);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, version, files: ['src'], publishConfig: { access: 'public' } }),
    );
    writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;\n');
  }
  return root;
}

let registry: ReturnType<typeof startRegistry>;
let workspace: string;

beforeAll(() => {
  registry = startRegistry();
  workspace = makeWorkspace();
});

afterAll(() => {
  registry.server.stop(true);
  rmSync(workspace, { recursive: true, force: true });
});

/** Run the script the way the workflow does, against the stub registry. */
async function run(dirs: string[], env: Record<string, string> = {}) {
  // ASYNC, not `Bun.spawnSync`: the stub registry is a `Bun.serve` in THIS
  // process, so a synchronous spawn would block the very event loop that has to
  // answer the script's requests — the script would hang on its first version
  // read and the suite would never finish.
  const child = Bun.spawn({
    cmd: ['bash', SCRIPT, ...dirs],
    cwd: workspace,
    env: {
      PATH: process.env.PATH ?? '',
      GH_PACKAGES_REGISTRY: `http://127.0.0.1:${registry.server.port}/`,
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

describe('the manifests and the release pipeline stay on npmjs.org', () => {
  test('no manifest pins a registry, so no publish is redirected by accident', async () => {
    // `publishConfig.registry` is honoured by `bun publish` above every other
    // setting, and it is read from the manifest rather than from the workflow —
    // so adding it is a one-line change that redirects the whole release and is
    // invisible in every workflow file. `access` is the field these manifests
    // legitimately carry, and it is asserted by `release/packages.test.js`.
    for (const file of ['package.json', 'packages/kabmo-sdk/package.json', 'packages/kabmo-ui/package.json']) {
      const manifest = (await Bun.file(join(ROOT, file)).json()) as { publishConfig?: Record<string, unknown> };
      expect(manifest.publishConfig?.registry, `${file} pins a publish registry`).toBeUndefined();
      for (const key of Object.keys(manifest.publishConfig ?? {})) {
        expect(key.endsWith(':registry'), `${file} pins a scoped publish registry (${key})`).toBe(false);
      }
    }
  });

  test('the release run never publishes here', async () => {
    // A release must not put a second copy of the packages on a registry that
    // cannot serve them anonymously: the update check reads npmjs.org, and this
    // workflow is a manual dispatch on purpose.
    const release = await Bun.file(join(WORKFLOWS, 'release.yml')).text();
    expect(release).not.toContain('publish-github-packages');

    const workflow = Bun.YAML.parse(
      await Bun.file(join(WORKFLOWS, 'publish-github-packages.yml')).text(),
    ) as Record<string, any>;
    expect(Object.keys(workflow.on ?? {}), 'a trigger other than a manual dispatch').toEqual(['workflow_dispatch']);
  });

  test('the workflow asks for the scope the registry authorizes on', async () => {
    // `GITHUB_TOKEN` carries package permissions only when the workflow asks for
    // them, and GitHub Packages authorizes a publish against the repository's
    // package permissions — so a missing `packages: write` is a 403 at the last
    // step of a gated run.
    const workflow = Bun.YAML.parse(
      await Bun.file(join(WORKFLOWS, 'publish-github-packages.yml')).text(),
    ) as Record<string, any>;
    expect(workflow.jobs.publish.permissions?.['packages']).toBe('write');
    const publishStep = (workflow.jobs.publish.steps as Array<any>).find((step) =>
      String(step.run ?? '').includes('publish-github-packages.sh'),
    );
    // A PAT, when configured, must WIN over the job token: `GITHUB_TOKEN` can
    // only publish to a package associated with THIS repository, and the 403 it
    // answers on a first publish (`The requested installation does not exist`)
    // names neither the cause nor the fix. Optional, so the documented path
    // (job token) still works with no secret set.
    const token = String(publishStep?.env?.GITHUB_TOKEN ?? '');
    expect(token, 'the script reads GITHUB_TOKEN').toContain('secrets.GITHUB_TOKEN');
    expect(token, 'a configured PAT must take precedence').toContain('secrets.GH_PACKAGES_TOKEN ||');
    expect(token.indexOf('GH_PACKAGES_TOKEN'), 'the PAT must be tried first').toBeLessThan(
      token.indexOf('secrets.GITHUB_TOKEN'),
    );
  });

  test('the app is built only when the app is in the target list', async () => {
    // `.` ships `dist/client`, which is gitignored — publishing it without the
    // build step would ship a package that starts and has no bundle to serve.
    const workflow = Bun.YAML.parse(
      await Bun.file(join(WORKFLOWS, 'publish-github-packages.yml')).text(),
    ) as Record<string, any>;
    const build = (workflow.jobs.publish.steps as Array<any>).find((step) =>
      String(step.run ?? '').includes('bun run build'),
    );
    expect(build, 'the app build step is missing').toBeDefined();
    expect(build.if, 'the app build must be conditional on the app being published').toContain(' . ');
  });
});

describe.skipIf(!hasBash)('the publish script answers the three states distinctly', () => {
  test('publishes both packages in order, then skips them on a re-run', async () => {
    const first = await run(['packages/kabmo-sdk', 'packages/kabmo-ui'], { GITHUB_TOKEN: TOKEN });
    expect(first.output).toContain('published @kabmo-labs/kabmo-sdk@1.0.0');
    expect(first.output).toContain('published @kabmo-labs/kabmo-ui@2.0.0');
    expect(first.exitCode).toBe(0);
    // Catalog order is load-bearing: the UI pins the SDK at the exact version.
    expect(first.output.indexOf('kabmo-sdk@1.0.0')).toBeLessThan(first.output.indexOf('kabmo-ui@2.0.0'));

    const second = await run(['packages/kabmo-sdk', 'packages/kabmo-ui'], { GITHUB_TOKEN: TOKEN });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('skip: @kabmo-labs/kabmo-sdk@1.0.0 is already on GitHub Packages');
    expect(second.output).not.toContain('publishing @kabmo-labs');
  });

  test('a refused credential STOPS the run before anything is published', async () => {
    // The measured bug this pins: a 401 read as "no versions published yet"
    // fell through to the publish, so the actionable message never appeared and
    // the failure surfaced one step later as the registry's own text.
    const before = registry.calls.length;
    const result = await run(['packages/kabmo-sdk'], { GITHUB_TOKEN: 'wrong' });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('refused the credential');
    expect(result.output).toContain('refusing to publish');
    expect(result.output).not.toContain('bun publish');
    // Exactly one call, and it is the version read: nothing reached the publish.
    const attempted = registry.calls.slice(before);
    expect(attempted.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('a missing token, an unscoped name and a missing directory are refused', async () => {
    const noToken = await run(['packages/kabmo-sdk']);
    expect(noToken.exitCode).not.toBe(0);
    expect(noToken.output).toContain('GITHUB_TOKEN is required');

    const missing = await run(['packages/does-not-exist'], { GITHUB_TOKEN: TOKEN });
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain('has no package.json');

    const noArgs = await run([], { GITHUB_TOKEN: TOKEN });
    expect(noArgs.exitCode).toBe(2);
    expect(noArgs.output).toContain('usage:');
  });

  test('an unscoped or uppercase name is refused before the network is touched', async () => {
    // GitHub Packages accepts only lowercase scoped names, and its refusal names
    // the name but never the rule — so the rule is checked here.
    const dir = join(workspace, 'packages/kabmo-ui');
    const original = await Bun.file(join(dir, 'package.json')).text();
    const manifest = JSON.parse(original);

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, name: 'kabmo-ui' }));
    const unscoped = await run(['packages/kabmo-ui'], { GITHUB_TOKEN: TOKEN });
    expect(unscoped.exitCode).toBe(1);
    expect(unscoped.output).toContain('is not a scoped name');

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, name: '@Kabmo-Labs/UI' }));
    const upper = await run(['packages/kabmo-ui'], { GITHUB_TOKEN: TOKEN });
    expect(upper.exitCode).toBe(1);
    expect(upper.output).toContain('must be lowercase');

    writeFileSync(join(dir, 'package.json'), original);
  });

  test('a dry run reports without publishing', async () => {
    const dir = join(workspace, 'packages/kabmo-ui');
    const original = await Bun.file(join(dir, 'package.json')).text();
    const manifest = JSON.parse(original);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, version: '9.9.9' }));

    const before = registry.calls.length;
    const result = await run(['packages/kabmo-ui'], { GITHUB_TOKEN: TOKEN, GH_PACKAGES_DRY_RUN: '1' });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('dry-run: would publish @kabmo-labs/kabmo-ui@9.9.9');
    expect(registry.calls.slice(before).some((call) => call.startsWith('PUT '))).toBe(false);

    writeFileSync(join(dir, 'package.json'), original);
  });

  test('a 403 names both causes instead of echoing the registry text', async () => {
    // GitHub Packages answers a first publish with `403 … The requested
    // installation does not exist` / `permission_denied: create_package`, which
    // names neither the cause nor the fix — and the two causes need different
    // repairs (a PAT, or a `repository` association). The raw text is still
    // printed above the explanation so the actual status is never hidden.
    const refusing = Bun.serve({
      port: 0,
      fetch: (request) =>
        request.method === 'GET'
          ? new Response('{"error":"not found"}', { status: 404 })
          : Response.json(
              { error: 'Permission permission_denied: The requested installation does not exist.' },
              { status: 403 },
            ),
    });
    try {
      const child = Bun.spawn({
        cmd: ['bash', SCRIPT, 'packages/kabmo-sdk'],
        cwd: workspace,
        env: {
          PATH: process.env.PATH ?? '',
          GITHUB_TOKEN: TOKEN,
          GH_PACKAGES_REGISTRY: `http://127.0.0.1:${refusing.port}/`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const output = `${stdout}${stderr}`;
      expect(exitCode).toBe(1);
      expect(output, 'the registry text must still be shown').toContain('permission_denied');
      expect(output, 'the PAT fix must be named').toContain('GH_PACKAGES_TOKEN');
      expect(output, 'the association fix must be named').toContain("'repository' field");
    } finally {
      refusing.stop(true);
    }
  });
});
