/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The CI badge: one glyph, one tone, and the host's own word in the tooltip.
 *
 * Four states, and each is a shape as well as a colour — a red dot and a green
 * dot are the same mark to a reader who cannot tell them apart, so a failure is
 * a cross and a success a tick. `neutral` is a dash rather than a tick: a skipped
 * job is not a pass, and painting it green is the one thing a CI badge must never
 * do.
 *
 * The badge is detail-only (see `protocol.ts`): no host puts a pipeline on a list
 * response, so a row badge would cost one request per row.
 */

import type { ForgeCi } from '../protocol';
import { Glyph, ICON } from './Glyph';

const TONE: Record<ForgeCi['state'], { icon: string; className: string; label: string }> = {
  success: { icon: ICON.check, className: 'text-success', label: 'Passing' },
  failure: { icon: ICON.cross, className: 'text-error', label: 'Failing' },
  pending: { icon: ICON.clock, className: 'text-warning', label: 'Running' },
  neutral: { icon: ICON.dash, className: 'text-ink/45', label: 'Neutral' },
};

export function CiBadge({ ci }: { ci: ForgeCi }) {
  const tone = TONE[ci.state];
  const body = (
    <>
      <Glyph path={tone.icon} size={11} />
      <span>{tone.label}</span>
      <span className="font-mono text-ink/45">{ci.label}</span>
    </>
  );
  const className = `flex flex-shrink-0 items-center gap-1 text-[10px] ${tone.className}`;

  // A run's own page is the only place a reader can see WHY it failed, so the
  // badge is a link whenever the host gave one.
  return ci.url ? (
    <a href={ci.url} target="_blank" rel="noopener noreferrer" title={`${tone.label}: ${ci.label}`} className={className}>
      {body}
    </a>
  ) : (
    <span title={`${tone.label}: ${ci.label}`} className={className}>
      {body}
    </span>
  );
}
