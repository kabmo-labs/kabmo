/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A harness whose transcript is omp's JSONL shape.
 *
 * Pi and OmO write `type:"message"` records with the same `message.usage`
 * counters omp does, including the provider and model that served the turn.
 * They are append-only like omp, so they get the same byte-offset read; the
 * only difference is the root and the harness id attributed to every row.
 */

import fs from 'node:fs';
import { join } from 'node:path';

import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { completeLineOffset, foldUsageText, type UsageRollupRow } from '@/server/lib/usage/index-parse';
import { readdirOrEmpty, statOrNull } from '@/server/lib/usage/sources/helpers';
import type { UsageFileState, UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

/** A transcript larger than this is not a session we can fold cheaply. */
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

/** One omp-shaped JSONL store, rooted at its own sessions directory. */
export function jsonlSource(options: {
  id: string;
  harness: HarnessId;
  root: () => string;
}): UsageSource {
  async function list(): Promise<UsageSourceFile[]> {
    const root = options.root();
    const out: UsageSourceFile[] = [];
    for (const project of await readdirOrEmpty(root)) {
      if (!project.isDirectory()) continue;
      const dir = join(root, project.name);
      let files: string[];
      try {
        files = await fs.promises.readdir(dir);
      } catch {
        continue;
      }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        const path = join(dir, name);
        const stat = await statOrNull(path);
        if (stat) out.push({ key: `${options.id}:${path}`, harness: options.harness, project: project.name, ...stat });
      }
    }
    return out;
  }

  async function read(file: UsageSourceFile, previous: UsageFileState | null): Promise<UsageSourceRead | null> {
    if (file.size > MAX_TRANSCRIPT_BYTES) return null;
    const path = file.key.slice(options.id.length + 1);
    const rows = new Map<string, UsageRollupRow>();
    let text: string;
    let append = false;
    let baseOffset = 0;
    const canAppend = previous !== null && previous.offset > 0 && previous.size === previous.offset;
    try {
      if (previous && canAppend && file.size > previous.size) {
        text = await Bun.file(path).slice(previous.size, file.size).text();
        baseOffset = previous.size;
        append = true;
      } else {
        text = await Bun.file(path).text();
      }
    } catch {
      return null;
    }
    foldUsageText(rows, file.project, text, append, options.harness);
    return { rows, nextOffset: baseOffset + completeLineOffset(text), append };
  }

  return { id: options.id, list, read };
}
