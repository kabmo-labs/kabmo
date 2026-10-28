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
  /** Extra request headers the entry pins for every call. */
  headers?: Record<string, string>;
  /** `authHeader: true` — send the credential as a raw auth header. */
  authHeader?: boolean;
  /** `transport: pi-native` routes every model through the auth gateway. */
  transport?: 'pi-native';
  /** The entry carries an `apiKey` (the value is never read here). */
  hasApiKey?: boolean;
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
  /** `kind` from the entry, when it declares a non-chat one. */
  kind?: string;
  /** `supportsTools` from the entry; absent means omp's default (true). */
  supportsTools?: boolean;
  /** `thinking` block, when the entry declares a reasoning ladder. */
  thinkingMode?: string;
  thinkingEfforts?: string[];
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
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
        if (typeof value.apiKey === 'string' && value.apiKey.length > 0) info.hasApiKey = true;
        if (value.authHeader === true) info.authHeader = true;
        if (value.transport === 'pi-native') info.transport = 'pi-native';
        if (isRecord(value.headers)) {
          const headers = Object.entries(value.headers).flatMap(([key, header]) => (
            typeof header === 'string' ? [[key, header] as [string, string]] : []
          ));
          if (headers.length > 0) info.headers = Object.fromEntries(headers);
        }
        if (isRecord(value.discovery) && typeof value.discovery.type === 'string') {
          info.discovery = value.discovery.type;
        }
        if (Array.isArray(value.models)) {
          info.models = value.models.flatMap((model) => {
            if (!isRecord(model) || typeof model.id !== 'string') return [];
            const thinking = isRecord(model.thinking) ? model.thinking : undefined;
            const efforts = Array.isArray(thinking?.efforts)
              ? thinking.efforts.filter((effort): effort is string => typeof effort === 'string')
              : undefined;
            const cost = isRecord(model.cost) ? model.cost : undefined;
            return [{
              id: model.id,
              ...(typeof model.name === 'string' ? { name: model.name } : {}),
              ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
              ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
              ...(model.reasoning === true ? { reasoning: true } : {}),
              ...(Array.isArray(model.input) && model.input.includes('image') ? { imageInput: true } : {}),
              ...(typeof model.kind === 'string' ? { kind: model.kind } : {}),
              ...(typeof model.supportsTools === 'boolean' ? { supportsTools: model.supportsTools } : {}),
              ...(thinking && typeof thinking.mode === 'string' ? { thinkingMode: thinking.mode } : {}),
              ...(efforts && efforts.length > 0 ? { thinkingEfforts: efforts } : {}),
              ...(cost ? {
                cost: {
                  ...(typeof cost.input === 'number' ? { input: cost.input } : {}),
                  ...(typeof cost.output === 'number' ? { output: cost.output } : {}),
                  ...(typeof cost.cacheRead === 'number' ? { cacheRead: cost.cacheRead } : {}),
                  ...(typeof cost.cacheWrite === 'number' ? { cacheWrite: cost.cacheWrite } : {}),
                },
              } : {}),
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
