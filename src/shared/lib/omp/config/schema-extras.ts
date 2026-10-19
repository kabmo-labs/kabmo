/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kabmo-side UI metadata for settings that oh-my-pi's docs catalog
 * documents but that upstream's settings schema gives no `ui` block —
 * upstream's own panel hides them. These rows restore the documented
 * surface: they render in the same tab/group layout, edit through the same
 * editors, and write through `omp config set`/`reset` like every other row.
 *
 * Deliberately still hidden (matching upstream intent):
 *  - `auth.broker.url` / `auth.broker.token` — "Hidden from the UI; populate
 *    via env vars" (upstream schema comment); env takes precedence anyway.
 *  - `searxng.token` / `searxng.basicPassword` — credential markers with no
 *    UI upstream; the SearXNG endpoint row remains editable.
 *  - `modelRoles` — has a dedicated role editor in this panel instead.
 */

import type { SchemaEntry } from '@/shared/lib/omp/config/schema-types';

export const SCHEMA_EXTRAS: Record<string, SchemaEntry> = {
  // ── Retry & Fallback ─────────────────────────────────────────────────────
  'retry.enabled': {
    type: 'boolean',
    default: true,
    ui: {
      tab: 'model',
      group: 'Retry & Fallback',
      label: 'Retry Enabled',
      description: 'Retry transient provider errors (rate limits, outages, quota walls).',
    },
  },
  'retry.baseDelayMs': {
    type: 'number',
    default: 500,
    ui: {
      tab: 'model',
      group: 'Retry & Fallback',
      label: 'Retry Base Delay (ms)',
      description: 'Initial backoff before the first retry.',
    },
  },

  // ── Thinking budgets ─────────────────────────────────────────────────────
  'thinkingBudgets.minimal': {
    type: 'number',
    default: 1024,
    ui: { tab: 'model', group: 'Thinking', label: 'Minimal Thinking Budget', description: 'Token budget for the minimal thinking level.' },
  },
  'thinkingBudgets.low': {
    type: 'number',
    default: 2048,
    ui: { tab: 'model', group: 'Thinking', label: 'Low Thinking Budget', description: 'Token budget for the low thinking level.' },
  },
  'thinkingBudgets.medium': {
    type: 'number',
    default: 8192,
    ui: { tab: 'model', group: 'Thinking', label: 'Medium Thinking Budget', description: 'Token budget for the medium thinking level.' },
  },
  'thinkingBudgets.high': {
    type: 'number',
    default: 16384,
    ui: { tab: 'model', group: 'Thinking', label: 'High Thinking Budget', description: 'Token budget for the high thinking level.' },
  },
  'thinkingBudgets.xhigh': {
    type: 'number',
    default: 32768,
    ui: { tab: 'model', group: 'Thinking', label: 'XHigh Thinking Budget', description: 'Token budget for the xhigh thinking level.' },
  },
  'thinkingBudgets.max': {
    type: 'number',
    default: 32768,
    ui: { tab: 'model', group: 'Thinking', label: 'Max Thinking Budget', description: 'Token budget for the max thinking level.' },
  },

  // ── Speech ───────────────────────────────────────────────────────────────
  /**
   * Upstream declares `stt.language` with no `ui` block, so its own panel hides
   * it while its OWN dictation reads it (`cfgSttLanguage`, default `"en"`). The
   * Kabmo drives the same worker and previously sent no language at all,
   * which left every decode auto-detecting — the one setting that decides
   * whether a non-English utterance transcribes correctly was unreachable from
   * either surface. The row restores it; the dictation route reads it as the
   * default when the client sends none (see `dictation/ws.ts`).
   */
  'stt.language': {
    type: 'string',
    default: 'en',
    ui: {
      tab: 'interaction',
      group: 'Speech',
      label: 'Speech-to-Text Language',
      description:
        'Source language for dictation (ISO-639-1, e.g. "id", "en"). Sent to the recognizer as a hint; leave it as "en" only if your dictation is English.',
    },
  },

  // ── Model roles / tags / cycles ──────────────────────────────────────────
  modelTags: {
    type: 'record',
    default: {},
    ui: {
      tab: 'model',
      group: 'Prompt',
      label: 'Model Tags',
      description: 'Custom role/tag metadata; can introduce additional roles. JSON record.',
    },
  },
  modelProviderOrder: {
    type: 'array',
    default: [],
    ui: {
      tab: 'model',
      group: 'Prompt',
      label: 'Model Provider Order',
      description: 'Preferred provider order when a model id is ambiguous. JSON array.',
    },
  },
  cycleOrder: {
    type: 'array',
    default: ['smol', 'default', 'slow'],
    ui: {
      tab: 'model',
      group: 'Prompt',
      label: 'Model Cycle Order',
      description: 'Roles cycled by the model switcher. JSON array.',
    },
  },
  enabledModels: {
    type: 'array',
    default: [],
    ui: {
      tab: 'model',
      group: 'Prompt',
      label: 'Enabled Models',
      description: 'Allow-list of models; supports path-scoped entries. Empty means all available models. JSON array.',
    },
  },

  // ── Sampling (per-agent tier overrides) ──────────────────────────────────
  'task.agentServiceTierOverrides': {
    type: 'record',
    default: {},
    ui: {
      tab: 'model',
      group: 'Sampling',
      label: 'Agent Service Tier Overrides',
      description: 'Sparse exact-name service-tier overrides for agents spawned by task/eval dispatch. JSON record.',
    },
  },

  // ── Compaction ───────────────────────────────────────────────────────────
  'compaction.reserveTokens': {
    type: 'number',
    ui: {
      tab: 'context',
      group: 'Compaction',
      label: 'Compaction Reserve Tokens',
      description: 'Absolute reserve floor. Unset = larger of 16384 and 15% of the context window.',
    },
  },
  'compaction.keepRecentTokens': {
    type: 'number',
    default: 20000,
    ui: {
      tab: 'context',
      group: 'Compaction',
      label: 'Keep Recent Tokens',
      description: 'Recent tokens always preserved through compaction.',
    },
  },
  'compaction.autoContinue': {
    type: 'boolean',
    default: true,
    ui: {
      tab: 'context',
      group: 'Compaction',
      label: 'Auto-Continue',
      description: 'Continue automatically after compaction.',
    },
  },

  // ── Memory / auto-learn ──────────────────────────────────────────────────
  'autolearn.minToolCalls': {
    type: 'number',
    default: 5,
    ui: {
      tab: 'memory',
      group: 'Auto-Learn',
      label: 'Min Tool Calls',
      description: 'Only nudge after a turn that used at least this many tools.',
      condition: 'autolearnActive',
    },
  },

  // ── Shell ────────────────────────────────────────────────────────────────
  shellPath: {
    type: 'string',
    ui: {
      tab: 'shell',
      group: 'Bash',
      label: 'Shell Path',
      description: 'Override the shell binary used by bash.',
    },
  },
  'bash.autoBackground.thresholdMs': {
    type: 'number',
    default: 60000,
    ui: {
      tab: 'shell',
      group: 'Bash',
      label: 'Auto-Background Threshold (ms)',
      description: 'Threshold before auto-backgrounding long-running commands.',
    },
  },

  // ── Tasks / subagents ────────────────────────────────────────────────────
  'task.agentAdvisor': {
    type: 'record',
    default: {},
    ui: {
      tab: 'tasks',
      group: 'Subagents',
      label: 'Agent Advisor Overrides',
      description: 'Per-agent subagent advisor: agent name → "on" / "off" / advisor model pattern. JSON record.',
    },
  },

  // ── Providers ────────────────────────────────────────────────────────────
  enabledProviders: {
    type: 'array',
    default: [],
    ui: {
      tab: 'providers',
      group: 'Services',
      label: 'Enabled Providers',
      description: 'Foreign user-level discovery sources to load; supports path-scoped entries. JSON array.',
    },
  },
  disabledProviders: {
    type: 'array',
    default: [],
    ui: {
      tab: 'providers',
      group: 'Services',
      label: 'Disabled Providers',
      description: 'Disabled model/discovery providers; supports path-scoped entries. JSON array.',
    },
  },
};
