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
import type { SchemaEntry } from '@/shared/lib/omp/config/schema-types';

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
});
