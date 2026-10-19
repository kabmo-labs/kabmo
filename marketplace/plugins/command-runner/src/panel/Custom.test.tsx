/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The custom-command UI: the always-present group, its Add button, and the
 * add/edit dialog.
 *
 * ## What is pinned here, and why each one is a bug shape
 *
 * - **The custom group renders even when the walk found nothing.** Its header
 *   holds the Add button, so this is the difference between a repository with no
 *   command file offering a way to add one and offering nothing at all.
 * - **The Add button is NOT inside the group's toggle.** A button inside a button
 *   is invalid HTML and the inner click is swallowed — which is why the custom
 *   header is not a disclosure at all, and this spec is what keeps it that way.
 * - **Edit/Delete appear only on a STORED command.** A command parsed from a
 *   `package.json` has no Kabmo-side row; offering Edit on it would open a
 *   dialog whose save could not reach the file it came from.
 * - **The dialog's scope choice and its refusal are real.** The workspace choice
 *   is disabled with no root, and a refusal is printed rather than the dialog
 *   closing as if it saved.
 *
 * Rendered with `h()` against happy-dom with real clicks, the same harness
 * `Groups.test.tsx` uses. The disclosure is CSS (`grid-template-rows`), so what
 * is asserted is `data-expanded`/`inert` — what the stylesheet and the
 * accessibility tree read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { CommandGroups } from './Groups';
import { CustomForm } from './CustomForm';
import type { CommandGroup, CustomCommand, RunLog, RunSummary } from '../protocol';

/**
 * The DOM globals the component tree reads.
 *
 * `Event` is in the list for a specific reason: happy-dom's `dispatchEvent`
 * checks `event instanceof Event` against ITS OWN class, so an event built from
 * Node's global is rejected with "parameter 1 is not of type 'Event'" — the
 * element's own window has to supply the constructor.
 */
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Node',
  'Text',
  'Element',
  'SVGElement',
  'Event',
] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
let calls: string[];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!saved.has(key)) saved.set(key, target[key]);
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved.has(key)) target[key] = saved.get(key);
    else delete target[key];
  }
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  calls = [];
});

/** A stored command, as the store would hand it over. */
function stored(command: string, id = `g:${command}`): CustomCommand {
  return { id, command, scope: 'global', root: null, cwd: '.', createdAt: 1 };
}

const CUSTOM_GROUP: CommandGroup = {
  file: 'Custom commands',
  cwd: '.',
  kind: 'custom',
  customGroup: true,
  commands: [
    { id: 'custom:g:deploy', name: 'deploy', label: 'deploy staging', argv: ['sh', '-c', 'deploy staging'], custom: stored('deploy staging', 'g:deploy') },
  ],
};

const FILE_GROUP: CommandGroup = {
  file: 'Makefile',
  cwd: '.',
  kind: 'make',
  commands: [{ id: 'Makefile#make:build', name: 'build', label: 'make build', argv: ['make', 'build'] }],
};

async function mountGroups(
  overrides: Partial<Parameters<typeof CommandGroups>[0]> = {},
): Promise<void> {
  container = document.createElement('div') as unknown as HTMLElement;
  document.body.appendChild(container as never);
  const props = {
    groups: [CUSTOM_GROUP, FILE_GROUP],
    runs: [] as RunSummary[],
    collapsedGroups: {} as Record<string, boolean>,
    background: {} as Record<string, boolean>,
    logs: {} as Record<string, RunLog>,
    onToggleGroup: (file: string, collapsed: boolean) => calls.push(`group:${file}:${collapsed}`),
    onToggleBackground: (id: string, next: boolean) => calls.push(`background:${id}:${next}`),
    onRun: (id: string) => calls.push(`run:${id}`),
    onStop: (id: string) => calls.push(`stop:${id}`),
    onReadLog: (id: string) => calls.push(`read:${id}`),
    onAdd: () => calls.push('add'),
    onEdit: (command: { label: string }) => calls.push(`edit:${command.label}`),
    onRemove: (command: { label: string }) => calls.push(`remove:${command.label}`),
    truncated: false,
    sources: ['Makefile', 'package.json'],
    ...overrides,
  };
  await act(async () => {
    render(h(CommandGroups, props), container);
  });
  await act(async () => {});
}

/** The button whose accessible name matches, or null. */
function byLabel(name: string): HTMLButtonElement | null {
  const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[];
  return buttons.find((b) => b.getAttribute('aria-label') === name) ?? null;
}

/** The element whose visible text contains the string. */
function byText(text: string): HTMLElement {
  const all = [...container.querySelectorAll('*')] as HTMLElement[];
  // The DEEPEST match: an ancestor's textContent contains every descendant's, so
  // the first hit would be the outermost wrapper.
  return all.reverse().find((el) => el.textContent?.includes(text))!;
}

describe('the custom group', () => {
  test('renders with its commands, and its header is NOT a disclosure', async () => {
    await mountGroups();
    const header = byText('Custom commands');
    // No `aria-expanded`: the header is a plain row, which is what keeps the Add
    // button inside it clickable (a button in a button is invalid HTML and the
    // inner click never fires).
    expect(header.getAttribute('aria-expanded')).toBeNull();
    expect(container.textContent).toContain('deploy staging');
  });

  test('is rendered even when the walk found no command file', async () => {
    await mountGroups({ groups: [{ ...CUSTOM_GROUP, commands: [] }] });
    // The Add button is the only way in, so the empty group is the entry point.
    expect(byLabel('Add your own command')).not.toBeNull();
    expect(container.textContent).toContain('No commands of your own yet');
    // And the note naming which files were looked for still renders, because the
    // custom group must not be mistaken for a found file.
    expect(container.textContent).toContain('package.json');
  });

  test('Add is offered on the custom group only', async () => {
    await mountGroups();
    expect(byLabel('Add your own command')).not.toBeNull();
    // One Add, not one per group.
    const adds = [...container.querySelectorAll('button[aria-label="Add your own command"]')];
    expect(adds).toHaveLength(1);
  });

  test('Add reports the click without toggling anything', async () => {
    await mountGroups();
    await act(async () => byLabel('Add your own command')!.click());
    expect(calls).toEqual(['add']);
  });

  test('Edit and Delete appear on a STORED command and not on a file command', async () => {
    await mountGroups();
    expect(byLabel('Edit deploy staging')).not.toBeNull();
    expect(byLabel('Delete deploy staging')).not.toBeNull();
    // The Makefile's `build` has no Kabmo-side row, so neither control exists
    // for it — an Edit that could not save anywhere is worse than no Edit.
    expect(byLabel('Edit make build')).toBeNull();
    expect(byLabel('Delete make build')).toBeNull();
  });

  test('Edit and Delete report the command they were clicked on', async () => {
    await mountGroups();
    await act(async () => byLabel('Edit deploy staging')!.click());
    await act(async () => byLabel('Delete deploy staging')!.click());
    expect(calls).toEqual(['edit:deploy staging', 'remove:deploy staging']);
  });

  test('without the handlers the controls are absent, not dead', async () => {
    await mountGroups({ onAdd: undefined, onEdit: undefined, onRemove: undefined });
    expect(byLabel('Add your own command')).toBeNull();
    expect(byLabel('Edit deploy staging')).toBeNull();
    // The command itself still runs — only the authoring controls are gone.
    expect(byLabel('Run deploy staging')).not.toBeNull();
  });
});

describe('the add/edit dialog', () => {
  async function mountForm(overrides: Partial<Parameters<typeof CustomForm>[0]> = {}): Promise<void> {
    container = document.createElement('div') as unknown as HTMLElement;
    document.body.appendChild(container as never);
    const props = {
      editing: null,
      root: '/ws',
      defaultCwd: '.',
      error: null,
      onCancel: () => calls.push('cancel'),
      onSubmit: (input: { command: string; scope: 'global' | 'repo'; cwd: string; previousId: string | null }) =>
        calls.push(`submit:${input.command}:${input.scope}:${input.cwd}:${input.previousId ?? '-'}`),
      ...overrides,
    };
    await act(async () => {
      render(h(CustomForm, props), container);
    });
    await act(async () => {});
  }

  function field(name: string): HTMLInputElement {
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
    const found = inputs.find((input) => input.placeholder === name);
    if (!found) throw new Error(`no field with placeholder ${name}`);
    return found;
  }

  /** Type into a controlled input the way a user does. */
  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function submitButton(): HTMLButtonElement {
    return container.querySelector('button[type="submit"]') as HTMLButtonElement;
  }

  test('is a dialog to assistive tech', async () => {
    await mountForm();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
  });

  test('defaults a NEW command to this workspace', async () => {
    await mountForm();
    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    // The workspace is the more specific of the two and the safer default: a
    // global command is the one that should take a deliberate click.
    const repo = radios.find((radio) => radio.value === 'repo')!;
    expect(repo.checked).toBe(true);
  });

  test('the workspace choice is DISABLED with no root, and global is selected', async () => {
    await mountForm({ root: null });
    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    const repo = radios.find((radio) => radio.value === 'repo')!;
    const global = radios.find((radio) => radio.value === 'global')!;
    expect(repo.disabled).toBe(true);
    expect(global.checked).toBe(true);
  });

  test('submits the typed command, scope and directory', async () => {
    await mountForm();
    await type(field('bun run build'), 'bun run build');
    await act(async () => submitButton().click());
    expect(calls).toEqual(['submit:bun run build:repo:.:-']);
  });

  test('refuses an empty command before the request, and says why', async () => {
    await mountForm();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().title).toContain('Type the command');
    await type(field('bun run build'), '   ');
    expect(submitButton().disabled).toBe(true);
  });

  test('a pasted multi-line command arrives as ONE line, so no refusal is needed', async () => {
    // The field is `<input type="text">`, and the HTML value sanitization
    // algorithm strips newlines from it — so the server's one-line rule is
    // unreachable from this dialog and the client does not duplicate it. What is
    // pinned is the behaviour that makes that true, because a switch to a
    // textarea would silently change it.
    await mountForm();
    await type(field('bun run build'), 'echo one\necho two');
    expect(field('bun run build').value).not.toContain('\n');
    expect(submitButton().disabled).toBe(false);
  });

  test('a stored command seeds the fields and carries previousId for the move', async () => {
    await mountForm({ editing: stored('deploy staging', 'g:deploy-staging') });
    expect(field('bun run build').value).toBe('deploy staging');
    // The id travels so the server can drop the row this edit moves away from —
    // the id is derived from the scope and the slug, so new text is a new row.
    await act(async () => submitButton().click());
    expect(calls).toEqual(['submit:deploy staging:global:.:g:deploy-staging']);
  });

  test('prints the server refusal instead of closing as if it saved', async () => {
    await mountForm({ error: 'A command needs at least one letter or digit.' });
    expect(container.textContent).toContain('A command needs at least one letter or digit.');
  });

  test('names the shell, because it decides what the text may contain', async () => {
    await mountForm();
    expect(container.textContent).toContain('sh -c');
  });
});
