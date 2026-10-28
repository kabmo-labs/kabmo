/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sidebar projection (`sidebar.ts`): session titles, project display names and
 * the two orderings the folder list is seeded from.
 *
 * These are the only place a nameless session becomes distinguishable, where a
 * path becomes a human label, and where omp's ordering is mirrored. The risky
 * cases pinned here: a blank/whitespace title must not shadow a real one, the
 * `(no messages)` sentinel must not become a session name, a project path with
 * a trailing separator (or Windows separators) must still yield a basename,
 * and sessions must land in the bucket of their project root — never in a
 * bucket keyed by an empty root when a cwd exists.
 */

import { describe, expect, test } from 'bun:test';

import {
  compareOmpProjects,
  groupSessionsByRoot,
  orderedOmpProjects,
  projectDisplayName,
  sessionTitleFor,
} from '@/shared/lib/omp/session/sidebar';
import type { OmpProject, OmpSession, OmpSidebarData } from '@/shared/types/omp/session';

const session = (overrides: Partial<OmpSession>): OmpSession => ({
  path: '/sessions/s.jsonl',
  id: 's',
  cwd: '/work',
  messageCount: 1,
  firstMessage: '',
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const project = (overrides: Partial<OmpProject>): OmpProject => ({ path: '/x', discovered: false, ...overrides });

describe('sessionTitleFor', () => {
  test('uses the session name, trimmed and capitalized', () => {
    expect(sessionTitleFor(session({ name: '  my session  ' }))).toBe('My session');
  });

  test('falls back to the first message when there is no name', () => {
    expect(sessionTitleFor(session({ firstMessage: 'first prompt' }))).toBe('First prompt');
  });

  test('a whitespace-only name does not shadow the first message', () => {
    expect(sessionTitleFor(session({ name: '   ', firstMessage: 'fallback' }))).toBe('Fallback');
  });

  test('truncates the first message at 120 characters', () => {
    expect(sessionTitleFor(session({ firstMessage: 'a'.repeat(200) }))).toHaveLength(120);
  });

  test('the `(no messages)` sentinel is not a title', () => {
    // It renders as the timestamped default, which is unique per session.
    expect(sessionTitleFor(session({ firstMessage: ' (no messages) ' }))).toBe('New Session - 2026-01-01T00:00:00');
  });

  test('a nameless session takes its title from the creation timestamp, in local time', () => {
    // The no-offset ISO is parsed as local time and formatted with local
    // getters, so the expected string is timezone-independent.
    expect(sessionTitleFor(session({ created: '2026-01-02T03:04:05' }))).toBe('New Session - 2026-01-02T03:04:05');
  });

  test('two nameless sessions with different creation times get different titles', () => {
    const a = sessionTitleFor(session({ created: '2026-01-02T03:04:05' }));
    const b = sessionTitleFor(session({ created: '2026-01-02T03:04:06' }));
    expect(a).not.toBe(b);
  });

  test('an unparseable creation timestamp degrades to the bare default', () => {
    expect(sessionTitleFor(session({ created: 'garbage' }))).toBe('New Session');
  });
});

describe('projectDisplayName', () => {
  test('prefers a trimmed alias', () => {
    expect(projectDisplayName(project({ path: '/a/Beta', alias: '  My Alias  ' }))).toBe('My Alias');
  });

  test('a whitespace-only alias falls through to the basename', () => {
    expect(projectDisplayName(project({ path: '/a/Beta', alias: '   ' }))).toBe('beta');
  });

  test('uses the lowercased basename and ignores a trailing separator', () => {
    expect(projectDisplayName(project({ path: '/a/Beta/' }))).toBe('beta');
    expect(projectDisplayName(project({ path: '/a/Beta' }))).toBe('beta');
  });

  test('handles Windows separators', () => {
    expect(projectDisplayName(project({ path: 'C:\\Users\\Me\\Proj\\' }))).toBe('proj');
  });

  test('keeps a root path intact when stripping leaves nothing', () => {
    expect(projectDisplayName(project({ path: '/' }))).toBe('/');
  });
});

describe('compareOmpProjects', () => {
  test('orders by sortOrder ascending', () => {
    expect(compareOmpProjects(project({ sortOrder: 1 }), project({ sortOrder: 2 }))).toBe(-1);
    expect(compareOmpProjects(project({ sortOrder: 2 }), project({ sortOrder: 1 }))).toBe(1);
  });

  test('a missing sortOrder sorts last', () => {
    expect(compareOmpProjects(project({}), project({ sortOrder: 5 }))).toBe(Number.POSITIVE_INFINITY);
    expect(compareOmpProjects(project({ sortOrder: 5 }), project({}))).toBe(Number.NEGATIVE_INFINITY);
  });

  test('ties break by addedAt, newest first', () => {
    expect(compareOmpProjects(project({ sortOrder: 1, addedAt: '2026-01-02' }), project({ sortOrder: 1, addedAt: '2026-01-01' }))).toBe(-1);
  });

  test('two fully equal projects compare as zero', () => {
    expect(compareOmpProjects(project({ sortOrder: 1 }), project({ sortOrder: 1 }))).toBe(0);
  });
});

describe('groupSessionsByRoot', () => {
  test('buckets by projectRoot and falls back to cwd', () => {
    const groups = groupSessionsByRoot([
      session({ id: 'a', projectRoot: '/repo' }),
      session({ id: 'b', cwd: '/other' }),
    ]);
    expect([...groups.keys()]).toEqual(['/repo', '/other']);
  });

  test('an empty projectRoot falls through to the cwd rather than keying an empty bucket', () => {
    const groups = groupSessionsByRoot([session({ id: 'a', projectRoot: '', cwd: '/repo' })]);
    expect(groups.get('/repo')?.map((item) => item.id)).toEqual(['a']);
    expect(groups.has('')).toBe(false);
  });

  test('sorts each bucket by modified, newest first', () => {
    const groups = groupSessionsByRoot([
      session({ id: 'old', projectRoot: '/r', modified: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'new', projectRoot: '/r', modified: '2026-01-05T00:00:00.000Z' }),
    ]);
    expect(groups.get('/r')?.map((item) => item.id)).toEqual(['new', 'old']);
  });

  test('is empty for no sessions', () => {
    expect(groupSessionsByRoot([]).size).toBe(0);
  });
});

describe('orderedOmpProjects', () => {
  const sidebar = (projects: OmpProject[]): OmpSidebarData => ({
    projects,
    sessions: [],
    agentDir: '/agent',
    available: true,
    generatedAt: '2026-01-01T00:00:00.000Z',
  });

  test('puts registered projects first (by sortOrder) and discovered extras last (by path)', () => {
    const ordered = orderedOmpProjects(sidebar([
      project({ path: '/z-discovered', discovered: true }),
      project({ path: '/a-discovered', discovered: true }),
      project({ path: '/reg2', sortOrder: 2 }),
      project({ path: '/reg1', sortOrder: 1 }),
    ]));
    expect(ordered.map((item) => item.path)).toEqual(['/reg1', '/reg2', '/a-discovered', '/z-discovered']);
  });

  test('a registered project with no sortOrder follows the explicitly ordered ones', () => {
    const ordered = orderedOmpProjects(sidebar([project({ path: '/unordered' }), project({ path: '/ordered', sortOrder: 1 })]));
    expect(ordered.map((item) => item.path)).toEqual(['/ordered', '/unordered']);
  });

  test('is empty for no projects', () => {
    expect(orderedOmpProjects(sidebar([]))).toEqual([]);
  });
});
