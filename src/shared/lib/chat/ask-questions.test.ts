/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import {
  groupAskFrames,
  parseAskQuestions,
  normalizeAskText,
} from '@/shared/lib/chat/ask-questions';
import { parseAskResult } from '@/shared/lib/chat/ask-results';

function askTool(input: unknown, extra: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 'call_ask_1', type: 'ask', title: 'ask', name: 'ask', input: input as Record<string, unknown>, ...extra };
}

function selectFrame(id: string, title: string, options: string[] = ['A', 'B']): ExtensionUiDialogRequest {
  return { type: 'extension_ui_request', id, method: 'select', title, options };
}

const THREE_QUESTIONS = {
  questions: [
    {
      id: 'language',
      header: 'Language',
      question: 'Which language should we use for this test?',
      options: [{ label: 'Python', description: 'Use Python for testing' }, { label: 'TypeScript' }],
      recommended: 0,
    },
    { id: 'style', question: 'What answer style do you prefer for testing?', options: [{ label: 'Balanced' }] },
    { id: 'confirm', question: 'Did this render correctly?', options: [{ label: 'Yes' }, { label: 'No' }] },
  ],
};

describe('parseAskQuestions', () => {
  test('reads every question, not just the first', () => {
    const questions = parseAskQuestions(askTool(THREE_QUESTIONS));
    expect(questions.map((q) => q.id)).toEqual(['language', 'style', 'confirm']);
    expect(questions[0].options[0]).toEqual({ label: 'Python', description: 'Use Python for testing' });
    expect(questions[0].recommended).toBe(0);
    expect(questions[1].multi).toBe(false);
  });

  test('is empty for a non-ask payload, so the card falls back to the raw result', () => {
    expect(parseAskQuestions(askTool({ question: 'single legacy shape' }))).toEqual([]);
    expect(parseAskQuestions(askTool(undefined))).toEqual([]);
  });

  test('drops entries without question text instead of rendering a blank block', () => {
    const questions = parseAskQuestions(askTool({ questions: [{ id: 'a' }, { id: 'b', question: '  Keep me  ' }] }));
    expect(questions).toEqual([expect.objectContaining({ id: 'b', question: 'Keep me' })]);
  });
});

describe('the 18.18.3 html form shape', () => {
  const FORM = `<form>
    <p>Which store?</p>
    <label><input type="radio" name="store" value="sqlite" checked> SQLite</label>
    <label><input type="radio" name="store" value="redis"> Redis</label>
    <label>Days <input type="number" name="days" value="30"></label>
    <p>Sources?</p>
    <label><input type="checkbox" name="sources" value="git"> Git</label>
    <label><input type="checkbox" name="sources" value="jira"> Jira</label>
  </form>`;
  const questions = parseAskQuestions(askTool({ html: FORM }));

  test('reads every named control as a question, in form order', () => {
    expect(questions.map((question) => question.id)).toEqual(['store', 'days', 'sources']);
    expect(questions.map((question) => question.question)).toEqual(['Which store?', 'Days', 'Sources?']);
    expect(questions[0].options.map((option) => option.label)).toEqual([
      'SQLite',
      'Redis',
      'Other (type your own)',
    ]);
    expect(questions[2].multi).toBe(true);
  });

  test('reads details.answers by control name', () => {
    const answers = parseAskResult(askTool({ html: FORM }, {
      details: {
        answers: [
          { name: 'store', question: 'Which store?', answer: 'Redis' },
          { name: 'days', question: 'Days', answer: '45' },
          { name: 'sources', question: 'Sources?', answer: 'Git, Other: bitbucket' },
        ],
      },
    }), questions);

    expect(answers[0]).toEqual({ selectedOptions: ['Redis'], customInput: undefined, timedOut: false });
    expect(answers[1]).toEqual({ selectedOptions: [], customInput: '45', timedOut: false });
    expect(answers[2]).toEqual({ selectedOptions: ['Git'], customInput: 'bitbucket', timedOut: false });
  });

  test('flags the recorded answers when the timeout submitted the defaults', () => {
    const answers = parseAskResult(askTool({ html: FORM }, {
      details: { timedOut: true, answers: [{ name: 'store', question: 'Which store?', answer: 'SQLite' }] },
    }), questions);
    expect(answers[0]?.timedOut).toBe(true);
  });

  test('recovers the raw form data from the result text when details were dropped', () => {
    const output = `User answers:\n{\n  "store": "redis",\n  "days": 45,\n  "sources": ["git", "jira"]\n}`;
    const answers = parseAskResult(askTool({ html: FORM }, { output }), questions);
    expect(answers.map((answer) => answer?.selectedOptions)).toEqual([['Redis'], [], ['Git', 'Jira']]);
    expect(answers[1]?.customInput).toBe('45');
  });

  test('puts a re-asked field, decorated with its validation error, on the same question', () => {
    const frames: ExtensionUiDialogRequest[] = [
      selectFrame('f1', 'Which store?'),
      { type: 'extension_ui_request', id: 'f2', method: 'input', title: 'Days (Enter a number)' },
      selectFrame('f3', '(1 selected) Sources?'),
    ];
    const groups = groupAskFrames(questions, frames);
    expect(groups.map((group) => group.map((frame) => frame.id))).toEqual([['f1'], ['f2'], ['f3']]);
  });
});

describe('normalizeAskText', () => {
  test('strips the progress suffix and the multi-select prefix omp decorates titles with', () => {
    expect(normalizeAskText('Which language? (2/3)')).toBe('which language?');
    expect(normalizeAskText('(2 selected) Which language?')).toBe('which language?');
    expect(normalizeAskText('(1 selected) Pick one (3/3)')).toBe('pick one');
  });
});

describe('groupAskFrames', () => {
  const questions = parseAskQuestions(askTool(THREE_QUESTIONS));

  test('puts each dialog on the question that raised it', () => {
    const frames = [
      selectFrame('f1', 'Which language should we use for this test? (1/3)'),
      selectFrame('f2', 'What answer style do you prefer for testing? (2/3)'),
      selectFrame('f3', 'Did this render correctly? (3/3)'),
    ];
    const groups = groupAskFrames(questions, frames);
    expect(groups.map((group) => group.map((frame) => frame.id))).toEqual([['f1'], ['f2'], ['f3']]);
  });

  test('keeps the free-text follow-up dialog on the question that asked for it', () => {
    const frames: ExtensionUiDialogRequest[] = [
      selectFrame('f1', 'Which language should we use for this test? (1/3)'),
      { type: 'extension_ui_request', id: 'f1b', method: 'editor', title: 'Which language should we use for this test?' },
      selectFrame('f2', 'What answer style do you prefer for testing? (2/3)'),
    ];
    const groups = groupAskFrames(questions, frames);
    expect(groups[0].map((frame) => frame.id)).toEqual(['f1', 'f1b']);
    expect(groups[1].map((frame) => frame.id)).toEqual(['f2']);
    expect(groups[2]).toEqual([]);
  });

  test('falls back to order when a rebuild decorates the title in a way we cannot parse', () => {
    const frames = [
      selectFrame('f1', 'Some unknown header'),
      selectFrame('f2', 'Another unknown header'),
      selectFrame('f3', 'A third unknown header'),
    ];
    const groups = groupAskFrames(questions, frames);
    expect(groups.map((group) => group.map((frame) => frame.id))).toEqual([['f1'], ['f2'], ['f3']]);
  });

  test('keeps repeated multi-select dialogs on the question being answered', () => {
    const frames = [
      selectFrame('f1', '(1 selected) Which language should we use for this test? (1/3)'),
      selectFrame('f2', '(1 selected) Which language should we use for this test? (1/3)'),
      selectFrame('f3', 'What answer style do you prefer for testing? (2/3)'),
    ];
    const groups = groupAskFrames(questions, frames);
    expect(groups[0].map((frame) => frame.id)).toEqual(['f1', 'f2']);
    expect(groups[1].map((frame) => frame.id)).toEqual(['f3']);
  });
});

describe('parseAskResult', () => {
  const questions = parseAskQuestions(askTool(THREE_QUESTIONS));

  test('reads every recorded answer from details.results', () => {
    const answers = parseAskResult(askTool(THREE_QUESTIONS, {
      details: {
        results: [
          { id: 'language', question: 'Which language?', selectedOptions: ['Python'] },
          { id: 'style', question: 'Style?', selectedOptions: [], customInput: 'Dadadada' },
          { id: 'confirm', question: 'Correct?', selectedOptions: ['Yes'], timedOut: true },
        ],
      },
    }), questions);

    expect(answers[0]).toEqual({ selectedOptions: ['Python'], customInput: undefined, timedOut: false });
    expect(answers[1]?.customInput).toBe('Dadadada');
    expect(answers[2]?.timedOut).toBe(true);
  });

  test('reads the flat shape omp returns for a single-question ask', () => {
    const single = parseAskQuestions(askTool({ questions: [THREE_QUESTIONS.questions[0]] }));
    const answers = parseAskResult(askTool({}, { details: { selectedOptions: ['Go'], multi: false } }), single);
    expect(answers[0]?.selectedOptions).toEqual(['Go']);
  });

  test('leaves every question unanswered while the ask is still running', () => {
    expect(parseAskResult(askTool(THREE_QUESTIONS), questions)).toEqual([null, null, null]);
  });

  test('falls back to the rendered text when details never reached the client', () => {
    const output = 'User answers:\nlanguage: Python\nstyle: Balanced\nconfirm: Yes';
    const answers = parseAskResult(askTool(THREE_QUESTIONS, { output }), questions);
    expect(answers.map((answer) => answer?.selectedOptions)).toEqual([['Python'], ['Balanced'], ['Yes']]);
  });

  test('reads a typed custom answer out of the rendered text', () => {
    const output = 'User answers:\nlanguage: Python\nstyle: "Dadadada"\nconfirm: Yes';
    const answers = parseAskResult(askTool(THREE_QUESTIONS, { output }), questions);
    expect(answers[1]).toEqual({ selectedOptions: [], customInput: 'Dadadada' });
  });

  test('reads the single-question result shapes', () => {
    const single = parseAskQuestions(askTool({ questions: [THREE_QUESTIONS.questions[0]] }));
    expect(parseAskResult(askTool({}, { output: 'User selected: Python' }), single)[0]?.selectedOptions).toEqual(['Python']);
    expect(parseAskResult(askTool({}, { output: 'User provided custom input: Dadadada' }), single)[0]?.customInput)
      .toBe('Dadadada');
  });

  test('never reads a failure message as an answer', () => {
    const failed = askTool(THREE_QUESTIONS, {
      output: 'Ask tool was cancelled by the user',
      status: 'error' as const,
    });
    expect(parseAskResult(failed, questions)).toEqual([null, null, null]);
  });
});
