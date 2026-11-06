/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `docs/` tree's contract, asserted.
 *
 * Two failure modes cost real time here, and neither produces an error
 * anywhere: a document that says "research only" long after the feature
 * shipped (the git panel and the packaging plan both did), and a path that a
 * build script or a README keeps naming after the page was renamed (the
 * worktree plan cited `docs/omp-worktree-research`, which never existed).
 * A reader is the only one who notices, and only after following the link.
 *
 * So the rules are mechanical:
 *
 * - milestones are `M<NN>-<slug>.md`, contiguous from `01`, ordered by when the
 *   work started — a `planned` one keeps its early number rather than moving;
 * - every milestone states its status once, up front, with one of five tokens;
 * - `reference/` states none, because a contract that is over is not a contract;
 * - `docs/README.md` is the index and names every milestone;
 * - every `docs/…` path named from the app, its packages, its CI and its own
 *   pages resolves, including the relative links inside `docs/`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const DOCS = join(ROOT, 'docs');
const MILESTONES = join(DOCS, 'milestones');
const REFERENCE = join(DOCS, 'reference');

const STATUS_TOKENS = ['done', 'partial', 'planned', 'declined', 'blocked'] as const;
const STATUS_LINE = new RegExp(`^Status: \\*\\*(${STATUS_TOKENS.join('|')})\\*\\* — .+`, 'm');
const MILESTONE_NAME = /^M(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

const milestoneFiles = readdirSync(MILESTONES).filter((name) => name.endsWith('.md')).sort();
const referenceFiles = readdirSync(REFERENCE).filter((name) => name.endsWith('.md')).sort();

/** Every file under `dir`, skipping the trees that are never edited by hand. */
function walk(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, filter));
    else if (filter(path)) out.push(path);
  }
  return out;
}

describe('milestone names', () => {
  test('are M<NN>-<slug>.md, contiguous from 01, in order', () => {
    const numbers = milestoneFiles.map((name) => {
      const match = MILESTONE_NAME.exec(name);
      expect(match, `${name} does not match M<NN>-<slug>.md`).not.toBeNull();
      return Number(match![1]);
    });
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  test('numbered in the order the work started, not the order it finished', () => {
    // A milestone's number is fixed when its document is created, so a page
    // that ships late still carries an early number. Anything else renumbers
    // every later file on each ship, and the numbers stop meaning anything.
    for (const name of milestoneFiles) {
      const status = STATUS_LINE.exec(readFileSync(join(MILESTONES, name), 'utf8'));
      expect(status, `${name} has no status line`).not.toBeNull();
    }
  });
});

describe('status lines', () => {
  test('each milestone states one, in its header block', () => {
    for (const name of milestoneFiles) {
      const text = readFileSync(join(MILESTONES, name), 'utf8');
      const preamble = text.split(/^## /m)[0]!;
      const matches = preamble.match(new RegExp(`^Status: \\*\\*[^*]+\\*\\*`, 'gm')) ?? [];
      expect(matches.length, `${name} must state its status exactly once before the first heading`).toBe(1);
      expect(preamble, `${name} uses a token outside the five`).toMatch(STATUS_LINE);
    }
  });

  test('reference pages state none', () => {
    for (const name of referenceFiles) {
      const text = readFileSync(join(REFERENCE, name), 'utf8');
      expect(text, `${name} is a living contract, not a milestone`).not.toMatch(/^Status: /m);
    }
  });
});

describe('the index', () => {
  const index = readFileSync(join(DOCS, 'README.md'), 'utf8');

  test('links every milestone and every reference page', () => {
    for (const name of milestoneFiles) {
      expect(index, `docs/README.md does not link milestones/${name}`).toContain(`milestones/${name}`);
    }
    for (const name of referenceFiles) {
      expect(index, `docs/README.md does not link reference/${name}`).toContain(`reference/${name}`);
    }
  });

  test('pins the same status the milestone header does', () => {
    // The table is what a reader sees first; a row that disagrees with its page
    // is the exact drift this file exists to stop.
    for (const name of milestoneFiles) {
      const header = STATUS_LINE.exec(readFileSync(join(MILESTONES, name), 'utf8'))![1]!;
      const row = index.split('\n').find((line) => line.includes(`milestones/${name}`));
      expect(row, `docs/README.md has no table row for ${name}`).toBeDefined();
      expect(row, `${name} is "${header}" here and "${row}" in the index`).toContain(`| ${header} |`);
    }
  });

  test('what still owes names only partial, planned or blocked milestones', () => {
    const owing = index.split('## What still owes')[1] ?? '';
    const named = new Set(owing.match(/^\| (\d{2}) \|/gm)?.map((line) => line.slice(2, 4)) ?? []);
    for (const name of milestoneFiles) {
      const number = MILESTONE_NAME.exec(name)![1]!;
      const header = STATUS_LINE.exec(readFileSync(join(MILESTONES, name), 'utf8'))![1]!;
      if (header === 'done' || header === 'declined') {
        expect(named.has(number), `${name} is ${header} but is listed as owing something`).toBe(false);
      } else {
        expect(named.has(number), `${name} is ${header} and is missing from "What still owes"`).toBe(true);
      }
    }
  });
});

describe('doc paths resolve', () => {
  /** Files that may name a docs path: the app's own entry points and its pages. */
  const SOURCES = [
    'README.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    'DESIGN.md',
    ...walk(DOCS, (path) => path.endsWith('.md')),
    ...walk(join(ROOT, 'packages'), (path) => /\.(md|sh|ps1)$/.test(path)),
    ...walk(join(ROOT, 'marketplace'), (path) => /\.(md|ts|tsx)$/.test(path)),
    ...walk(join(ROOT, '.github', 'scripts'), (path) => path.endsWith('.sh')),
  ].filter((path) => existsSync(path));

  /** `docs/...md`, resolved from the repo root. */
  const ROOT_PATH = /(?<![\w/.-])docs\/[\w./-]+\.md/g;
  /** `[label](../milestones/M01-x.md#anchor)`, resolved from the file that links it. */
  const RELATIVE_LINK = /\]\((?!https?:|#|mailto:)([^)\s]+\.md)(?:#[^)\s]*)?\)/g;

  const references = (path: string): string[] => {
    const text = readFileSync(path, 'utf8');
    const found: string[] = [];
    for (const match of text.matchAll(ROOT_PATH)) found.push(resolve(ROOT, match[0]));
    for (const match of text.matchAll(RELATIVE_LINK)) found.push(resolve(dirname(path), match[1]!));
    return found;
  };

  test('every docs path named outside docs/ exists', () => {
    const broken: string[] = [];
    for (const path of SOURCES) {
      if (path.startsWith(DOCS + sep)) continue;
      for (const target of references(path)) {
        if (!existsSync(target)) broken.push(`${relative(ROOT, path)} -> ${relative(ROOT, target)}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('every relative link inside docs/ exists', () => {
    const broken: string[] = [];
    for (const path of walk(DOCS, (candidate) => candidate.endsWith('.md'))) {
      for (const match of readFileSync(path, 'utf8').matchAll(RELATIVE_LINK)) {
        const target = resolve(dirname(path), match[1]!);
        if (!existsSync(target)) broken.push(`${relative(ROOT, path)} -> ${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('no page still names a document that was renamed into the milestones tree', () => {
    const RENAMED = [
      'realtime-plan',
      'omp-18.8-adoption-plan',
      'e2e-testing-plan',
      'plugin-platform-plan',
      'plugin-platform-wave2-plan',
      'tool-render-audit-2026-10-13',
      'stats-plugin',
      'git-panel-plan',
      'command-runner-plugin',
      'desktop-mobile-packaging-plan',
      'worktree-plan',
      'codemirror6-editor-plan',
      'e2e-transport-and-qr-connect-research',
      'editor-panel-gaps-plan',
      'composer-design-research',
      'multi-harness-research',
      'harness-ui-design',
      'multi-view-terminal-research',
      'panel-plugins',
    ];
    const stale: string[] = [];
    for (const path of SOURCES) {
      const text = readFileSync(path, 'utf8');
      for (const old of RENAMED) {
        if (text.includes(`docs/${old}`)) stale.push(`${relative(ROOT, path)} names docs/${old}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
