/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One rule for "what is this session called", read by three surfaces.
 *
 * The bug this pins: a session opened with `/skill:<name>` rendered as
 * "New Session - <timestamp>" in the sidebar while its header showed the
 * invocation. A skill turn is a `custom_message` with `customType:
 * "skill-prompt"` and NO `role` field, so the sidebar's prefix scan — which
 * looked for `"role":"user"` — found nothing, and the header's full read found
 * the turn through a mapper that dropped the operator's args.
 *
 * The raw-prefix reader is tested against the shapes a bounded window actually
 * holds: a JSON-escaped invocation line (`\"name\"`, not `"name"`) and an entry
 * cut mid-`content`.
 */

import { describe, expect, test } from 'bun:test';

import {
  countSkillPromptMarkers,
  firstOperatorTitleFromPrefix,
  operatorTitleFromEntry,
  skillChip,
  SKILL_PROMPT_CUSTOM_TYPE,
} from './operator-title';

describe('operatorTitleFromEntry', () => {
  test('reads a plain user turn', () => {
    expect(operatorTitleFromEntry({ type: 'message', message: { role: 'user', content: 'why is X slow' } }))
      .toBe('why is X slow');
  });

  test('reads a skill turn as the chip, with the args omp records', () => {
    expect(operatorTitleFromEntry({
      type: 'custom_message',
      customType: SKILL_PROMPT_CUSTOM_TYPE,
      attribution: 'user',
      content: 'ignored',
      details: { name: 'diagnose', args: 'why is X slow' },
    })).toBe('/skill:diagnose why is X slow');
  });

  test('recovers the skill name from the prompt when details are absent', () => {
    expect(operatorTitleFromEntry({
      type: 'custom_message',
      customType: SKILL_PROMPT_CUSTOM_TYPE,
      content: '[IMPORTANT: User invoked the \\"red-engineer\\" skill; follow its instructions.]',
    })).toBe('/skill:red-engineer');
  });

  test('an explicit agent attribution never names the session', () => {
    expect(operatorTitleFromEntry({
      type: 'custom_message',
      customType: SKILL_PROMPT_CUSTOM_TYPE,
      attribution: 'agent',
      details: { name: 'red-engineer' },
    })).toBeUndefined();
  });

  test('a non-operator entry is not a title', () => {
    expect(operatorTitleFromEntry({ type: 'message', message: { role: 'assistant', content: 'hi' } })).toBeUndefined();
    expect(operatorTitleFromEntry({ type: 'model_change', model: 'a/b' })).toBeUndefined();
  });
});

describe('firstOperatorTitleFromPrefix', () => {
  test('prefers a user turn in the window', () => {
    const prefix = '{"type":"message","message":{"role":"user","content":"fix the flaky test"}}';
    expect(firstOperatorTitleFromPrefix(prefix)).toBe('fix the flaky test');
  });

  test('finds a skill turn, whose entry carries no role field at all', () => {
    // Exactly the shape omp writes: a space after the colon, and the invocation
    // line's quotes escaped inside the JSON string.
    const prefix = '{"type":"custom_message","customType": "skill-prompt","content":"[IMPORTANT: User invoked the \\"diagnose\\" skill; follow';
    expect(firstOperatorTitleFromPrefix(prefix)).toBe('/skill:diagnose');
  });

  test('falls back to an assistant turn when the operator wrote nothing in the window', () => {
    const prefix = '{"type":"message","message":{"role":"assistant","content":"here is the answer"}}';
    expect(firstOperatorTitleFromPrefix(prefix)).toBe('here is the answer');
  });

  test('an unrelated customType is not mistaken for a skill turn', () => {
    const prefix = '{"type":"custom","customType": "system-prompt-digest","data":"abc"}';
    expect(firstOperatorTitleFromPrefix(prefix)).toBeUndefined();
  });
});

describe('countSkillPromptMarkers', () => {
  test('counts the compact marker omp actually writes', () => {
    const prefix = '{"type":"custom_message","customType":"skill-prompt","content":"[IMPORTANT: User invoked the \\"antislop-ui\\" skill';
    expect(countSkillPromptMarkers(prefix)).toBe(1);
  });

  test('counts a marker with a space after the colon', () => {
    expect(countSkillPromptMarkers('{"customType": "skill-prompt"}')).toBe(1);
  });

  test('an unrelated customType is not a skill turn', () => {
    expect(countSkillPromptMarkers('{"type":"custom","customType":"system-prompt-digest"}')).toBe(0);
  });

  test('a value cut by the window still counts', () => {
    // The 4 KiB window can end inside the value; the turn is still there.
    expect(countSkillPromptMarkers('{"customType":"skill-pro')).toBe(1);
  });
});

describe('skillChip', () => {
  test('appends args only when they exist', () => {
    expect(skillChip('diagnose')).toBe('/skill:diagnose');
    expect(skillChip('diagnose', 'why')).toBe('/skill:diagnose why');
    expect(skillChip('diagnose', '   ')).toBe('/skill:diagnose');
  });
});
