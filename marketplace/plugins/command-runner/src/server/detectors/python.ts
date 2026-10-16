/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Python, and the one Compose source that shares its file shapes.
 *
 * ## Why `pyproject.toml` is read as a TABLE OF TABLES
 *
 * Python has no single task convention, so the file that holds them is a
 * container: `[tool.poe.tasks]`, `[tool.pdm.scripts]`, `[tool.hatch.envs.*.scripts]`
 * and `[tool.taskipy.tasks]` all declare runnable commands, and each names its own
 * runner. Reading them is reading four declared sources, not guessing one — and
 * each row's label says which runner it belongs to, so the four are told apart at
 * a glance.
 *
 * `[project.scripts]` is deliberately NOT read: those are console-script ENTRY
 * POINTS, installed into an environment, and running one requires the package to
 * be installed first. A row that fails until you have done something else is
 * worse than no row.
 *
 * ## `manage.py` is evidence, not a declaration
 *
 * A Django project's commands are knowable only by running `manage.py`, so the
 * file's PRESENCE is what is read and the verbs are Django's own stable ones (see
 * `standardVerbs`). The row's label says `python manage.py migrate`, which is
 * exactly what runs.
 *
 * ## Compose services are the one place a NOUN becomes a row
 *
 * A service is not a command, but `docker compose up <svc>` and `logs -f <svc>`
 * are the two things a reader actually does with one, and the service name is the
 * only thing that varies. Two rows per service, not four: a list that offers every
 * verb per service stops being scannable, and `build`/`restart` are one word away
 * in the terminal.
 */

import { at, field, keys, cmd, standardVerbs, type Detector } from './types';
import type { Command } from '../../protocol';

/**
 * The `pyproject.toml` tables that declare commands, with the runner each one's
 * commands belong to.
 *
 * A flat table rather than a chain of `if`s: a fifth convention is a row.
 */
const PYPROJECT_TABLES: ReadonlyArray<{ path: readonly string[]; prefix: readonly string[] }> = [
  { path: ['tool', 'poe', 'tasks'], prefix: ['poe'] },
  { path: ['tool', 'pdm', 'scripts'], prefix: ['pdm', 'run'] },
  { path: ['tool', 'taskipy', 'tasks'], prefix: ['task'] },
];

/** The Django verbs worth a row: stable, argument-free, and common. */
const DJANGO_VERBS = [
  'runserver',
  'migrate',
  'makemigrations',
  'test',
  'shell',
  'collectstatic',
  'createsuperuser',
  'check',
] as const;

/** `pyproject.toml`: every declared task table, each with its own runner. */
function parsePyproject(text: string): Command[] {
  const parsed = Bun.TOML.parse(text) as unknown;
  const out: Command[] = [];

  for (const { path, prefix } of PYPROJECT_TABLES) {
    for (const name of keys(at(parsed, path))) out.push(cmd(name, [...prefix, name]));
  }

  // `[tool.hatch.envs.<env>.scripts]` — the env is part of the invocation, and
  // the default env needs no qualifier (`hatch run build`, not
  // `hatch run default:build`).
  const envs = at(parsed, ['tool', 'hatch', 'envs']);
  for (const env of keys(envs)) {
    for (const name of keys(field(envs, env) === undefined ? undefined : at(field(envs, env), ['scripts']))) {
      out.push(
        cmd(
          env === 'default' ? name : `${env}:${name}`,
          env === 'default' ? ['hatch', 'run', name] : ['hatch', 'run', `${env}:${name}`],
        ),
      );
    }
  }

  return out;
}

/** `Pipfile` scripts: `[scripts]`, run by the pipenv that declares them. */
function parsePipfile(text: string): Command[] {
  const parsed = Bun.TOML.parse(text) as unknown;
  return keys(at(parsed, ['scripts'])).map((name) => cmd(name, ['pipenv', 'run', name]));
}

/** A Django `manage.py`, whose verbs are Django's own. */
function parseManage(): Command[] {
  return standardVerbs(['python', 'manage.py'], DJANGO_VERBS);
}

/** Compose services: the two things a reader does with one. */
function parseCompose(text: string): Command[] {
  const services = field(Bun.YAML.parse(text), 'services');
  const out: Command[] = [];
  for (const name of keys(services)) {
    out.push(cmd(`${name} up`, ['docker', 'compose', 'up', name]));
    out.push(cmd(`${name} logs`, ['docker', 'compose', 'logs', '-f', name]));
  }
  return out;
}

export const PYTHON_DETECTORS: readonly Detector[] = [
  { kind: 'python', filenames: ['pyproject.toml'], parse: parsePyproject },
  { kind: 'pipenv', filenames: ['Pipfile'], parse: parsePipfile },
  { kind: 'django', filenames: ['manage.py'], parse: parseManage },
  {
    kind: 'compose',
    filenames: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
    parse: parseCompose,
  },
];
