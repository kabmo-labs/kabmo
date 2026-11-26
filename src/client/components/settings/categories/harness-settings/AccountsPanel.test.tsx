import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { HarnessAccountsPanel, type AccountsPanelProps } from '@/client/components/settings/categories/harness-settings/AccountsPanel';
import type { HarnessAccountView } from '@kabmo-labs/kabmo-harness/accounts';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

function account(overrides: Partial<HarnessAccountView> = {}): HarnessAccountView {
  return {
    id: 'acct-1',
    harness: 'codex',
    label: 'Work',
    homePath: '/tmp/kabmo/accounts/acct-1',
    identity: {},
    authKind: 'unknown',
    signedIn: false,
    detail: 'No readable auth.json in this home yet.',
    loginCommand: 'CODEX_HOME=/tmp/kabmo/accounts/acct-1 codex login',
    createdAt: 1,
    verifiedAt: 0,
    ...overrides,
  };
}

function panel(overrides: Partial<AccountsPanelProps> = {}): AccountsPanelProps {
  return {
    harness: 'codex',
    accounts: [],
    selectedId: null,
    onCreate: async () => ({ error: null }),
    onSelect: async () => ({ error: null }),
    onRename: async () => ({ error: null }),
    onRemove: async () => ({ error: null }),
    onVerify: async () => ({ error: null }),
    ...overrides,
  };
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')]
    .find((element) => (element.textContent ?? '').trim() === label);
  if (!found) throw new Error(`No button named ${label}`);
  return found as HTMLButtonElement;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

describe('HarnessAccountsPanel', () => {
  test('an empty state says what new chats use instead', () => {
    act(() => render(h(HarnessAccountsPanel, panel()), container));
    expect(container.textContent).toContain('No saved accounts yet');
    expect(container.textContent).toContain('system default');
  });

  test('an unsigned account shows its own sign-in command and Verify calls it', async () => {
    let verified = '';
    act(() => render(
      h(HarnessAccountsPanel, panel({
        accounts: [account()],
        selectedId: 'acct-1',
        onVerify: async (id) => { verified = id; return { error: null, signedIn: false, detail: 'No login yet.' }; },
      })),
      container,
    ));
    expect(container.textContent).toContain('CODEX_HOME=/tmp/kabmo/accounts/acct-1 codex login');
    expect(container.textContent).toContain('Not signed in');
    expect(button('Sign in')).toBeDefined();
    await act(async () => { button('Verify').click(); });
    expect(verified).toBe('acct-1');
  });

  test('Add account sends the typed label', async () => {
    let created = '';
    act(() => render(
      h(HarnessAccountsPanel, panel({
        onCreate: async (label) => { created = label; return { error: null, createdId: 'acct-2' }; },
      })),
      container,
    ));
    const input = container.querySelector('input')!;
    act(() => {
      input.value = 'Personal';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('Personal');
    await act(async () => { button('Add account').click(); });
    expect(created).toBe('Personal');
  });

  test('the system default row selects the host login', async () => {
    let selected: string | null | undefined;
    act(() => render(
      h(HarnessAccountsPanel, panel({
        accounts: [account()],
        selectedId: 'acct-1',
        onSelect: async (id) => { selected = id; return { error: null }; },
      })),
      container,
    ));
    await act(async () => { button('Use').click(); });
    expect(selected).toBeNull();
  });

  test('Use on a signed-in account selects it and probes it once', async () => {
    let selected: string | null | undefined;
    let probes = 0;
    act(() => render(
      h(HarnessAccountsPanel, panel({
        accounts: [account({ signedIn: true, identity: { email: 'work@example.com' } })],
        selectedId: null,
        onSelect: async (id) => { selected = id; return { error: null }; },
        onProbe: async () => { probes += 1; return null; },
      })),
      container,
    ));
    await act(async () => { button('Use').click(); });
    expect(selected).toBe('acct-1');
    expect(probes).toBe(1);
  });
});
