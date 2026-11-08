/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which agents this build advertises, and their launch lines.
 *
 * Two decisions are pinned here because both are easy to undo by accident:
 *
 *  - **`gemini` is GONE, `antigravity` replaced it.** Google deprecated Gemini
 *    CLI in favour of Antigravity CLI, and the two are one product line's
 *    ancestor and successor — listing both would offer a dead agent beside its
 *    replacement and split the same Google account across two tabs.
 *  - **`command-code` launches `cmd acp`.** `cmd` is the bin npm installs (the
 *    package also ships `cmdc` for Windows and the long `command-code` /
 *    `commandcode` aliases), and the docs' own editor setup names
 *    `{"command":"cmd","args":["acp"]}`.
 *
 * Every harness must also resolve BRAND ART: a catalog entry whose glyph key has
 * no mark draws an empty box in the sidebar and the tab strip, which is the
 * failure `harness-glyph.test.ts` guards from the other side.
 */

import { describe, expect, test } from 'bun:test';
import { HARNESS_CATALOG, HARNESS_IDS, harnessDescriptor } from '@/shared/lib/harness/catalog';
import { HARNESS_LAUNCH } from '@/server/lib/harness/launch';

describe('harness catalog after the Gemini retirement', () => {
  test('gemini is not a harness this build offers', () => {
    expect(HARNESS_IDS as readonly string[]).not.toContain('gemini');
    expect(harnessDescriptor('gemini')).toBeUndefined();
    // Indexed, not dotted: `gemini` is not a `HarnessId` any more, which is the
    // point of this case — a dotted read would not even compile.
    expect((HARNESS_LAUNCH as Record<string, unknown>).gemini).toBeUndefined();
  });

  test('antigravity replaced it, over its own ACP server', () => {
    const descriptor = harnessDescriptor('antigravity');
    expect(descriptor?.transport).toBe('acp');
    expect(descriptor?.glyph).toBe('antigravity');
    // The vendor's documented line, verbatim.
    expect(HARNESS_LAUNCH.antigravity?.command).toEqual(['agy', 'acp']);
    // Replacing one with the other means the slot count did not grow a Google
    // agent: exactly one Google adapter is listed.
    const google = HARNESS_IDS.filter((id) => /gemini|antigravity/.test(id));
    expect(google).toEqual(['antigravity']);
  });

  test('command-code is listed and launches `cmd acp`', () => {
    const descriptor = harnessDescriptor('command-code');
    expect(descriptor?.transport).toBe('acp');
    expect(descriptor?.glyph).toBe('commandcode');
    expect(HARNESS_LAUNCH['command-code']?.command).toEqual(['cmd', 'acp']);
  });

  test('zcode is listed and launches the ACP bridge, not a `zcode acp` verb', () => {
    // The vendor CLI has no ACP subcommand: the ACP surface is the bridge that
    // spawns `zcode app-server --stdio`. A launch line written as
    // `['zcode', 'acp']` would look symmetrical and fail at spawn.
    const descriptor = harnessDescriptor('zcode');
    expect(descriptor?.transport).toBe('acp');
    expect(descriptor?.glyph).toBe('zcode');
    const command = HARNESS_LAUNCH.zcode?.command ?? [];
    expect(command[0]).toBe('npx');
    expect(command).toContain('zcode-acp-server@0.82.3');
    expect(command).not.toEqual(['zcode', 'acp']);
  });

  test('every catalog entry has a launch line or is the built-in transport', () => {
    // The built-in transport has no agent to launch by definition; everything
    // else without a line would probe to "no launch command is configured",
    // which is what a missing table row looks like at runtime.
    for (const id of HARNESS_IDS) {
      if (HARNESS_CATALOG[id].builtIn) {
        expect(HARNESS_LAUNCH[id]).toBeUndefined();
        continue;
      }
      expect(HARNESS_LAUNCH[id], `no launch line for ${id}`).toBeDefined();
    }
  });

  test('no launch line survives for a harness the catalog dropped', () => {
    for (const id of Object.keys(HARNESS_LAUNCH)) {
      expect(HARNESS_IDS as readonly string[]).toContain(id);
    }
  });
});
