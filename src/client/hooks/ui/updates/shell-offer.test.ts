/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useShellOffer` — the one hook both sidebars call.
 *
 * The pure decision table is pinned next door; what this file covers is the
 * WIRING, which is where the reported bug lived: an APK two versions behind a
 * running server drew no button, and no unit test of `shouldOfferShellDownload`
 * could have seen it, because the hook never asked the server at all.
 *
 * Three facts it reads, and each has been wrong at some point:
 *
 * 1. the MOBILE shell's version, from the bootstrap the server wrote for this
 *    request (the `KabmoAndroid/<v>` token);
 * 2. the DESKTOP shell's version, from the bridge identity injected before the
 *    first script — a desktop app carries no UA token;
 * 3. the release itself, fetched from the shell's own route, with the desktop
 *    trio sharing one endpoint and an explicit `kind`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useShellOffer } from '@/client/hooks/ui/updates/shell-download';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

/** The payload every route answers in these cases. */
const RELEASE = {
  url: 'https://github.com/kabmo-labs/kabmo/releases/download/v0.7.0/Kabmo-0.6.0-android.apk',
  latest: '0.6.0',
  releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0',
};

function Harness({ fetchImpl }: { fetchImpl: typeof fetch }) {
  const offer = useShellOffer(fetchImpl);
  return h('span', { id: 'offer' }, offer ? `${offer.kind}:${offer.platform}:${offer.latest}` : 'none');
}

/** A fetch double that answers the release payload and records the URLs asked. */
function stubFetch(asked: string[]) {
  return (async (input: string | URL | Request) => {
    asked.push(String(input));
    return { ok: true, json: async () => RELEASE } as Response;
  }) as unknown as typeof fetch;
}

async function mount(fetchImpl: typeof fetch): Promise<string> {
  await act(async () => {
    render(h(Harness, { fetchImpl }), container);
  });
  // The probe is an effect: let its promise settle and re-render.
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  return container.querySelector('#offer')?.textContent ?? '';
}

/** Install a bootstrap and (optionally) a bridge identity on the page. */
function shell(options: { bootstrap?: Record<string, unknown>; desktop?: Record<string, unknown> }): void {
  const page = globalThis as unknown as {
    window: {
      __OMP_BOOTSTRAP__?: Record<string, unknown>;
      __kabmoDesktop?: Record<string, unknown>;
    };
  };
  delete page.window.__OMP_BOOTSTRAP__;
  delete page.window.__kabmoDesktop;
  if (options.bootstrap) page.window.__OMP_BOOTSTRAP__ = options.bootstrap;
  if (options.desktop) page.window.__kabmoDesktop = options.desktop;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  shell({});
});

afterAll(() => {
  container.remove();
  restoreDomGlobals();
});

describe('the Android shell', () => {
  test('offers an update when the APK is behind the published asset', async () => {
    // The reported incident: server v0.7.0, APK v0.5.0, published 0.6.0, and
    // the sidebar drew nothing because the probe answered `null`.
    shell({ bootstrap: { shellVersion: '0.5.0', isAndroid: true } });
    const asked: string[] = [];

    expect(await mount(stubFetch(asked))).toBe('update:android:0.6.0');
    expect(asked, 'the Android route').toEqual(['/api/updates/android']);
  });

  test('offers nothing when the APK is the published build', async () => {
    shell({ bootstrap: { shellVersion: '0.6.0', isAndroid: true } });
    expect(await mount(stubFetch([]))).toBe('none');
  });

  test('offers an INSTALL to a browser on Android, and nothing on a desktop browser', async () => {
    shell({ bootstrap: { isAndroid: true } });
    expect(await mount(stubFetch([]))).toBe('install:android:0.6.0');

    shell({ bootstrap: { isAndroid: false } });
    expect(await mount(stubFetch([]))).toBe('none');
  });
});

describe('the iOS shell', () => {
  test('reads its own token and its own route', async () => {
    shell({ bootstrap: { iosShellVersion: '0.1.0' } });
    const asked: string[] = [];

    expect(await mount(stubFetch(asked))).toBe('update:ios:0.6.0');
    expect(asked).toEqual(['/api/updates/ios']);
  });

  test('an iOS browser is offered nothing, because an IPA cannot be installed from a page', async () => {
    shell({ bootstrap: {} });
    expect(await mount(stubFetch([]))).toBe('none');
  });
});

describe('the desktop shells', () => {
  test('reads the version from the bridge and the route from the kind', async () => {
    // No bootstrap token at all: a desktop app reports itself over the bridge,
    // and the console had no way to read it before this.
    shell({ desktop: { platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true } });
    const asked: string[] = [];

    expect(await mount(stubFetch(asked))).toBe('update:macos:0.6.0');
    expect(asked).toEqual(['/api/updates/desktop?kind=macos']);
  });

  test('each desktop shell asks for its own kind', async () => {
    for (const platform of ['windows', 'linux'] as const) {
      shell({ desktop: { platform, shellVersion: '0.1.0' } });
      const asked: string[] = [];
      await mount(stubFetch(asked));
      expect(asked, platform).toEqual([`/api/updates/desktop?kind=${platform}`]);
    }
  });

  test('a current desktop build offers nothing', async () => {
    shell({ desktop: { platform: 'windows', shellVersion: '0.6.0' } });
    expect(await mount(stubFetch([]))).toBe('none');
  });

  test('a browser on a desktop is offered nothing', async () => {
    shell({ bootstrap: { isAndroid: false } });
    expect(await mount(stubFetch([]))).toBe('none');
  });

  test('the desktop identity wins over a mobile token, because that is the shell asking', async () => {
    // A page cannot carry both in practice, and if it somehow did the desktop
    // app is the process whose version is being compared.
    shell({
      bootstrap: { shellVersion: '0.1.0', isAndroid: true },
      desktop: { platform: 'linux', shellVersion: '0.1.0' },
    });
    expect(await mount(stubFetch([]))).toBe('update:linux:0.6.0');
  });

  test('a refused probe draws no button', async () => {
    shell({ desktop: { platform: 'macos', shellVersion: '0.1.0' } });
    const refusing = (async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await mount(refusing)).toBe('none');
  });

  test('a payload with no artifact draws no button', async () => {
    shell({ desktop: { platform: 'macos', shellVersion: '0.1.0' } });
    const empty = (async () =>
      ({
        ok: true,
        json: async () => ({ url: null, latest: null, releaseUrl: null }),
      }) as Response) as unknown as typeof fetch;
    expect(await mount(empty)).toBe('none');
  });
});
