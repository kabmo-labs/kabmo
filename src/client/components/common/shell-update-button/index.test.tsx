/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The footer control is a CONTROL; every word a run says is in the dialog.
 *
 * That split is the whole point of this suite. The footer is a 24px row of glyphs,
 * and a status sentence pushed into it moved the neighbouring controls and read as
 * a status line for the SIDEBAR rather than for the update the user just asked for.
 * So the cases below assert the RENDERED tree in both states, not the module's
 * constants: a table in a module would pass while the footer rendered something
 * else.
 *
 * Three behaviours are load-bearing and each was a decision:
 *
 * 1. **A confirmation comes FIRST.** The click replaces the app and restarts it, so
 *    a 24px glyph must not do that on a single press with no words.
 * 2. **`done` and `error` print the SHELL's sentence**, inside the dialog. Nothing
 *    here invents "Update failed": a shell that verified the download and declined
 *    knows why, and that reason is the only thing a user can act on.
 * 3. **A shell that cannot install it gets a LINK**, and the dialog never opens.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ShellUpdateButton } from '@/client/components/common/shell-update-button';
import type { ShellDownload } from '@/client/hooks/ui/updates/shell-download';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const DESKTOP: ShellDownload = {
  url: 'https://github.com/kabmo-labs/kabmo/releases/download/v0.3.2/Kabmo-0.3.2-mac-arm64.zip',
  latest: '0.3.2',
  releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.8.0',
  direct: true,
  kind: 'update',
  platform: 'macos',
};

const PAGE: ShellDownload = { ...DESKTOP, url: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.8.0', direct: false };

let container: HTMLElement;

/** Install (or remove) a bridge on the page. */
function bridge(call: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | null): void {
  const page = globalThis as unknown as { window: { __kabmoCall?: unknown } };
  if (call) page.window.__kabmoCall = call;
  else delete page.window.__kabmoCall;
}

async function mount(download: ShellDownload): Promise<void> {
  await act(async () => {
    render(h(ShellUpdateButton, { download, variant: 'icon' }), container);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => {});
}

/**
 * The dialog, by its role — the same locator a browser spec would use.
 *
 * Queried on `document.body`, not on the render container: the dialog is a PORTAL
 * (see the component), which is what keeps it out of the footer row's own text.
 */
function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

/**
 * Both helpers search the whole body, because the dialog is a PORTAL: its controls
 * live beside the render container, not inside it. The footer control is inside the
 * container, which is itself in the body, so one query covers both.
 */
function byName(name: string): HTMLElement | null {
  return document.body.querySelector(`[aria-label="${name}"]`);
}

function buttonByText(text: string): HTMLElement | null {
  const buttons = [...document.body.querySelectorAll('button')];
  return (buttons.find((button) => button.textContent?.trim() === text) as HTMLElement | undefined) ?? null;
}

async function click(element: HTMLElement | null): Promise<void> {
  if (!element) throw new Error('nothing to click');
  await act(async () => {
    element.click();
  });
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  bridge(null);
});

afterAll(() => {
  container.remove();
  restoreDomGlobals();
});

describe('a shell that can install its own update', () => {
  test('the dialog is OUTSIDE the footer row, so the row says nothing about a run', async () => {
    // A dialog rendered inside the footer would put its sentence into the row's own
    // text content (measured in the browser before the portal: the row read as the
    // dialog's body). It also has to be a portal for a second reason — the row is a
    // 24px flex strip, and any `overflow`/`transform` added to it would clip a
    // `fixed` overlay.
    bridge(async () => ({ success: true, message: 'ok' }));
    await mount(DESKTOP);
    await click(byName('Update Kabmo 0.3.2 for macOS'));

    const modal = document.body.querySelector('[role="dialog"]');
    expect(modal).not.toBeNull();
    expect(container.contains(modal)).toBe(false);
    // The control itself carries no status text in any phase.
    expect(byName('Update Kabmo 0.3.2 for macOS')?.textContent?.trim()).toBe('');
  });

  test('draws a button, and opens a CONFIRMATION rather than installing on the press', async () => {
    const calls: string[] = [];
    bridge(async (method) => {
      calls.push(method);
      return { success: true, version: '0.3.2', message: 'Kabmo 0.3.2 installed — restarting.', relaunching: true };
    });
    await mount(DESKTOP);

    const control = byName('Update Kabmo 0.3.2 for macOS');
    expect(control?.tagName).toBe('BUTTON');
    // Nothing has been asked of the shell yet — that is the confirmation's job.
    expect(calls).toEqual([]);

    await click(control);
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Version 0.3.2');
    expect(dialog()?.textContent).toContain('replaces itself');
    // Still nothing: the press opened a dialog, it did not install.
    expect(calls).toEqual([]);
  });

  test('installing happens on the dialog’s own button, and the report stays IN the dialog', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = [];
    bridge(async (method, params) => {
      calls.push({ method, params });
      return { success: true, version: '0.3.2', message: 'Kabmo 0.3.2 installed — restarting.', relaunching: true };
    });
    await mount(DESKTOP);
    await click(byName('Update Kabmo 0.3.2 for macOS'));
    await click(buttonByText('Install update'));

    expect(calls).toEqual([
      { method: 'update_apply', params: { url: DESKTOP.url, version: '0.3.2' } },
    ]);

    // The sentence is the SHELL's, and it is inside the dialog.
    expect(dialog()?.textContent).toContain('Kabmo 0.3.2 installed — restarting.');
    // …and the footer carries no status line of its own: the control is still a
    // control, with its own label.
    expect(byName('Update Kabmo 0.3.2 for macOS')).not.toBeNull();
  });

  test('a refusal keeps the shell’s reason in the dialog, and offers another try', async () => {
    bridge(async () => ({ success: false, message: 'The downloaded file is not a signed Kabmo build.' }));
    await mount(DESKTOP);
    await click(byName('Update Kabmo 0.3.2 for macOS'));
    await click(buttonByText('Install update'));

    expect(dialog()?.textContent).toContain('The downloaded file is not a signed Kabmo build.');
    expect(buttonByText('Try again')).not.toBeNull();
    expect(buttonByText('Close')).not.toBeNull();
  });

  test('closing after a failure, then reopening, starts at the confirmation again', async () => {
    // A dismissed run is not a run: the next press must not greet the user with the
    // previous attempt's refusal.
    bridge(async () => ({ success: false, message: 'The download could not be downloaded.' }));
    await mount(DESKTOP);
    await click(byName('Update Kabmo 0.3.2 for macOS'));
    await click(buttonByText('Install update'));
    await click(buttonByText('Close'));
    expect(dialog()).toBeNull();

    await click(byName('Update Kabmo 0.3.2 for macOS'));
    expect(dialog()?.textContent).toContain('Version 0.3.2');
    expect(dialog()?.textContent).not.toContain('could not be downloaded');
  });

  test('Cancel closes without asking the shell anything', async () => {
    const calls: string[] = [];
    bridge(async (method) => {
      calls.push(method);
      return { success: true, message: 'ok' };
    });
    await mount(DESKTOP);
    await click(byName('Update Kabmo 0.3.2 for macOS'));
    await click(buttonByText('Cancel'));

    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('the phone footer’s variant', () => {
  test('draws the short label on the same button, and opens the same dialog', async () => {
    // The two layouts pass different `variant`s because a 24px glyph and a word are
    // different rows — but they must be the same CONTROL: a link on one layout and a
    // button on the other is the drift this component exists to prevent.
    bridge(async () => ({ success: true, version: '0.3.2', message: 'Kabmo 0.3.2 installed — restarting.' }));
    await act(async () => {
      render(h(ShellUpdateButton, { download: DESKTOP, variant: 'label' }), container);
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    const control = byName('Update Kabmo 0.3.2 for macOS');
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.textContent?.trim()).toBe('Update macOS');
    // The word sits BESIDE the glyph, never instead of it.
    expect(control?.querySelector('svg')).not.toBeNull();

    await click(control);
    expect(dialog()?.textContent).toContain('Version 0.3.2');
  });

  test('a LINK keeps the glyph too, because the mobile pair never self-updates', async () => {
    // The case this pins, and the bug it shipped: `canSelfUpdate` refuses Android
    // and iOS, so BOTH mobile offers take the link branch — and that branch drew the
    // word alone. Measured in the browser before the fix: the phone footer's APK
    // control was the only row without a mark beside its word.
    bridge(null);
    const install: ShellDownload = {
      url: 'https://github.com/kabmo-labs/kabmo/releases/download/v0.10.0/Kabmo-0.10.0-android.apk',
      latest: '0.10.0',
      releaseUrl: null,
      kind: 'install',
      platform: 'android',
      direct: true,
    };
    await act(async () => {
      render(h(ShellUpdateButton, { download: install, variant: 'label' }), container);
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    const control = byName('Install Kabmo 0.10.0 for Android');
    expect(control?.tagName).toBe('A');
    expect(control?.querySelector('svg')).not.toBeNull();
    expect(control?.textContent?.trim()).toBe('Get APK');
    // The row style is the phone's own, not the desktop glyph plate: no padding and
    // no hover background, so it lines up with Settings / About / Desktop.
    expect(control?.getAttribute('class')).not.toContain('p-1');
    expect(control?.getAttribute('class')).toContain('flex');
  });
});

describe('a shell that cannot install it', () => {
  test('draws a link to the release page, and no dialog', async () => {
    bridge(async () => null);
    await mount(PAGE);

    const control = byName('Update Kabmo 0.3.2 for macOS');
    expect(control?.tagName).toBe('A');
    expect(control?.getAttribute('href')).toBe(PAGE.url);
    expect(control?.getAttribute('target')).toBe('_blank');

    await click(control);
    expect(dialog()).toBeNull();
  });

  test('a browser draws the link too, because there is no shell to ask', async () => {
    bridge(null);
    await mount(DESKTOP);

    expect(byName('Update Kabmo 0.3.2 for macOS')?.tagName).toBe('A');
    expect(dialog()).toBeNull();
  });
});
