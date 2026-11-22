/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp 19.1.0's `method:"form"` frame — the RPC host's `ui.formDialog`.
 *
 * The `ask` tool stopped walking its HTML form one blocking dialog at a time
 * and now sends the whole form once, keyed by the same `html` the tool call's
 * arguments carry, answered by ONE `{ data }` reply. Two facts matter here and
 * neither is visible to a type check:
 *
 * 1. The frame must be CLAIMED by its call. Unclaimed, it reached the modal —
 *    a panel with no form body — while the agent stayed blocked.
 * 2. The `data` payload must satisfy omp's validation (`parseFormDialogResponse`):
 *    an unknown key, a disabled option, an array where a single string is
 *    expected, or a missing required field is refused and the run parks.
 */

import { describe, expect, test } from 'bun:test';

import { splitAskFrames } from '@/client/hooks/chat/timeline/ask-frames';
import { buildFormData, formAnswers, isArrayQuestion } from '@/shared/lib/chat/ask-form/data';
import { parseAskForm } from '@/shared/lib/chat/ask-form';
import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';
import type { ChatMessageData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';

const HTML = `<form>
  <fieldset>
    <legend>Flavour</legend>
    <label><input type="radio" name="flavour" value="yes" checked> Yes</label>
    <label><input type="radio" name="flavour" value="no"> No</label>
  </fieldset>
  <label>Serving <input type="number" name="serving" value="1" required></label>
  <label><input type="checkbox" name="extras" value="ice"> Ice</label>
  <label><input type="checkbox" name="extras" value="lemon"> Lemon</label>
</form>`;

function askTool(html: string) {
  return {
    id: 'call-ask',
    type: 'custom' as const,
    title: 'ask',
    name: 'ask',
    input: { html },
    status: 'running' as const,
  };
}

function message(html: string): ChatMessageData {
  return { id: 'm1', role: 'ai', content: '', toolCalls: [askTool(html)] } as unknown as ChatMessageData;
}

const formFrame: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'frame-form',
  method: 'form',
  html: HTML,
};

describe('splitAskFrames with a form frame', () => {
  test('claims the ask by its html and never reaches the modal', () => {
    const split = splitAskFrames([message(HTML)], [formFrame], true);
    expect(split.formByTool.get('call-ask')).toBe(formFrame);
    expect(split.orphanAsks).toEqual([]);
    expect(split.modalRequest).toBeNull();
  });

  test('a form no ask raised is an inline orphan, not a modal', () => {
    const split = splitAskFrames([], [formFrame], true);
    expect(split.formByTool.size).toBe(0);
    expect(split.orphanAsks).toEqual([formFrame]);
    expect(split.modalRequest).toBeNull();
  });

  test('falls back to the single open ask when the html differs only in whitespace', () => {
    const reindented = HTML.replace(/\n\s*/g, ' ');
    const split = splitAskFrames([message(HTML)], [{ ...formFrame, html: reindented }], true);
    expect(split.formByTool.get('call-ask')?.id).toBe('frame-form');
  });

  test('an empty queue reports an empty form map', () => {
    expect(splitAskFrames([message(HTML)], [], true).formByTool.size).toBe(0);
  });
});

describe('buildFormData', () => {
  const questions = parseAskForm(HTML);

  test('the form parses into one question per control name', () => {
    expect(questions.map((question) => question.id)).toEqual(['flavour', 'serving', 'extras']);
    expect(questions[0].multi).toBe(false);
    expect(questions[2].multi).toBe(true);
    expect(isArrayQuestion(questions[2])).toBe(true);
  });

  test('carries required and disabled through the parser', () => {
    expect(questions[1].required).toBe(true);
    const withDisabled = parseAskForm(
      '<form><fieldset><legend>Pick</legend>' +
        '<label><input type="radio" name="a" value="1" disabled> One</label>' +
        '<label><input type="radio" name="a" value="2"> Two</label></fieldset></form>',
    );
    expect(withDisabled[0].options[0].disabled).toBe(true);
  });

  test('a single choice submits one string and a group an array', () => {
    const built = buildFormData(questions, {
      0: { selected: ['Yes'], text: '' },
      1: { selected: [], text: '2' },
      2: { selected: ['Ice', 'Lemon'], text: '' },
    });
    expect(built).toEqual({ data: { flavour: 'yes', serving: '2', extras: ['ice', 'lemon'] } });
  });

  test('a typed answer stands in for the single choice', () => {
    const built = buildFormData(questions, {
      0: { selected: [], text: 'oat' },
      1: { selected: [], text: '1' },
    });
    expect('data' in built && built.data.flavour).toBe('oat');
  });

  test('Other text joins a checkbox group as an extra entry', () => {
    const built = buildFormData(questions, {
      0: { selected: ['No'], text: '' },
      1: { selected: [], text: '3' },
      2: { selected: ['Ice'], text: 'sprinkles' },
    });
    expect('data' in built && built.data.extras).toEqual(['ice', 'sprinkles']);
  });

  test('a required field left empty names the question instead of sending', () => {
    const built = buildFormData(questions, { 0: { selected: ['Yes'], text: '' } });
    expect(built).toEqual({ missing: questions[1].question });
  });

  test('nothing answered at all is refused rather than sent as {}', () => {
    const optional = parseAskForm('<form><label>Note <input name="note"></label></form>');
    expect(buildFormData(optional, {})).toEqual({ missing: 'Answer at least one question.' });
  });

  test('a disabled option is never sent', () => {
    const withDisabled = parseAskForm(
      '<form><fieldset><legend>Pick</legend>' +
        '<label><input type="radio" name="a" value="1" disabled> One</label>' +
        '<label><input type="radio" name="a" value="2"> Two</label></fieldset></form>',
    );
    const built = buildFormData(withDisabled, { 0: { selected: ['One'], text: '' } });
    expect(built).toEqual({ missing: 'Answer at least one question.' });
  });

  test('formAnswers reports every control in form order', () => {
    const answers = formAnswers(questions, { 1: { selected: [], text: '4' } });
    expect(answers.map((answer) => answer.name)).toEqual(['flavour', 'serving', 'extras']);
    expect(answers[1].value).toBe('4');
    // The radio group is not `required`, so an unanswered one is simply absent
    // from the payload rather than named as a blocker.
    expect(answers[0]).toEqual({ name: 'flavour', value: '' });
  });
});

describe('AskQuestion required flag', () => {
  test('is absent on a form whose controls are all optional', () => {
    const questions: AskQuestion[] = parseAskForm('<form><label>Note <input name="note"></label></form>');
    expect(questions[0].required).toBeUndefined();
  });
});
