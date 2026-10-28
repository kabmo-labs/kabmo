/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A CSV/TSV file drawn as a grid.
 *
 * The one viewer here that takes TEXT rather than bytes, because a CSV already
 * is text: it arrives through the same read the code surface uses, so the grid
 * and the source are two views of one buffer and the eye toggle switches
 * between them without a second fetch. That is also why the grid is a pure
 * function of its `content` — a keystroke in the source updates it live, which
 * is the honest behaviour for a file that IS its own text.
 *
 * Parsing lives in `shared/lib/fs/csv.ts` (pure, unit-tested): quote handling
 * is the whole difficulty, and it must not be re-implemented per surface.
 */

import { useMemo } from 'preact/hooks';
import { parseCsv } from '@/shared/lib/fs/csv';
import { DataGrid } from '@/client/components/workspace/editor/viewers/DataGrid';

interface CsvGridProps {
  content: string;
  /** Used only to pick the delimiter when the extension says TSV. */
  path: string;
}

export function CsvGrid({ content, path }: CsvGridProps) {
  const table = useMemo(() => parseCsv(content, path), [content, path]);
  return <DataGrid header={table.header} rows={table.rows} truncated={table.truncated} />;
}
