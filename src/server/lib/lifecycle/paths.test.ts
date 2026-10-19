/**
 * The data directory's override spellings, and the one-time move from the
 * pre-rename directory.
 *
 * The rename must not cost an existing install its state: `~/.kabmo` holds the
 * database, the auth secret and the instance records, and a build that simply
 * looked in the new directory would start empty. `KABMO_DATA_DIR` is the
 * override, `OMPCHAMBER_DATA_DIR` is still honoured, and the new name wins when
 * both are set.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';

import { getDataDir, migrateLegacyDataDir } from '@/server/lib/lifecycle/paths';

const saved = {
  kabmo: Bun.env.KABMO_DATA_DIR,
  legacy: Bun.env.OMPCHAMBER_DATA_DIR,
};

const roots: string[] = [];

beforeEach(() => {
  delete Bun.env.KABMO_DATA_DIR;
  delete Bun.env.OMPCHAMBER_DATA_DIR;
});

afterEach(() => {
  for (const [key, value] of Object.entries({
    KABMO_DATA_DIR: saved.kabmo,
    OMPCHAMBER_DATA_DIR: saved.legacy,
  })) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function homeWith(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kabmo-data-dir-'));
  roots.push(dir);
  const home = path.join(dir, 'home');
  mkdirSync(home, { recursive: true });
  if (name) {
    mkdirSync(path.join(home, name), { recursive: true });
    writeFileSync(path.join(home, name, 'marker'), name);
  }
  return home;
}

describe('getDataDir', () => {
  test('defaults to the home directory of the current name', () => {
    expect(getDataDir()).toBe(path.join(homedir(), '.kabmo'));
  });

  test('the pre-rename override is still honoured', () => {
    Bun.env.OMPCHAMBER_DATA_DIR = '/tmp/legacy-data';
    expect(getDataDir()).toBe(path.resolve('/tmp/legacy-data'));
  });

  test('the new override wins when both are set', () => {
    Bun.env.OMPCHAMBER_DATA_DIR = '/tmp/legacy-data';
    Bun.env.KABMO_DATA_DIR = '/tmp/new-data';
    expect(getDataDir()).toBe(path.resolve('/tmp/new-data'));
  });

  test('a leading ~ expands', () => {
    Bun.env.KABMO_DATA_DIR = '~/.kabmo-probe';
    expect(getDataDir()).toBe(path.join(homedir(), '.kabmo-probe'));
  });
});

describe('migrateLegacyDataDir', () => {
  test('moves a pre-rename directory into place', () => {
    const home = homeWith('.ompchamber');
    migrateLegacyDataDir(home);
    expect(existsSync(path.join(home, '.ompchamber'))).toBe(false);
    expect(existsSync(path.join(home, '.kabmo', 'marker'))).toBe(true);
  });

  test('never overwrites a live directory', () => {
    const home = homeWith('.ompchamber');
    mkdirSync(path.join(home, '.kabmo'), { recursive: true });
    writeFileSync(path.join(home, '.kabmo', 'marker'), 'live');
    migrateLegacyDataDir(home);
    expect(existsSync(path.join(home, '.ompchamber', 'marker'))).toBe(true);
  });

  test('is a no-op when there is nothing to move', () => {
    const home = homeWith('');
    migrateLegacyDataDir(home);
    expect(existsSync(path.join(home, '.kabmo'))).toBe(false);
  });
});
