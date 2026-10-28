/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mode command's wire format.
 *
 * The prompt it produces is what the extension parses, so the two ends must
 * agree on one thing above all: the payload travels as ONE line. An objective
 * is free-form text with newlines in it, and a newline inside the JSON would
 * end the prompt's argument region instead of the string it belongs to.
 */

import { describe, expect, test } from 'bun:test';
import { modeCommandPrompt, modeEnvValue, parseModeRequest, parseModeSelection } from '@/server/lib/omp/mode/request';

describe('parseModeRequest', () => {
  test('accepts a well-formed request', () => {
    expect(parseModeRequest({ scope: 'plan', action: 'on' })).toEqual({ scope: 'plan', action: 'on', payload: undefined });
    expect(parseModeRequest({ scope: 'goal', action: 'create', payload: { objective: 'x' } })?.payload).toEqual({ objective: 'x' });
  });

  test('refuses an unknown scope or an empty action', () => {
    expect(parseModeRequest({ scope: 'vibe', action: 'on' })).toBeNull();
    expect(parseModeRequest({ scope: 'plan', action: '  ' })).toBeNull();
    expect(parseModeRequest({ scope: 'plan' })).toBeNull();
  });

  test('drops a payload that is not an object', () => {
    expect(parseModeRequest({ scope: 'plan', action: 'on', payload: 'x' })?.payload).toBeUndefined();
    expect(parseModeRequest({ scope: 'plan', action: 'on', payload: ['x'] })?.payload).toBeUndefined();
  });
});

describe('modeCommandPrompt', () => {
  test('renders one line for a payload with newlines', () => {
    const prompt = modeCommandPrompt({
      scope: 'goal',
      action: 'create',
      payload: { objective: 'line one\nline two' },
    });
    expect(prompt.includes('\n')).toBe(false);
    expect(prompt.startsWith('/kabmo-mode goal create ')).toBe(true);
    // Round-trips: the extension parses the same JSON back out.
    const json = prompt.slice('/kabmo-mode goal create '.length);
    expect(JSON.parse(json).objective).toBe('line one\nline two');
  });

  test('omits an empty payload', () => {
    expect(modeCommandPrompt({ scope: 'plan', action: 'off' })).toBe('/kabmo-mode plan off');
  });
});

describe('parseModeSelection', () => {
  test('absent flags mean off', () => {
    expect(parseModeSelection({})).toEqual({ plan: false, goal: false });
    expect(parseModeSelection({ plan: true })).toEqual({ plan: true, goal: false });
  });

  test('only a literal true turns a mode on', () => {
    expect(parseModeSelection({ plan: 'true', goal: 1 })).toEqual({ plan: false, goal: false });
  });
});

describe('modeEnvValue', () => {
  test('names only the modes that are on', () => {
    expect(modeEnvValue({ plan: true, goal: false })).toBe('plan');
    expect(modeEnvValue({ plan: false, goal: true })).toBe('goal');
    expect(modeEnvValue({ plan: true, goal: true })).toBe('plan,goal');
    expect(modeEnvValue({ plan: false, goal: false })).toBe('');
  });
});
