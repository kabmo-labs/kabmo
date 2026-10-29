/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { Fragment } from 'preact';
import type { AIModelOption } from '@/shared/types';
import { formatContextWindow } from '@/shared/lib/code/format';

interface ModelSpecsTooltipProps {
  model: AIModelOption | null;
}

interface SpecRow {
  label: string;
  value: string;
}

/**
 * The card that follows the row under the pointer.
 *
 * It is a definition list on one grid, not a stack of hand-written rows. The
 * version before this had six near-identical blocks that had already drifted
 * three ways: `items-start` on Capabilities against `items-center` everywhere
 * else, a mono value column under sans labels, and three different separator
 * treatments (`border-ink/10` + `pt-1`, `border-ink/5` + `pt-1`, `border-ink/5`
 * + `pt-1.5`) for the same grouping device. Every fact now renders through one
 * row shape, so a row cannot drift from its neighbours again.
 *
 * The label is a fixed grid track and the value is right-aligned in the other,
 * so labels share a left edge and values share a right edge — the card is
 * scanned as two columns, not as prose. Values are `tabular-nums` mono: the
 * numbers here (context, price per million) are compared down the list.
 */
const LABEL = 'text-[11px] leading-4 text-ink/45';
const VALUE = 'font-mono text-[11px] leading-4 tabular-nums text-ink/85 text-right break-words';
const GRID = 'grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-1.5';
/** One separator for every group boundary — the cost block and the description. */
const GROUP = 'mt-2.5 pt-2.5 border-t border-ink/10';

/**
 * A price as the registry reported it, or nothing at all.
 *
 * The registry already carries the currency (`$0.14`), so the value passes
 * through untouched: prefixing it turned `free` into `$free`, and an empty half
 * into a hole in the middle of the price line.
 */
function price(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Join the parts a model actually reports — never a blank slot between them. */
function joined(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** The model's own facts, in the order a reader asks for them. */
function modelFacts(model: AIModelOption): SpecRow[] {
  const facts: SpecRow[] = [];
  if (model.capabilities && model.capabilities.length > 0) {
    facts.push({ label: 'Capabilities', value: model.capabilities.join(', ') });
  }
  // `formatContextWindow` answers `undefined` for a value it cannot read, and a
  // row is only drawn for a value that exists.
  const context = model.contextWindow ? formatContextWindow(model.contextWindow) : undefined;
  if (context) facts.push({ label: 'Context', value: context });
  if (model.thinkingLevel) facts.push({ label: 'Thinking', value: model.thinkingLevel });
  if (model.input) facts.push({ label: 'Input', value: model.input });
  if (model.output) facts.push({ label: 'Output', value: model.output });
  return facts;
}

/** Price per million tokens — only what the registry actually reports. */
function pricingFacts(model: AIModelOption): SpecRow[] {
  const facts: SpecRow[] = [];
  const input = price(model.cost?.input);
  const output = price(model.cost?.output);
  if (input || output) {
    facts.push({ label: 'Cost', value: joined([input && `In ${input}`, output && `Out ${output}`]) });
  }
  const cacheRead = price(model.cost?.cacheRead);
  const cacheWrite = price(model.cost?.cacheWrite);
  if (cacheRead || cacheWrite) {
    facts.push({ label: 'Cache', value: joined([cacheRead && `Read ${cacheRead}`, cacheWrite && `Write ${cacheWrite}`]) });
  }
  return facts;
}

function SpecRows({ rows }: { rows: SpecRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className={LABEL}>{row.label}</dt>
          <dd className={VALUE}>{row.value}</dd>
        </Fragment>
      ))}
    </>
  );
}

export function ModelSpecsTooltip({ model }: ModelSpecsTooltipProps) {
  if (!model) return null;

  const facts = modelFacts(model);
  const pricing = pricingFacts(model);
  // Nothing to say about this model: an empty card is worse than no card.
  if (facts.length === 0 && pricing.length === 0 && !model.description) return null;

  return (
    <div
      // `pointer-events-none`: the card sits beside the list, so a card that
      // captured the pointer would take the hover off the row it describes and
      // flicker as the reader moved toward it.
      className="w-72 bg-paper/95 backdrop-blur-sm border border-ink/20 rounded-xl shadow-2xl p-3.5 text-xs text-ink select-none pointer-events-none animate-in fade-in zoom-in-95 duration-100"
    >
      {facts.length > 0 && (
        <dl className={GRID}>
          <SpecRows rows={facts} />
        </dl>
      )}

      {pricing.length > 0 && (
        <dl className={`${GROUP} ${GRID}`}>
          <SpecRows rows={pricing} />
        </dl>
      )}

      {model.description && (
        <p className={`${GROUP} text-[10px] leading-relaxed text-ink/55`}>{model.description}</p>
      )}
    </div>
  );
}
