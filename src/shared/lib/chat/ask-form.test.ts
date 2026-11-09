/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { parseAskForm } from '@/shared/lib/chat/ask-form';

describe('parseAskForm', () => {
  test('reads a radio group as one question with its legend, options and recorded pick', () => {
    const questions = parseAskForm(`<form>
      <fieldset>
        <legend>Session store</legend>
        <p>Sessions live in memory and are lost on restart.</p>
        <label><input type="radio" name="store" value="sqlite" checked> SQLite</label>
        <label><input type="radio" name="store" value="redis"> Redis</label>
      </fieldset>
    </form>`);

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe('store');
    expect(questions[0].question).toBe('Sessions live in memory and are lost on restart.');
    expect(questions[0].kind).toBe('choice');
    expect(questions[0].multi).toBe(false);
    expect(questions[0].options.map((option) => option.label)).toEqual([
      'SQLite',
      'Redis',
      'Other (type your own)',
    ]);
    expect(questions[0].options.map((option) => option.value)).toEqual(['sqlite', 'redis', undefined]);
    expect(questions[0].recommended).toBe(0);
  });

  test('a fieldset starts its own section, so a paragraph before it does not caption the field', () => {
    // omp's own tool example: the paragraph is context, the legend names the
    // group. Borrowing the paragraph made the live dialog title unmatchable.
    const questions = parseAskForm(`<form>
      <p>Sessions live in memory and are lost on restart.</p>
      <fieldset>
        <legend>Session store</legend>
        <label><input type="radio" name="store" value="sqlite" checked> SQLite</label>
        <label><input type="radio" name="store" value="redis"> Redis</label>
      </fieldset>
      <label>Session lifetime (days) <input type="number" name="ttl_days" value="30"></label>
    </form>`);

    expect(questions.map((question) => question.question)).toEqual(['Session store', 'Session lifetime (days)']);
    expect(questions[0].recommended).toBe(0);
  });

  test('falls back to the legend, then to the control name, when nothing captions the field', () => {
    const questions = parseAskForm(`<form>
      <fieldset>
        <legend>Authentication</legend>
        <label>Token <input name="token"></label>
        <input name="sentry_dsn">
      </fieldset>
    </form>`);

    expect(questions.map((question) => question.question)).toEqual(['Token', 'sentry dsn']);
    // The legend already titled the section; the caption is the nearest text block.
    expect(questions[0].kind).toBe('text');
  });

  test('reads a checkbox group as multi-select and keeps an explicit Other row', () => {
    const questions = parseAskForm(`<form>
      <p>Which sources?</p>
      <label><input type="checkbox" name="sources" value="git"> Git</label>
      <label><input type="checkbox" name="sources" value="jira" checked> Jira</label>
      <label><input type="checkbox" name="sources" value="other"> Other (describe)</label>
    </form>`);

    expect(questions[0]).toMatchObject({ id: 'sources', multi: true, question: 'Which sources?' });
    expect(questions[0].options.map((option) => option.label)).toEqual(['Git', 'Jira', 'Other (describe)']);
  });

  test('a lone checkbox asks its own label and gains no Other row', () => {
    const questions = parseAskForm(`<form>
      <label><input type="checkbox" name="agree" value="yes"> I agree to the terms</label>
    </form>`);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ id: 'agree', question: 'I agree to the terms', multi: true });
    expect(questions[0].options.map((option) => option.label)).toEqual(['I agree to the terms']);
  });

  test('reads a select with its options, first enabled preselected, and no Other row', () => {
    const questions = parseAskForm(`<form>
      <label>Session lifetime <input type="number" name="ttl_days" value="30" min="1"></label>
      <fieldset>
        <legend>Store</legend>
        <select name="store">
          <option value="sqlite">SQLite</option>
          <option value="redis" disabled>Redis</option>
        </select>
      </fieldset>
    </form>`);

    expect(questions.map((question) => question.question)).toEqual(['Session lifetime', 'Store']);
    expect(questions[0]).toMatchObject({ id: 'ttl_days', kind: 'text', multi: false });
    expect(questions[1].options.map((option) => option.label)).toEqual(['SQLite', 'Redis']);
    expect(questions[1].recommended).toBe(0);
  });

  test('reads a textarea and a <label for> outside the control', () => {
    const questions = parseAskForm(`<form>
      <label for="notes">Notes</label>
      <p>Anything else?</p>
      <textarea id="notes" name="notes">line one</textarea>
    </form>`);

    expect(questions[0]).toMatchObject({ id: 'notes', question: 'Notes', kind: 'text' });
  });

  test('keeps inline markup inside a label as text and drops unnamed controls', () => {
    const questions = parseAskForm(`<form>
      <label>Run <code>make</code> <strong>now</strong>? <input type="radio" name="run" value="yes"></label>
      <label><input type="radio" name="run" value="no"> later</label>
      <input value="unnamed">
    </form>`);

    expect(questions).toHaveLength(1);
    // No caption, legend or lone option to name it, so omp falls back to the name.
    expect(questions[0].question).toBe('run');
    expect(questions[0].options.map((option) => option.label)).toEqual([
      'Run make now?',
      'later',
      'Other (type your own)',
    ]);
  });

  test('falls back to the lone option label when a radio has no caption at all', () => {
    const questions = parseAskForm(`<form><label>Yes <input type="radio" name="ok" value="yes"></label></form>`);
    expect(questions[0].question).toBe('Yes');
  });
});
