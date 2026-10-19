// The argument parser's two option vocabularies.
//
// A flag's SPELLING and the option KEY it sets are not the same thing, and the
// tray flags are where that stopped being theoretical: `--no-startup` is
// hyphenated while the command reads `options.startup`, so putting it in
// `BOOLEAN_LONG` (which stores a flag under its own spelling,
// `options['no-startup']`) would make it silently inert. Measured on the earlier
// `--start-server`: the flag parsed, the command never saw it, and the feature
// reported success while doing nothing.
//
// This suite pins the mapping so a new hyphenated flag has to choose a side.

import { describe, expect, test } from 'bun:test';

import { parseArgs, helpText } from '@/cli/lib/args.js';

describe('parseArgs', () => {
  test('a hyphenated flag lands on the camelCase option the command reads', () => {
    const parsed = parseArgs(['serve', '--no-startup']);
    expect(parsed.options.startup).toBe(false);
    expect(parsed.unknown).toEqual([]);
  });

  test('--tray and --startup are booleans', () => {
    const both = parseArgs(['serve', '--tray', '--startup']);
    expect(both.options.tray).toBe(true);
    expect(both.options.startup).toBe(true);
  });

  test('an unmentioned --startup stays null, so "install" and "remove" are told apart', () => {
    expect(parseArgs(['serve']).options.startup).toBeNull();
  });

  test('the pre-existing aliases keep working', () => {
    const parsed = parseArgs(['serve', '--no-daemon', '--no-ui-password', '--no-restart']);
    expect(parsed.options.foreground).toBe(true);
    expect(parsed.options.noUiPassword).toBe(true);
    expect(parsed.options.restart).toBe(false);
  });

  test('--port still parses as a number', () => {
    const parsed = parseArgs(['serve', '--port', '3999']);
    expect(parsed.command).toBe('serve');
    expect(parsed.options.port).toBe(3999);
  });

  test('an unknown flag is reported rather than swallowed', () => {
    expect(parseArgs(['serve', '--nope']).unknown).toEqual(['--nope']);
  });
});

describe('helpText', () => {
  test('names the bin it was invoked as, and the legacy spelling by default', () => {
    expect(helpText('kabmo')).toContain('kabmo [COMMAND] [OPTIONS]');
    expect(helpText('kabmo')).not.toContain('ompchamber [COMMAND]');
    expect(helpText()).toContain('ompchamber [COMMAND] [OPTIONS]');
    // The environment names are not the command name and must not be rewritten.
    expect(helpText('kabmo')).toContain('OMPCHAMBER_DATA_DIR');
  });
});

describe('--ui-password-file', () => {
  // The flag a login entry uses instead of the secret: the entry file is
  // world-readable, the file it names is 0600.
  test('takes a path', () => {
    const { options } = parseArgs(['serve', '--ui-password-file', '/data/cred']);
    expect(options.uiPasswordFile).toBe('/data/cred');
  });

  test('defaults to null, so an entry without one is distinguishable', () => {
    expect(parseArgs(['serve']).options.uiPasswordFile).toBeNull();
  });

  test('a bare flag is not a path', () => {
    expect(parseArgs(['serve', '--ui-password-file']).options.uiPasswordFile).toBeNull();
  });
});
