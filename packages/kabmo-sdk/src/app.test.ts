/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app contract a plugin's bundle must satisfy.
 *
 * Everything a plugin registers reaches the host through `definePluginApp`, so
 * the two ways a plugin gets it wrong are the two that must be caught by name
 * rather than by silence:
 *
 * - exporting the setup function directly, so there is no definition to find —
 *   the bundle loads and registers nothing;
 * - exporting an object that merely LOOKS like a definition.
 *
 * The host refuses both through `isPluginAppDefinition`, which is why the shape
 * has a marker field at all.
 */

import { describe, expect, test } from 'bun:test';
import { definePluginApp, isPluginAppDefinition } from '@kabmo-labs/kabmo-sdk/app';

describe('definePluginApp', () => {
  test('wraps a setup function in a frozen definition', () => {
    const setup = () => {};
    const app = definePluginApp(setup);

    expect(app.__kabmoPluginApp).toBe(true);
    expect(app.setup).toBe(setup);
    expect(Object.isFrozen(app)).toBe(true);
  });

  test('refuses a setup that is not a function', () => {
    // The mistake this catches: passing the app object, or nothing at all.
    expect(() => definePluginApp(undefined as never)).toThrow('expects a setup function');
    expect(() => definePluginApp({} as never)).toThrow('expects a setup function');
  });
});

describe('isPluginAppDefinition', () => {
  test('accepts what definePluginApp produces', () => {
    expect(isPluginAppDefinition(definePluginApp(() => {}))).toBe(true);
  });

  test('rejects a bare setup function', () => {
    // `export default (app) => { ... }` — the plugin loads and does nothing,
    // which is why the host reports it instead of treating it as empty.
    expect(isPluginAppDefinition(() => {})).toBe(false);
  });

  test('rejects the marker without a setup, and a setup without the marker', () => {
    expect(isPluginAppDefinition({ __kabmoPluginApp: true })).toBe(false);
    expect(isPluginAppDefinition({ setup: () => {} })).toBe(false);
    expect(isPluginAppDefinition({ __kabmoPluginApp: 'true', setup: () => {} })).toBe(false);
  });

  test('rejects a non-object without throwing', () => {
    expect(isPluginAppDefinition(null)).toBe(false);
    expect(isPluginAppDefinition(undefined)).toBe(false);
    expect(isPluginAppDefinition('nope')).toBe(false);
    expect(isPluginAppDefinition(7)).toBe(false);
  });
});
