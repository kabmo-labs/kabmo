/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read side of the native OMP models config: the canonical path and the
 * providers/models registered in it. Read-only — every write lives in
 * `./providers.ts`, which owns the document-model merge.
 */

import { join } from 'path';
import { getAgentDir } from '@/server/lib/omp/core/paths';
import { isRecord } from '@/shared/lib/util/guards';

const MODELS_FILENAMES = ['models.yml', 'models.yaml'] as const;

/**
 * Path of the native OMP models config. Prefers the canonical `models.yml`,
 * which is what omp's own `ConfigFile` treats as the primary target and what
 * the JSON→YAML migration writes; `models.yaml` is only the legacy fallback for
 * a file that already exists under that name. A fresh install therefore gets
 * `models.yml`, never the non-canonical spelling.
 */
export async function getModelsConfigPath(): Promise<string> {
  const dir = getAgentDir();
  for (const name of MODELS_FILENAMES) {
    const candidate = join(dir, name);
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return join(dir, MODELS_FILENAMES[0]);
}

export interface NativeProviderInfo {
  /** Provider slug, e.g. "deepseek" or "custom/my-gateway". */
  slug: string;
  /** Base URL of the provider API, when configured. */
  baseUrl?: string;
  /** Wire dialect from the entry's `api`, when it declares one. */
  api?: string;
  /** Auth mode from the entry's `auth`; `none` means keyless. */
  auth?: string;
  /** Discovery type from the entry's `discovery`, when omp lists its models. */
  discovery?: string;
  /** Model ids registered under this provider in models.yml. */
  modelIds: string[];
  models: NativeModelInfo[];
}

export interface NativeModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  imageInput?: boolean;
}

/**
 * Read custom providers/models registered in models.yml. Returns [] when the
 * file is missing or has no providers — never throws for absent files.
 *
 * The `models` collection is array-only here, matching omp's schema. The
 * previous tolerant map-form reader made Kabmo report providers as
 * healthy while omp had disabled the entire file for the same content, and the
 * next upsert then rewrote the map as an array, discarding every model in it.
 */
export async function readNativeProviders(): Promise<NativeProviderInfo[]> {
  const path = await getModelsConfigPath();
  if (!(await Bun.file(path).exists())) return [];
  try {
    const data = Bun.YAML.parse(await Bun.file(path).text());
    if (!isRecord(data) || !isRecord(data.providers)) return [];
    return Object.entries(data.providers).map(([slug, value]) => {
      const info: NativeProviderInfo = { slug, modelIds: [], models: [] };
      if (isRecord(value)) {
        if (typeof value.baseUrl === 'string') info.baseUrl = value.baseUrl;
        if (typeof value.api === 'string') info.api = value.api;
        if (typeof value.auth === 'string') info.auth = value.auth;
        if (isRecord(value.discovery) && typeof value.discovery.type === 'string') {
          info.discovery = value.discovery.type;
        }
        if (Array.isArray(value.models)) {
          info.models = value.models.flatMap((model) => {
            if (!isRecord(model) || typeof model.id !== 'string') return [];
            return [{
              id: model.id,
              ...(typeof model.name === 'string' ? { name: model.name } : {}),
              ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
              ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
              ...(model.reasoning === true ? { reasoning: true } : {}),
              ...(Array.isArray(model.input) && model.input.includes('image') ? { imageInput: true } : {}),
            }];
          });
        }
        info.modelIds = info.models.map((model) => model.id);
      }
      return info;
    });
  } catch {
    return [];
  }
}
