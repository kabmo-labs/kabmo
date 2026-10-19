/**
 * The data directory's two override spellings.
 *
 * The rename must not move an existing install's state: `~/.ompchamber` holds
 * the database, the auth secret and the instance records, so the default stays
 * where it was and only an explicit `KABMO_DATA_DIR` may point elsewhere. The
 * old variable keeps working, and the new one wins when both are set.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import * as path from 'node:path';

import { getDataDir } from '@/server/lib/lifecycle/paths';

const saved = {
  kabmo: Bun.env.KABMO_DATA_DIR,
  legacy: Bun.env.OMPCHAMBER_DATA_DIR,
};

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
});

describe('getDataDir', () => {
  test('defaults to the pre-rename home directory, so an existing install keeps its state', () => {
    expect(getDataDir()).toBe(path.join(homedir(), '.ompchamber'));
  });

  test('the pre-rename override is still honoured', () => {
    Bun.env.OMPCHAMBER_DATA_DIR = '/tmp/legacy-data';
    expect(getDataDir()).toBe('/tmp/legacy-data');
  });

  test('the new override wins when both are set', () => {
    Bun.env.OMPCHAMBER_DATA_DIR = '/tmp/legacy-data';
    Bun.env.KABMO_DATA_DIR = '/tmp/new-data';
    expect(getDataDir()).toBe('/tmp/new-data');
  });

  test('a leading ~ expands', () => {
    Bun.env.KABMO_DATA_DIR = '~/.kabmo-probe';
    expect(getDataDir()).toBe(path.join(homedir(), '.kabmo-probe'));
  });
});
