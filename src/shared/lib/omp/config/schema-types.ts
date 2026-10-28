/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Static schema metadata for the native `omp` settings panel, extracted from
 * oh-my-pi's `packages/coding-agent/src/config/settings-schema.ts` (the
 * single source of truth for every setting: type, default, enum values, and
 * UI placement in tab/group). The JSON mirror lives in
 * `app/data/settings/omp-schema.json`; this module types it for the UI.
 */

export interface SchemaOption {
  value: string;
  label: string;
  description: string;
}

export interface SchemaUi {
  tab: string;
  group?: string;
  label: string;
  description: string;
  warning?: string;
  condition?: string;
  options?: SchemaOption[] | 'runtime';
  ordered?: boolean;
}

export interface SchemaEntry {
  type: 'boolean' | 'string' | 'number' | 'enum' | 'array' | 'record';
  default?: unknown;
  values?: string[];
  credential?: boolean;
  ui: SchemaUi;
}

export interface SchemaTab {
  id: string;
  label: string;
  groups: string[];
}

export interface OmpSchema {
  source: string;
  tabs: SchemaTab[];
  entries: Record<string, SchemaEntry>;
}
