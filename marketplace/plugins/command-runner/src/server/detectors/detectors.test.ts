/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every parser, against the shapes that actually break a naive implementation.
 *
 * The comment at the top of `detectors/` promises that a parser is shallow on
 * purpose and that the cases which break a regex are the ones unit-tested. This
 * is where that promise is kept, and each test names the SHAPE rather than the
 * regex — so a reader can tell what the test is defending.
 *
 * The sources split by family (`js.ts`, `make.ts`, `python.ts`, `native.ts`), and
 * this file is deliberately one file rather than four: the interesting cases are
 * cross-family comparisons (which file wins a shared name, which toolchain lists
 * verbs versus declares them), and splitting them would hide those.
 */

import { describe, expect, test } from 'bun:test';

import { detectorFor } from './table';
import { stripJsonComments } from './jsonc';
import type { Detector, DetectorContext } from './types';

/**
 * The detector that owns a file, by assertion — a missing row is a failure.
 *
 * The PATH is offered as well as the basename, because a `paths` row
 * (`.cargo/config.toml`) is claimed by its path and not by its basename — that is
 * the whole point of the suffix match.
 */
function detector(filename: string): Detector {
  const found = detectorFor(filename, filename);
  if (!found) throw new Error(`no detector claims ${filename}`);
  return found;
}

/** A context whose directory reads answer whatever a test supplies. */
function ctx(overrides: Partial<DetectorContext> = {}): DetectorContext {
  return { file: '', dir: '', entries: () => [], dirs: () => [], ...overrides };
}

/** The command names a parse produced. */
function names(text: string, filename: string, context: DetectorContext = ctx()): string[] {
  return detector(filename)
    .parse(text, context)
    .map((command) => command.name);
}

/** The labels a parse produced. */
function labels(text: string, filename: string, context: DetectorContext = ctx()): string[] {
  return detector(filename)
    .parse(text, context)
    .map((command) => command.label);
}

describe('the make parser', () => {
  test('lists targets and skips dot-targets', () => {
    const text = ['.PHONY: build test', 'build:', '\techo build', 'test:', '\techo test'].join('\n');
    expect(names(text, 'Makefile')).toEqual(['build', 'test']);
  });

  test('a variable assignment containing a colon is not a command', () => {
    // `SRC := a:b` — the bug a bare `^(\w+):` rule produces.
    expect(names(['SRC := a:b', 'OTHER = x', 'build:', '\techo'].join('\n'), 'Makefile')).toEqual(['build']);
  });

  test('a pattern rule is not a command', () => {
    expect(names('%.o: %.c\n\tcc -c $<', 'Makefile')).toEqual([]);
  });

  test('an indented continuation is not a new target', () => {
    expect(names(['build: deps \\', '  other:', '\techo'].join('\n'), 'Makefile')).toEqual(['build']);
  });

  test('a duplicate target is listed once', () => {
    expect(names('build:\nbuild: extra', 'Makefile')).toEqual(['build']);
  });
});

describe('the justfile parser', () => {
  test('lists recipes and skips assignments and attribute blocks', () => {
    const text = ['set shell := ["bash", "-c"]', '', '[private]', 'helper:', '  echo hi', '', 'build:', '  echo build'].join('\n');
    // `helper` IS a recipe (`just helper` runs it); `[private]` only keeps it out
    // of the default list, and a runner that hid it would refuse a command that
    // works. What must NOT be listed is the assignment and the attribute block.
    expect(names(text, 'justfile')).toEqual(['helper', 'build']);
  });

  test('a recipe with arguments is still a recipe', () => {
    expect(names('deploy env="prod":\n  echo', 'justfile')).toEqual(['deploy']);
  });
});

describe('the Taskfile parser', () => {
  test('lists every task key, and nothing for a file without tasks', () => {
    expect(names('version: "3"\ntasks:\n  build:\n    cmds: [x]\n  test:\n    cmds: [y]', 'Taskfile.yml')).toEqual(['build', 'test']);
    expect(names('version: "3"', 'Taskfile.yml')).toEqual([]);
  });
});

describe('the package.json parser', () => {
  test('lists every script through the RESOLVED runner', () => {
    // The runner is not the file's own business — it is a lockfile walk — so it
    // arrives on the context and the label is what proves it was used.
    expect(labels('{"scripts":{"dev":"x","test":"y"}}', 'package.json', ctx({ runner: 'pnpm' }))).toEqual([
      'pnpm run dev',
      'pnpm run test',
    ]);
  });

  test('falls back to bun when no runner was resolved', () => {
    expect(labels('{"scripts":{"dev":"x"}}', 'package.json')).toEqual(['bun run dev']);
  });

  test('a file with no scripts lists nothing', () => {
    expect(names('{"name":"x"}', 'package.json')).toEqual([]);
  });

  test('a scripts value that is not an object lists nothing', () => {
    expect(names('{"scripts":"nope"}', 'package.json')).toEqual([]);
  });
});

describe('the deno parser', () => {
  test('lists tasks, and reads a file that carries comments', () => {
    // `deno.jsonc` allows comments and trailing commas, so `JSON.parse` alone
    // rejects a valid file — the whole reason the JSONC reader exists.
    const text = ['{', '  // the build pipeline', '  "tasks": {', '    "build": "deno task build",', '  },', '}'].join('\n');
    expect(labels(text, 'deno.jsonc')).toEqual(['deno task build']);
  });

  test('a comment inside a STRING is not a comment', () => {
    // The measured failure of a naive `/\/\/.*$/`: this import map's URL lost its
    // scheme and became `"https:`.
    const text = '{ "imports": { "x": "https://deno.land/x/mod.ts" } }';
    expect(JSON.parse(stripJsonComments(text))).toEqual({ imports: { x: 'https://deno.land/x/mod.ts' } });
  });
});

describe('the pyproject parser', () => {
  test('reads every declared task table, each with its own runner', () => {
    const text = [
      '[tool.poe.tasks]',
      'build = "python -m build"',
      '',
      '[tool.pdm.scripts]',
      'lint = "ruff check"',
      '',
      '[tool.taskipy.tasks]',
      'test = "pytest"',
    ].join('\n');
    expect(labels(text, 'pyproject.toml')).toEqual(['poe build', 'pdm run lint', 'task test']);
  });

  test('a hatch env qualifies its scripts, except the default env', () => {
    const text = ['[tool.hatch.envs.default.scripts]', 'build = "x"', '', '[tool.hatch.envs.docs.scripts]', 'serve = "y"'].join('\n');
    expect(labels(text, 'pyproject.toml')).toEqual(['hatch run build', 'hatch run docs:serve']);
  });

  test('project.scripts is NOT read: those are installed entry points', () => {
    // Running one requires the package installed into the environment first, so
    // a row that fails until you have done something else is worse than no row.
    expect(names('[project.scripts]\napp = "pkg:main"', 'pyproject.toml')).toEqual([]);
  });
});

describe('the Pipfile parser', () => {
  test('reads [scripts] through pipenv', () => {
    expect(labels('[scripts]\nbuild = "python -m build"', 'Pipfile')).toEqual(['pipenv run build']);
  });
});

describe('the Django parser', () => {
  test('lists the framework verbs, named with the interpreter that runs them', () => {
    const listed = labels('', 'manage.py');
    expect(listed).toContain('python manage.py migrate');
    expect(listed).toContain('python manage.py runserver');
  });
});

describe('the Compose parser', () => {
  test('lists two rows per service, not one per verb', () => {
    const text = 'services:\n  web:\n    image: nginx\n  db:\n    image: pg';
    expect(labels(text, 'compose.yml')).toEqual([
      'docker compose up web',
      'docker compose logs -f web',
      'docker compose up db',
      'docker compose logs -f db',
    ]);
  });

  test('a file with no services lists nothing', () => {
    expect(names('version: "3"', 'docker-compose.yml')).toEqual([]);
  });
});

describe('the go parser', () => {
  test('lists the cmd/<name> packages beside the module', () => {
    // The only detector that reads a DIRECTORY: `go.mod` declares no commands.
    expect(labels('module example.com/app', 'go.mod', ctx({ dirs: () => ['server', 'worker'] }))).toEqual([
      'go run ./cmd/server',
      'go run ./cmd/worker',
      'go run .',
    ]);
  });

  test('a module with no cmd/ lists nothing', () => {
    // Usually a library: `go run .` would be a row that fails.
    expect(names('module example.com/lib', 'go.mod')).toEqual([]);
  });
});

describe('the cargo parser', () => {
  test('lists cargo verbs plus every [[bin]] target', () => {
    const text = '[package]\nname = "app"\n\n[[bin]]\nname = "server"\npath = "src/main.rs"';
    const listed = labels(text, 'Cargo.toml');
    expect(listed).toContain('cargo build');
    expect(listed).toContain('cargo run --bin server');
  });

  test('reads [alias] from the cargo config, matched on the path', () => {
    expect(labels('[alias]\nbr = "build --release"', '.cargo/config.toml')).toEqual(['cargo br']);
  });
});

describe('the composer parser', () => {
  test('lists scripts through composer', () => {
    expect(labels('{"scripts":{"test":"phpunit"}}', 'composer.json')).toEqual(['composer run-script test']);
  });

  test('adds the artisan verbs only when artisan is BESIDE the composer.json', () => {
    // Laravel is recognised by the file that IS the app's entry point, read from
    // the directory — a `composer.json` alone could be any PHP package.
    const text = '{"scripts":{"test":"phpunit"}}';
    expect(labels(text, 'composer.json')).toEqual(['composer run-script test']);
    expect(labels(text, 'composer.json', ctx({ entries: () => ['artisan'] }))).toContain('php artisan migrate');
  });
});

describe('the Gradle and Maven parsers', () => {
  test('prefers the committed WRAPPER over the machine PATH', () => {
    const text = 'plugins {}';
    expect(labels(text, 'build.gradle')).toContain('gradle build');
    expect(labels(text, 'build.gradle', ctx({ entries: () => ['gradlew'] }))).toContain('./gradlew build');
  });

  test('Maven uses mvnw when it ships one', () => {
    expect(labels('<project/>', 'pom.xml', ctx({ entries: () => ['mvnw'] }))).toContain('./mvnw package');
  });

  test('reads a `task <name>` declaration, which the file itself states', () => {
    expect(labels('task integrationTest {\n}', 'build.gradle')).toContain('gradle integrationTest');
  });
});

describe('the mix parser', () => {
  test('reads the project aliases out of the aliases block', () => {
    const text = ['defp aliases do', '  [', '    setup: ["deps.get"],', '    "db.reset": ["ecto.drop"]', '  ]', 'end'].join('\n');
    expect(labels(text, 'mix.exs')).toEqual(['mix setup', 'mix db.reset']);
  });

  test('a file with no aliases lists nothing', () => {
    expect(names('def project do\nend', 'mix.exs')).toEqual([]);
  });
});
