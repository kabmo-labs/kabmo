/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app-wide "this is demo data" marker.
 *
 * `MOCK=true` boots the server on bundled sample sessions, and the sidebar and
 * timeline then look EXACTLY like a real install: measured in mock mode, the
 * drawer listed `drrealhandler` / `History Commit 2026-09-05` and a 39-card
 * transcript with no marker anywhere in the shell. Only two panels said the
 * word "Mock", both of them deep inside Settings, so a demo instance was
 * indistinguishable from a real one at a glance — the failure R-38 names.
 *
 * Three surfaces already draw a per-panel `Mock` badge (Usage, Todos, the
 * behavior editor). This is the SHELL-level statement, and it exists once so a
 * demo session cannot look real in one place and demo in another.
 */

import { FlaskConical } from 'lucide-preact';

interface DemoDataBadgeProps {
  /**
   * `strip` is the shell-level bar drawn above the workspace; `inline` is the
   * chip a panel's own header uses.
   */
  variant?: 'strip' | 'inline';
}

export function DemoDataBadge({ variant = 'inline' }: DemoDataBadgeProps) {
  const label = 'Demo data: nothing here comes from a real session';
  if (variant === 'strip') {
    return (
      <div
        role="status"
        className="flex flex-shrink-0 items-center justify-center gap-1.5 border-b border-ink/15 bg-ink/5 px-3 py-1 text-[11px] font-medium text-muted"
      >
        <FlaskConical size={12} aria-hidden="true" />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <span
      title={label}
      className="flex-shrink-0 rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted"
    >
      Demo
    </span>
  );
}
