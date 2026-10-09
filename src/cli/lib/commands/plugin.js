// `ompchamber plugin <subcommand>` — build, type and scaffold panel plugins.
//
// The CLI's own entry to the SAME build the server runs, and that is the point:
// a plugin author must be able to run locally exactly what the chamber will run
// on install, or they are debugging a build they cannot see. `buildPanelPlugin`
// is imported from the server's own module rather than reimplemented here.
//
// `types` emits the SDK's declarations so a plugin outside this repository can
// typecheck without the chamber's source on disk — a fork has no `@/` alias and
// no `packages/`, and resolving the SDK's `.ts` directly is what a published
// package must never require.

import fs from 'node:fs';
import path from 'node:path';

import { error, fail, log, ok, printJson, isJson } from '@/cli/lib/output.js';
import { joinPath, resolvePath } from '@/cli/lib/path-utils.js';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import { discoverPanelPlugins } from '@/server/lib/panels/registry.server';

const SUBCOMMANDS = ['build', 'types', 'new', 'list'];

function usage() {
  return `Usage: ompchamber plugin <command> [options]

COMMANDS:
  build <dir>       Build a plugin's app and/or server bundle
  types <dir>       Write bundled SDK declarations into <dir>/bundled-types
  new <dir>         Scaffold a new plugin
  list              List installed plugins and their build state

OPTIONS:
  --json            Machine-readable output
`;
}

/**
 * Read a plugin's manifest, or fail with the reason it could not be read.
 */
function readManifest(dir) {
  const pkgPath = joinPath(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg && typeof pkg === 'object' ? pkg.ompchamber ?? null : null;
  } catch (cause) {
    fail(`Could not parse ${pkgPath}: ${cause.message}`);
  }
}

async function build(dir, ctx) {
  const target = resolvePath(ctx.cwd, dir ?? '.');
  if (!fs.existsSync(target)) fail(`No such directory: ${target}`);

  const manifest = readManifest(target);
  if (!manifest) fail(`${joinPath(target, 'package.json')} has no "ompchamber" manifest block`);

  const result = await buildPanelPlugin(target, manifest);

  if (isJson()) {
    printJson({ dir: target, ...result });
  } else if (result.status === 'built') {
    ok(`Built ${manifest.id} (${manifest.app ?? ''}${manifest.server ? `, ${manifest.server}` : ''})`);
  } else {
    error(`${result.status}: ${result.reason}`);
  }
  if (result.status === 'failed') process.exit(1);
}

/**
 * Write the SDK's own sources as declarations.
 *
 * The SDK ships TypeScript SOURCE (the `source` export condition), which is
 * what lets the chamber bundle it. A plugin outside this repo cannot consume
 * that — it has no `@/` alias and no workspace — so the types are emitted here
 * from the same files, into a directory the plugin's tsconfig can point at.
 */
async function types(dir, ctx) {
  const target = resolvePath(ctx.cwd, dir ?? '.');
  if (!fs.existsSync(target)) fail(`No such directory: ${target}`);
  const copied = writeBundledTypes(target, ctx.pkgRoot);
  if (copied === 0) fail('This install has no SDK sources (packages/ is not shipped in a production tarball).');

  if (isJson()) printJson({ dir: target, wrote: copied, out: joinPath(target, 'bundled-types') });
  else ok(`Wrote ${copied} declaration set(s) to ${joinPath(target, 'bundled-types')}`);
}

/**
 * Copy the SDK and kit sources into a plugin's own `bundled-types/`.
 *
 * Copied, not compiled: the sources ARE the declarations for a consumer that
 * only imports types, and the plugin's own `tsc` reads them directly. Emitting
 * `.d.ts` would mean running the compiler per plugin for a file the plugin's
 * tsc reads either way.
 *
 * The packages' OWN tests are excluded — they import `bun:test`, which a
 * plugin's tsconfig does not resolve, so copying them would fail every
 * plugin's typecheck on a file it never asked for.
 *
 * Returns how many sets were written; 0 means this install has no sources.
 */
function writeBundledTypes(target, pkgRoot) {
  const sources = [
    [joinPath(pkgRoot, 'packages', 'plugin-sdk', 'src'), 'plugin-sdk'],
    [joinPath(pkgRoot, 'packages', 'ui', 'src'), 'ui'],
  ];
  const out = joinPath(target, 'bundled-types');
  const SKIP = /\.test\.tsx?$/;
  let copied = 0;
  for (const [from, name] of sources) {
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(out, { recursive: true });
    const destination = joinPath(out, name);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(from, destination, { recursive: true, filter: (source) => !SKIP.test(source) });
    copied += 1;
  }
  return copied;
}

/** Scaffold a plugin directory: manifest, app entry, tsconfig, a test. */
async function scaffold(dir, ctx) {
  const target = resolvePath(ctx.cwd, dir ?? '.');
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    fail(`Refusing to scaffold into a non-empty directory: ${target}`);
  }

  const id = path.basename(target).replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
  const name = id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

  fs.mkdirSync(joinPath(target, 'src'), { recursive: true });
  fs.writeFileSync(
    joinPath(target, 'package.json'),
    `${JSON.stringify(
      {
        name: id,
        version: '1.0.0',
        private: true,
        type: 'module',
        ompchamber: {
          id,
          name,
          version: '1.0.0',
          app: 'dist/app.js',
          server: 'dist/server.js',
        },
        peerDependencies: {
          '@ompchamber/plugin-sdk': '*',
          '@ompchamber/ui': '*',
          preact: '^10.29.8',
        },
        peerDependenciesMeta: {
          '@ompchamber/plugin-sdk': { optional: true },
          '@ompchamber/ui': { optional: true },
          preact: { optional: true },
        },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    joinPath(target, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          jsx: 'react-jsx',
          jsxImportSource: 'preact',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          // Pointed at the emitted declarations, so `tsc` works in this
          // directory with no chamber source on disk. `baseUrl` is NOT set:
          // TypeScript 7 deprecates it, and `paths` resolves relative to the
          // tsconfig without it.
          paths: {
            '@ompchamber/plugin-sdk': ['./bundled-types/plugin-sdk/index.ts'],
            '@ompchamber/plugin-sdk/app': ['./bundled-types/plugin-sdk/app.ts'],
            '@ompchamber/plugin-sdk/testing': ['./bundled-types/plugin-sdk/testing/index.ts'],
            '@ompchamber/plugin-sdk/testing/app': ['./bundled-types/plugin-sdk/testing/app.tsx'],
            '@ompchamber/ui': ['./bundled-types/ui/index.tsx'],
            '@ompchamber/ui/components': ['./bundled-types/ui/components.tsx'],
          },
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(joinPath(target, 'src', 'app.tsx'), APP_TEMPLATE);
  fs.writeFileSync(joinPath(target, 'src', 'server.ts'), SERVER_TEMPLATE);

  // The declarations go in immediately: a scaffold whose `tsc` fails on the
  // FIRST run is a scaffold that taught the author the tooling is broken.
  // The SDK's packages ship source, so this is a copy rather than a build.
  const copied = writeBundledTypes(target, ctx.pkgRoot);

  if (isJson()) printJson({ dir: target, id, name, types: copied });
  else ok(`Scaffolded ${name} in ${target}`);
  if (copied === 0) {
    log('No SDK sources in this install — run "ompchamber plugin types ." from a checkout before typechecking.');
  }
  log('Typecheck with: bunx tsc --noEmit -p .');
  log('Build with:     ompchamber plugin build .');
}

const APP_TEMPLATE = `import { definePluginApp } from '@ompchamber/plugin-sdk/app';
import { usePanelInfo } from '@ompchamber/ui';
import { Panel, Field, FieldList } from '@ompchamber/ui/components';

function MyPanel() {
  const info = usePanelInfo();
  return (
    <Panel title="My Panel">
      <FieldList>
        <Field label="session" value={info.sessionId ?? 'none'} />
        <Field label="workspace" value={info.workspacePath ?? 'none'} />
      </FieldList>
    </Panel>
  );
}

export default definePluginApp((app) => {
  app.rightPanel({ id: 'main', title: 'My Panel', component: MyPanel });
});
`;

const SERVER_TEMPLATE = `import type { ChamberPluginApi } from '@ompchamber/plugin-sdk';

export default function plugin(api: ChamberPluginApi) {
  api.log.info('loaded');

  api.rpc.register('ping', { handler: () => ({ pong: true }) });

  api.onDispose(() => {
    api.log.info('disposed');
  });
}
`;

/** List the plugins the chamber has installed, with their build state. */
async function list() {
  const payload = await discoverPanelPlugins();
  if (isJson()) {
    printJson(payload.plugins);
    return;
  }
  if (payload.plugins.length === 0) {
    log('No panel plugins installed.');
    return;
  }
  for (const plugin of payload.plugins) {
    const flags = [plugin.enabled ? 'enabled' : 'disabled', plugin.built ? 'built' : 'not built'].join(', ');
    log(`${plugin.pluginId}  ${plugin.name}  (${flags})${plugin.reason ? ` — ${plugin.reason}` : ''}`);
  }
}

export async function run(options, ctx) {
  const argv = Array.isArray(options.args) ? options.args : [];
  const sub = argv[0] ?? null;
  const rest = argv.slice(1);

  if (options.help || !sub) {
    process.stdout.write(usage());
    if (!sub) process.exit(1);
    return;
  }
  if (!SUBCOMMANDS.includes(sub)) {
    error(`Unknown plugin subcommand: ${sub}`);
    process.stdout.write(usage());
    process.exit(1);
  }

  const dir = rest[0] ?? '.';
  if (sub === 'build') await build(dir, ctx);
  else if (sub === 'types') await types(dir, ctx);
  else if (sub === 'new') await scaffold(dir, ctx);
  else await list();
}
