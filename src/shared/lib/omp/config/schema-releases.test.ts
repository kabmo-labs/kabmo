/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rows each omp release added to the settings schema.
 *
 * Split from `schema.test.ts` (which owns the merge, the condition table and
 * the approval-mode vocabulary) because this list only grows: every bump pins
 * the rows it brought, so a regenerated schema that drops one fails here
 * instead of silently removing the panel's only editor for that setting.
 */

import { describe, expect, test } from 'bun:test';

import { OMP_SCHEMA } from '@/shared/lib/omp/config/schema';
import type { SchemaEntry } from '@kabmo-labs/kabmo-omp/schema/schema-types';

describe('OMP_SCHEMA release rows', () => {
  test('the settings that upstream added after the panel was written are present', () => {
    // Pins the reason the schema is generated at all: these were unreachable
    // while the JSON sat frozen at the migration commit.
    for (const key of ['title.icons', 'title.generator', 'tui.renderSvg', 'tui.autoGraph', 'task.completionProbe', 'providers.cacheWarming']) {
      expect(OMP_SCHEMA.entries[key]).toBeDefined();
    }
    // Replaced by the on/off form in omp 18.5.0 — offering it writes a key the
    // binary rejects.
    expect(OMP_SCHEMA.entries['task.completionProbeMs']).toBeUndefined();
  });

  test('the folders that always ask are offered (omp 18.13.1)', () => {
    // `tools.restrictedFolders` is where every read, write, edit, search or
    // command asks in EVERY approval mode. The panel is the only place a user
    // can set it, so a schema regenerated without the row makes the feature
    // unreachable from the console.
    const entry = OMP_SCHEMA.entries['tools.restrictedFolders'];
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('array');
    expect(entry?.ui.tab).toBe('interaction');
    expect(entry?.ui.group).toBe('Approvals');
  });

  test('the rows omp 18.15.0 adds are offered', () => {
    // Measured against `omp config list --json` on 18.15.0: all four exist and
    // every one accepts a write through `omp config set`. A schema regenerated
    // without them is a release of settings the panel cannot reach.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string }> = {
      'providers.openai-codex.daybreak': { type: 'boolean', tab: 'providers', group: 'Protocol' },
      'task.perCallModel': { type: 'enum', tab: 'tasks', group: 'Subagents' },
      'task.perCallModelAllow': { type: 'array', tab: 'tasks', group: 'Subagents' },
      'title.refreshAfterPrompts': { type: 'number', tab: 'tasks', group: 'Modes' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group } }).toEqual({
        key,
        entry: want,
      });
    }
  });

  test('the rows omp 18.16.0 adds are offered', () => {
    // Measured against `omp config list --json` on 18.16.0: all three exist and
    // `omp config get` answers each. Two are TUI-composer features Kabmo has no
    // surface for, but the panel is the only place a user CAN reach an omp
    // setting, so a regenerated schema that drops them removes the row entirely.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string }> = {
      'btw.inject': { type: 'boolean', tab: 'interaction', group: 'Input' },
      'composer.predictionAlternatives': { type: 'boolean', tab: 'interaction', group: 'Input' },
      'hindsight.globalScope': { type: 'boolean', tab: 'memory', group: 'Hindsight' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group } }).toEqual({
        key,
        entry: want,
      });
    }
  });

  test('the rows omp 18.17.0 adds are offered', () => {
    // Measured against `omp config list --json` on 18.17.0: all twelve exist and
    // every one is accepted by `omp config set`. Most are TUI-only surfaces
    // Kabmo does not draw, but the panel is the only place a user CAN reach an
    // omp setting, so a regenerated schema that drops them removes the row.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string }> = {
      'display.shellVisualization': { type: 'boolean', tab: 'appearance', group: 'Display' },
      'tui.colorfulMarkdown': { type: 'boolean', tab: 'appearance', group: 'Display' },
      'tui.motion': { type: 'enum', tab: 'appearance', group: 'Display' },
      'tui.maxFps': { type: 'number', tab: 'appearance', group: 'Display' },
      'tui.spinnerInterval': { type: 'number', tab: 'appearance', group: 'Display' },
      'extensionRenderers.transcriptPresenters': { type: 'boolean', tab: 'tools', group: 'Extensions' },
      'spotlight.experiment.enabled': { type: 'boolean', tab: 'tools', group: 'Developer' },
      'magicKeywords.chillax': { type: 'boolean', tab: 'interaction', group: 'Magic Keywords' },
      'update.auto': { type: 'boolean', tab: 'interaction', group: 'Startup & Updates' },
      'ovnfs.path': { type: 'string', tab: 'tasks', group: 'Isolation' },
      'task.workerThreads': { type: 'number', tab: 'tasks', group: 'Subagents' },
      'providers.openaiResponsesWebsockets': { type: 'boolean', tab: 'providers', group: 'Protocol' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group } }).toEqual({
        key,
        entry: want,
      });
    }
  });

  test('a default that moved upstream moves here too', () => {
    // 18.17.0 changed `textVerbosity`'s default from `medium` to `low` — the
    // panel shows the schema's default, so a stale row would offer the old one.
    expect(OMP_SCHEMA.entries.textVerbosity?.default).toBe('low');
    // …and `edit.mode` gained `none`, which removes the `edit` tool.
    expect(OMP_SCHEMA.entries['edit.mode']?.values).toContain('none');
  });

  test("18.20.3's three Mnemopi rows are present and gated on the backend", () => {
    // The generator only emits a row for a setting that carries a `ui` block,
    // so a row dropped here means the panel lost its only editor. All three
    // are upstream-gated on `mnemopiActive`; a missing condition would show a
    // Mnemopi-only row to every user.
    const rows = {
      'mnemopi.recallRelevance': { type: 'enum', default: 'off' },
      'mnemopi.embeddingQueryPrefix': { type: 'string', default: undefined },
      'mnemopi.embeddingInputType': { type: 'boolean', default: false },
    } as const;
    for (const [key, want] of Object.entries(rows)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, condition: entry.ui.condition, default: entry.default } }).toEqual({
        key,
        entry: { ...want, tab: 'memory', group: 'Mnemopi', condition: 'mnemopiActive' },
      });
    }
    expect(OMP_SCHEMA.entries['mnemopi.recallRelevance']?.values).toEqual(['auto', 'on', 'off']);
  });

  test("18.21.0's embed row is offered and the TTS ladder moved with Phonon", () => {
    // The generator only emits a row for a setting that carries a `ui` block.
    // `tui.renderEmbeds` is TUI-only (the prompt invitation is gated on
    // `tuiTranscript`), but the panel is the only place a user CAN reach an omp
    // setting, so a regenerated schema that drops it removes the row entirely.
    const entry = OMP_SCHEMA.entries['tui.renderEmbeds'];
    expect(entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default }).toEqual({
      type: 'boolean',
      tab: 'appearance',
      group: 'Display',
      default: true,
    });
    // Local TTS moved from Kokoro-82M to Phonon 31M: the voice ids and the
    // speed ladder are the schema's, so a stale row would offer a value omp
    // migrates away from on read.
    expect(OMP_SCHEMA.entries['tts.localVoice']?.default).toBe('harper');
    expect(OMP_SCHEMA.entries['tts.localVoice']?.values).toContain('edwin');
    expect(OMP_SCHEMA.entries['tts.localVoice']?.values).not.toContain('af_heart');
    const speedOptions = OMP_SCHEMA.entries['tts.localSpeed']?.ui.options;
    expect(Array.isArray(speedOptions) ? speedOptions.map((option) => option.value) : speedOptions).toEqual([
      '0.8', '0.9', '1', '1.1', '1.2', '1.3',
    ]);
    // `task.agentPrewalkAuto` carries no `ui`, so neither omp's panel nor this
    // schema offers it — the same rule as every no-UI setting.
    expect(OMP_SCHEMA.entries['task.agentPrewalkAuto']).toBeUndefined();
  });

  test("18.22.0's disassembler rows replace the ida tool toggle", () => {
    // omp 18.22.0 drops the `ida` TOOL: binary analysis moved behind `read`
    // selectors and eval's `dsm` namespace. The rows that select the backend
    // are therefore the only way to reach it from the console, and the tool's
    // own `ida.enabled` switch must be gone (naming it writes a key omp no
    // longer has).
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string; default: unknown }> = {
      'disassembler.backend': { type: 'enum', tab: 'tools', group: 'Available Tools', default: 'auto' },
      'disassembler.maxOpen': { type: 'number', tab: 'tools', group: 'Disassembler', default: 4 },
      'disassembler.idleCloseSec': { type: 'number', tab: 'tools', group: 'Disassembler', default: 900 },
      'ghidra.installDir': { type: 'string', tab: 'tools', group: 'Ghidra', default: '' },
      'ghidra.python': { type: 'string', tab: 'tools', group: 'Ghidra', default: '' },
      'ida.python': { type: 'string', tab: 'tools', group: 'IDA Pro', default: '' },
      'ida.installDir': { type: 'string', tab: 'tools', group: 'IDA Pro', default: '' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default } }).toEqual({
        key,
        entry: want,
      });
    }
    // 19.1.0 adds `binja` between `ida` and `none`; Binary Ninja is never
    // chosen by `auto`, so the option carries that in its own description.
    expect(OMP_SCHEMA.entries['disassembler.backend']?.values).toEqual(['auto', 'ghidra', 'ida', 'binja', 'none']);
    expect(OMP_SCHEMA.entries['ida.enabled']).toBeUndefined();
    // `worktree.onExit` gained `force`, which removes every worktree without
    // asking; a stale ladder would hide the only uncoverable value.
    expect(OMP_SCHEMA.entries['worktree.onExit']?.values).toEqual(['keep', 'ask', 'remove', 'force']);
  });

  test("18.22.2's live-endpoint and keyless rows are offered, and credentials are masked", () => {
    // 18.22.1 lets live voice reach any OpenAI Realtime server, so the endpoint
    // and its key are the only way to configure one from the console; the
    // keyless switch is the only way to turn the scraped engines off.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string; default: unknown }> = {
      'live.endpoint': { type: 'string', tab: 'providers', group: 'Services', default: undefined },
      'live.apiKey': { type: 'string', tab: 'providers', group: 'Services', default: undefined },
      'providers.webKeyless': { type: 'boolean', tab: 'providers', group: 'Services', default: true },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default } }).toEqual({
        key,
        entry: want,
      });
    }
    // `live.voice` became a free-form string that still ships the nine known
    // voices as options: omp's own panel renders string+options as a submenu,
    // and so does `RowEditor`, so the row must keep its options.
    expect(OMP_SCHEMA.entries['live.voice']?.type).toBe('string');
    expect(OMP_SCHEMA.entries['live.voice']?.ui.options).toHaveLength(9);
    // The generator reads the raw definition, where the marker is `credential`
    // (not the `Setting` instance's `isCredential` getter). Reading the getter
    // left every credential row in plain text — including this release's key.
    for (const key of ['live.apiKey', 'mnemopi.embeddingApiKey', 'mnemopi.llmApiKey', 'hindsight.apiToken']) {
      expect({ key, credential: OMP_SCHEMA.entries[key]?.credential }).toEqual({ key, credential: true });
    }
  });

  test("19.1.0's renamed and added rows are offered under their new ids", () => {
    // The `xd://` DEVICES became tool commands, and the four switches that
    // shaped them were renamed with them. A panel still writing `tools.xdev`
    // would edit a key omp deletes on read (its own migration strips it), so
    // the new ids are the only reachable ones.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string; default: unknown }> = {
      'tools.commands': { type: 'boolean', tab: 'tools', group: 'Discovery & MCP', default: true },
      'tools.commandDocs': { type: 'enum', tab: 'tools', group: 'Discovery & MCP', default: 'catalog' },
      'mcp.shared': { type: 'boolean', tab: 'tools', group: 'Discovery & MCP', default: true },
      'mcp.idleStopMinutes': { type: 'number', tab: 'tools', group: 'Discovery & MCP', default: 5 },
      'pty.notify': { type: 'enum', tab: 'interaction', group: 'Notifications', default: 'on' },
      'edit.magic.model': { type: 'string', tab: 'files', group: 'Editing', default: undefined },
      'binja.installDir': { type: 'string', tab: 'tools', group: 'Binary Ninja', default: '' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default } }).toEqual({
        key,
        entry: want,
      });
    }
    // The old ids are gone from omp's registry: a row for one is an editor
    // whose write is refused.
    for (const key of ['tools.xdev', 'tools.xdevDocs', 'tools.xdevInlineDevices', 'tools.xdevNotices', 'tui.completeScrollback']) {
      expect(`${key}: ${String(OMP_SCHEMA.entries[key])}`).toBe(`${key}: undefined`);
    }
    // The new edit mode is a value of `edit.mode`, and a stale ladder would
    // hide it from the panel's own dropdown.
    expect(OMP_SCHEMA.entries['edit.mode']?.values).toContain('magic');
  });

  test("19.1.1's takeover row replaces the background fallback, and the todo backend is offered", () => {
    // `computer.backgroundFallback` became `computer.takeover` with two new
    // opt-in modes; omp migrates a stored `refuse` and drops the old key, so a
    // panel that still wrote it would edit nothing. `todo.backend` names the
    // extension that mirrors the todo list, a runtime list Kabmo cannot
    // enumerate — the same shape as `theme.dark` and `composer.shape`.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string; default: unknown }> = {
      'computer.takeover': { type: 'enum', tab: 'tools', group: 'Computer', default: 'fallback' },
      'todo.backend': { type: 'string', tab: 'tools', group: 'Todos', default: 'native' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default } }).toEqual({
        key,
        entry: want,
      });
    }
    expect(OMP_SCHEMA.entries['computer.takeover']?.values).toEqual(['fallback', 'foreground', 'always', 'refuse']);
    expect(OMP_SCHEMA.entries['todo.backend']?.ui.options).toBe('runtime');
    expect(OMP_SCHEMA.entries['computer.backgroundFallback']).toBeUndefined();
  });

  test("19.2.0's vim rows are offered and the two moved defaults follow upstream", () => {
    // The rebuilt terminal UI adds three Vim controls, all gated on the
    // `vimModeEnabled` condition the panel already resolves. They are TUI-only
    // surfaces, but the panel is the only place an omp setting is reachable, so
    // a regenerated schema that drops them removes the row entirely.
    const expected: Record<string, { type: SchemaEntry['type']; tab: string; group: string; default: unknown }> = {
      'tui.vimShowCommand': { type: 'boolean', tab: 'interaction', group: 'Input', default: true },
      'tui.vimYankToClipboard': { type: 'boolean', tab: 'interaction', group: 'Input', default: false },
      'tui.vimStartMode': { type: 'enum', tab: 'interaction', group: 'Input', default: 'insert' },
    };
    for (const [key, want] of Object.entries(expected)) {
      const entry = OMP_SCHEMA.entries[key];
      expect({ key, entry: entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default } }).toEqual({
        key,
        entry: want,
      });
    }
    expect(OMP_SCHEMA.entries['tui.vimStartMode']?.values).toEqual(['insert', 'normal']);

    // Two defaults flipped: eval-defined tools are off unless enabled, and
    // cross-instance agent messaging is on unless disabled. The panel shows the
    // schema's default, so a stale row would offer the opposite of omp's.
    expect(OMP_SCHEMA.entries['eval.tools.enabled']?.default).toBe(false);
    expect(OMP_SCHEMA.entries['task.crossInstance']?.default).toBe(true);

    // Auto-prewalk gained an escalation mode; a stale enum hides it from the
    // panel's own dropdown.
    expect(OMP_SCHEMA.entries['prewalk.auto']?.values).toContain('escalate');
  });

  test("19.2.1's background-reaping row is offered", () => {
    // One net row. The reminder and session-end reaping are off under RPC (the
    // description says so), so nothing in Kabmo reads it — but the panel is the
    // only place an omp setting is reachable, and a schema regenerated without
    // the row removes it entirely.
    const entry = OMP_SCHEMA.entries['bash.reapBackground'];
    expect(entry && { type: entry.type, tab: entry.ui.tab, group: entry.ui.group, default: entry.default }).toEqual({
      type: 'boolean',
      tab: 'shell',
      group: 'Bash',
      default: true,
    });
    expect(entry?.ui.description).toContain('off in RPC mode');
  });
});
