/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Every store the Token Usage index reads, in one list.
 *
 * A harness with no readable store simply contributes nothing: the filter names
 * only harnesses that DID contribute, so the panel never offers a row that is
 * always empty.
 */

import { join } from 'node:path';

import { ompSource } from '@/server/lib/usage/sources/omp.server';
import { claudeSource } from '@/server/lib/usage/sources/claude.server';
import { codexUsageSource } from '@/server/lib/usage/sources/codex.server';
import { opencodeSource } from '@/server/lib/usage/sources/opencode.server';
import { zcodeSource } from '@/server/lib/usage/sources/zcode.server';
import { dshSource } from '@/server/lib/usage/sources/dsh.server';
import { qwenSource } from '@/server/lib/usage/sources/qwen.server';
import { jsonlSource } from '@/server/lib/usage/sources/jsonl.server';
import { storeHome } from '@/server/lib/usage/sources/helpers';
import type { UsageSource } from '@/server/lib/usage/sources/types';

/** Pi and OmO share omp's JSONL record shape, under their own agent dirs. */
const piSource = jsonlSource({
  id: 'pi',
  harness: 'pi',
  root: () => join(storeHome('PI_HOME', '.pi'), 'agent', 'sessions'),
});
const omoSource = jsonlSource({
  id: 'omo',
  harness: 'omo',
  root: () => join(storeHome('OMO_HOME', '.omo'), 'agent', 'sessions'),
});

/** One entry per harness family. Order is the filter's order for equal cost. */
const SOURCES: readonly UsageSource[] = [
  ompSource,
  claudeSource,
  codexUsageSource,
  opencodeSource,
  zcodeSource,
  dshSource,
  qwenSource,
  piSource,
  omoSource,
];

export function usageSources(): readonly UsageSource[] {
  return SOURCES;
}
