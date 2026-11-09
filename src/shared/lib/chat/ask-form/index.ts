/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reads the HTML `<form>` omp's `ask` tool takes since 18.18.3.
 *
 * The tool used to take `questions[]`; it now takes one `{ html }` string and
 * the RPC host walks the form's named controls one dialog at a time. Kabmo
 * draws every question of the call at once, so it needs the same list omp
 * derived: the field's own text, else the sentence right before it, else its
 * `<fieldset>` legend, else a lone option's label, else the control name, plus
 * the option rows and the free-text "Other" row omp appends. This mirrors
 * `fieldQuestions`/`formAnswers` in omp's `pi-tui` (`html-form/data.ts`), which
 * the browser cannot import.
 *
 * The parser is deliberately small: agent-written forms use labels, fieldsets,
 * paragraphs, selects and plain inputs. Anything it cannot read degrades to the
 * control's `name`, never to a blank card.
 */

import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { toQuestions, type DraftField, type DraftOption } from '@/shared/lib/chat/ask-form/fields';
import {
  BLOCK,
  findChild,
  hasControl,
  HEADING,
  matchingClose,
  nameLabel,
  oneLine,
  SKIPPED,
  textOf,
  tokenize,
  type Token,
} from '@/shared/lib/chat/ask-form/tokens';

const IGNORED_INPUTS: Record<string, true> = {
  button: true,
  file: true,
  image: true,
  reset: true,
  submit: true,
  hidden: true,
};

/** Pre-pass: ids of controls, and the `<label for>` text that names them. */
function readLabelTargets(tokens: Token[]): Map<string, string> {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'open') continue;
    if (token.tag !== 'input' && token.tag !== 'select' && token.tag !== 'textarea') continue;
    if (token.attrs.id) ids.add(token.attrs.id);
  }
  const labels = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'open' || token.tag !== 'label' || token.selfClosing) continue;
    const target = token.attrs.for;
    if (!target || !ids.has(target) || labels.has(target)) continue;
    labels.set(target, textOf(tokens, index + 1, matchingClose(tokens, index, 'label')));
  }
  return labels;
}

/** Fields of one form, in document order, with the question text omp derives. */
export function parseAskForm(html: string): AskQuestion[] {
  if (!html.trim()) return [];
  const form = /<form\b[^>]*>([\s\S]*)<\/form>/i.exec(html);
  const tokens = tokenize(form ? form[1] : html);
  const labelFor = readLabelTargets(tokens);

  const fields: DraftField[] = [];
  const groups = new Map<string, DraftField>();
  let section = '';
  let caption = '';
  let inline = '';

  const flush = () => {
    const text = oneLine(inline);
    inline = '';
    if (text) caption = text;
  };

  const addField = (field: DraftField) => {
    flush();
    fields.push(field);
    caption = '';
  };

  const controlLabel = (attrs: Record<string, string>, wrapping: string | undefined): string => {
    const own = wrapping !== undefined ? oneLine(wrapping) : '';
    if (own) return own;
    const detached = attrs.id ? labelFor.get(attrs.id) : undefined;
    return detached ? oneLine(detached) : '';
  };

  const addInput = (attrs: Record<string, string>, wrapping: string | undefined) => {
    const type = (attrs.type ?? 'text').toLowerCase();
    if (IGNORED_INPUTS[type]) return;
    const name = attrs.name ?? '';
    if (type === 'radio' || type === 'checkbox') {
      const value = attrs.value ?? 'on';
      const option: DraftOption = {
        value,
        label: controlLabel(attrs, wrapping) || value || name,
        checked: 'checked' in attrs,
        disabled: 'disabled' in attrs,
      };
      const key = `${type}\u0000${name}`;
      const group = groups.get(key);
      if (group) {
        group.options.push(option);
        return;
      }
      const field: DraftField = {
        name,
        kind: 'choice',
        multi: type === 'checkbox',
        select: false,
        label: '',
        options: [option],
        value: '',
        multiline: false,
        caption,
        section,
      };
      groups.set(key, field);
      addField(field);
      return;
    }
    addField({
      name,
      kind: 'text',
      multi: false,
      select: false,
      label: controlLabel(attrs, wrapping) || nameLabel(name),
      options: [],
      value: attrs.value ?? '',
      multiline: false,
      caption,
      section,
    });
  };

  const addSelect = (attrs: Record<string, string>, inner: Token[], wrapping: string | undefined) => {
    const options: DraftOption[] = [];
    for (let index = 0; index < inner.length; index += 1) {
      const token = inner[index];
      if (token.kind !== 'open' || token.tag !== 'option') continue;
      const end = token.selfClosing ? index + 1 : matchingClose(inner, index, 'option');
      const text = textOf(inner, index + 1, end);
      options.push({
        value: token.attrs.value ?? text,
        label: text,
        checked: 'selected' in token.attrs,
        disabled: 'disabled' in token.attrs,
      });
      index = end;
    }
    const multi = 'multiple' in attrs;
    if (!multi && options.length > 0 && !options.some((option) => option.checked)) {
      const first = options.find((option) => !option.disabled);
      if (first) first.checked = true;
    }
    addField({
      name: attrs.name ?? '',
      kind: 'choice',
      multi,
      select: true,
      label: controlLabel(attrs, wrapping),
      options,
      value: '',
      multiline: false,
      caption,
      section,
    });
  };

  /**
   * Walk a token range. `quiet` is a `<label>` that wraps controls: its text is
   * the control's LABEL (already passed as `wrapping`), never a block of the
   * form, so it must not caption the field it names.
   */
  const walk = (
    start: number,
    end: number,
    wrapping: string | undefined,
    depth: number,
    quiet = false,
  ): void => {
    const settle = () => {
      if (!quiet) flush();
    };
    for (let index = start; index < end; index += 1) {
      const token = tokens[index];
      if (token.kind === 'text') {
        if (!quiet) inline += token.text;
        continue;
      }
      const tag = token.tag;
      if (tag.startsWith('/')) {
        if (BLOCK[tag.slice(1)] || HEADING[tag.slice(1)] || tag === '/legend' || tag === '/pre' || tag === '/table') {
          settle();
        }
        continue;
      }
      if (token.selfClosing) {
        if (tag === 'br' && !quiet) inline += '\n';
        else if (tag === 'hr') settle();
        else if (tag === 'input') addInput(token.attrs, wrapping);
        continue;
      }
      const close = matchingClose(tokens, index, tag);
      if (SKIPPED[tag]) {
        index = close;
        continue;
      }
      if (tag === 'label') {
        const target = token.attrs.for;
        if (target && labelFor.has(target)) {
          index = close;
          continue;
        }
        walk(index + 1, close, textOf(tokens, index + 1, close), depth, true);
        index = close;
        continue;
      }
      if (tag === 'fieldset') {
        settle();
        const legendAt = findChild(tokens, index + 1, close, 'legend');
        if (depth === 0 && !quiet) {
          // omp starts a NEW section at a top-level fieldset: the blocks before
          // it (a `<p>` caption included) do not reach the fields inside, which
          // borrow the legend instead. Keeping the caption made a form's
          // explanatory paragraph caption the first field — and since that
          // paragraph is not the title omp shows, the live dialog could not be
          // matched back to the question.
          caption = '';
          section = legendAt === -1 ? '' : textOf(tokens, legendAt + 1, matchingClose(tokens, legendAt, 'legend'));
          if (legendAt === -1) {
            walk(index + 1, close, wrapping, depth + 1);
          } else {
            walk(index + 1, legendAt, wrapping, depth + 1);
            walk(matchingClose(tokens, legendAt, 'legend') + 1, close, wrapping, depth + 1);
          }
          section = '';
        } else {
          walk(index + 1, close, wrapping, depth + 1, quiet);
        }
        settle();
        index = close;
        continue;
      }
      if (tag === 'legend' || HEADING[tag]) {
        settle();
        walk(index + 1, close, wrapping, depth, quiet);
        settle();
        index = close;
        continue;
      }
      if (BLOCK[tag]) {
        settle();
        walk(index + 1, close, wrapping, depth, quiet);
        settle();
        index = close;
        continue;
      }
      if (tag === 'ul' || tag === 'ol' || tag === 'pre' || tag === 'table') {
        settle();
        // A list of controls is layout; any other list is a block, which clears
        // the caption the next field would otherwise borrow.
        if ((tag === 'ul' || tag === 'ol') && hasControl(tokens, index + 1, close)) {
          walk(index + 1, close, wrapping, depth, quiet);
        } else if (!quiet) {
          caption = '';
        }
        settle();
        index = close;
        continue;
      }
      if (tag === 'input') {
        addInput(token.attrs, wrapping);
        continue;
      }
      if (tag === 'select') {
        addSelect(token.attrs, tokens.slice(index + 1, close), wrapping);
        index = close;
        continue;
      }
      if (tag === 'textarea') {
        addField({
          name: token.attrs.name ?? '',
          kind: 'text',
          multi: false,
          select: false,
          label: controlLabel(token.attrs, wrapping) || nameLabel(token.attrs.name ?? ''),
          options: [],
          value: textOf(tokens, index + 1, close),
          multiline: true,
          caption,
          section,
        });
        index = close;
        continue;
      }
      if (tag === 'img') {
        settle();
        if (!quiet) caption = '';
        continue;
      }
      // Inline markup (`code`, `strong`, `em`, `a`, `span`, …): keep its text.
      walk(index + 1, close, wrapping, depth, quiet);
      index = close;
    }
  };

  walk(0, tokens.length, undefined, 0);
  flush();

  return toQuestions(fields);
}
