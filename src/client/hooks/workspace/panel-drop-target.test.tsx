/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A column body that accepts a panel from either rail.
 *
 * The two failures it prevents are invisible until the user tries the gesture:
 * a body that refuses the drop (a placement that only the 44px rail accepts),
 * and a body that claims a FILE drop (the view's own upload/insert stops
 * working). Only the panel payload is accepted.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { usePanelDropTarget } from '@/client/hooks/workspace/panel-drop-target';
import { PANEL_DRAG_MIME } from '@/shared/lib/workspace/panel-drag';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement | null = null;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container = null;
});

afterAll(() => {
  restoreDomGlobals();
});

function Probe({ onPlace, highlight }: { onPlace: (id: string) => void; highlight?: boolean }) {
  const { active, dropProps } = usePanelDropTarget({ onPlace, highlight });
  return h('div', { id: 'drop', 'data-active': String(active), ...dropProps });
}

function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container!));
  return container;
}

function transfer(data: Record<string, string>) {
  return {
    data,
    dropEffect: 'none',
    get types() {
      return Object.keys(data);
    },
    setData(type: string, value: string) {
      data[type] = value;
    },
    getData(type: string) {
      return data[type] ?? '';
    },
  };
}

function fire(element: HTMLElement, type: string, payload: ReturnType<typeof transfer>) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: payload });
  element.dispatchEvent(event);
  return event;
}

describe('usePanelDropTarget', () => {
  test('a panel drag is claimed, and the drop places it', () => {
    const placed: string[] = [];
    const el = mount(h(Probe, { onPlace: (id) => placed.push(id) }));
    const target = el.querySelector('#drop') as HTMLElement;
    const payload = transfer({ [PANEL_DRAG_MIME]: 'git' });

    const seen: { event?: Event } = {};
    act(() => {
      seen.event = fire(target, 'dragover', payload);
    });
    expect(seen.event?.defaultPrevented).toBe(true);
    expect(target.getAttribute('data-active')).toBe('true');

    act(() => {
      fire(target, 'drop', payload);
    });
    expect(placed).toEqual(['git']);
    expect(target.getAttribute('data-active')).toBe('false');
  });

  test('a file drag is neither claimed nor highlighted', () => {
    const el = mount(h(Probe, { onPlace: () => {} }));
    const target = el.querySelector('#drop') as HTMLElement;
    const payload = transfer({ Files: 'a.png' });
    const seen: { event?: Event } = {};
    act(() => {
      seen.event = fire(target, 'dragover', payload);
    });
    expect(seen.event?.defaultPrevented).toBe(false);
    expect(target.getAttribute('data-active')).toBe('false');
  });

  test('a body beside a rail accepts the drop without drawing its own state', () => {
    const placed: string[] = [];
    const el = mount(h(Probe, { onPlace: (id) => placed.push(id), highlight: false }));
    const target = el.querySelector('#drop') as HTMLElement;
    const payload = transfer({ [PANEL_DRAG_MIME]: 'files' });

    act(() => {
      fire(target, 'dragover', payload);
      fire(target, 'drop', payload);
    });
    expect(placed).toEqual(['files']);
    expect(target.getAttribute('data-active')).toBe('false');
  });
});
