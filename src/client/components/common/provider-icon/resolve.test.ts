/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `providerIcon` slot's resolution order.
 *
 * These lock the two things a caller cannot see and a broken implementation
 * would break silently: a plugin's registration must win for the provider it
 * names and leave every other provider on its built-in mark, and a glyph that
 * is not a usable SVG must fall through rather than leave an empty tile.
 *
 * `ProviderIcon` is the only caller, so the order is asserted here against the
 * resolver it delegates to, without a DOM.
 */

import { describe, expect, test } from 'bun:test';
import { parseRegisteredGlyph, resolveProviderMark } from '@/client/components/common/provider-icon/resolve';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import type { ListSlotEntry } from '@/client/lib/plugins/list-slots';
import type { ProviderIconRegistration } from '@kabmo-labs/kabmo-sdk';

const CUSTOM = '<svg viewBox="0 0 32 32"><path d="M4 4h24v24H4z"/></svg>';
const OTHER = "<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'/></svg>";
const MALFORMED = 'not an svg at all';

function row(pluginId: string, provider: string, glyph: string, order?: number): ListSlotEntry<ProviderIconRegistration> {
  return { pluginId, slot: 'providerIcon', registration: { id: provider, provider, glyph, order } };
}

describe('parseRegisteredGlyph', () => {
  test('takes the root viewBox and the inner markup', () => {
    expect(parseRegisteredGlyph(CUSTOM)).toEqual({
      viewBox: '0 0 32 32',
      body: '<path d="M4 4h24v24H4z"/>',
    });
  });

  test('accepts a single-quoted viewBox and content before the root', () => {
    expect(parseRegisteredGlyph(`<?xml version="1.0"?>${OTHER}`)).toEqual({
      viewBox: '0 0 10 10',
      body: "<circle cx='5' cy='5' r='4'/>",
    });
  });

  test('refuses anything that is not one svg element with a viewBox and a body', () => {
    expect(parseRegisteredGlyph(MALFORMED)).toBeNull();
    expect(parseRegisteredGlyph('<svg viewBox="0 0 24 24">')).toBeNull();
    expect(parseRegisteredGlyph('<svg viewBox="0 0 24 24"></svg>')).toBeNull();
    expect(parseRegisteredGlyph('<svg><path d="M0 0h1v1z"/></svg>')).toBeNull();
    expect(parseRegisteredGlyph('<svg viewBox="0 0 24 24"/>')).toBeNull();
    expect(parseRegisteredGlyph('')).toBeNull();
  });
});

describe('resolveProviderMark', () => {
  test('a registered glyph wins over the built-in mark for that provider', () => {
    const mark = resolveProviderMark(['deepseek'], [row('demo', 'deepseek', CUSTOM)]);

    expect(mark).toEqual({ viewBox: '0 0 32 32', body: '<path d="M4 4h24v24H4z"/>' });
  });

  test('a registration leaves every other provider on its built-in mark', () => {
    const rows = [row('demo', 'deepseek', CUSTOM)];

    expect(resolveProviderMark(['openai'], rows)).toBe(PROVIDER_GLYPHS.openai);
    expect(resolveProviderMark(['deepseek'], rows)).not.toBe(PROVIDER_GLYPHS.deepseek);
  });

  test('an unregistered provider is unchanged, unknown ones still fall to initials', () => {
    expect(resolveProviderMark(['deepseek'], [])).toBe(PROVIDER_GLYPHS.deepseek);
    expect(resolveProviderMark(['my-private-gateway'], [])).toBeNull();
  });

  test('the registration is found by every spelling the built-in table folds together', () => {
    const rows = [row('demo', 'google-vertex', CUSTOM)];

    for (const spelling of ['google-vertex', 'Google Vertex', 'GOOGLE_VERTEX', 'googlevertex ']) {
      expect(resolveProviderMark([spelling], rows)?.viewBox, spelling).toBe('0 0 32 32');
    }
  });

  test('candidates keep the built-in precedence: the icon key before the slug', () => {
    const rows = [row('a', 'claude', CUSTOM), row('b', 'deepseek', OTHER)];

    expect(resolveProviderMark(['claude', 'deepseek'], rows)?.viewBox).toBe('0 0 32 32');
  });

  test('two plugins on one provider: the first merged row wins, deterministically', () => {
    const rows = [row('alpha', 'acme', CUSTOM), row('beta', 'acme', OTHER)];

    expect(resolveProviderMark(['acme'], rows)?.viewBox).toBe('0 0 32 32');
  });

  test('a malformed glyph falls through instead of rendering a broken mark', () => {
    // On a provider the built-in table knows, the built-in mark comes back.
    expect(resolveProviderMark(['deepseek'], [row('demo', 'deepseek', MALFORMED)])).toBe(
      PROVIDER_GLYPHS.deepseek,
    );
    // With no built-in either, there is nothing to draw and the badge runs.
    expect(resolveProviderMark(['acme'], [row('demo', 'acme', MALFORMED)])).toBeNull();
  });

  test('the first registration is authoritative, so its broken glyph falls to the built-in', () => {
    // The second plugin's glyph is valid, but `alpha` won the provider: the
    // mark shown must not depend on which plugin shipped a broken string.
    const rows = [row('alpha', 'acme', MALFORMED), row('beta', 'acme', CUSTOM)];

    expect(resolveProviderMark(['acme'], rows)).toBeNull();
  });
});
