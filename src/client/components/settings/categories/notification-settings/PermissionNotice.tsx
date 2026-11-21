/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The system refused this app's notifications.
 *
 * The three event switches are the console's OWN preference and stay on when the
 * platform says no — that is what made a denied grant invisible: the page read
 * "on" while every banner, and the chime the banner carries, was dropped before
 * it reached the user. This card states the refusal and, where the platform has
 * a screen for it, opens that screen.
 */

import { TriangleAlert } from 'lucide-preact';
import { openNotificationSettings } from '@/client/lib/notifications/os';

interface PermissionNoticeProps {
  /** Whether this platform has a settings screen the grant lives on. */
  canOpenSettings: boolean;
}

export function PermissionNotice({ canOpenSettings }: PermissionNoticeProps) {
  return (
    <div className="rounded-lg border border-ink/20 bg-ink/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <TriangleAlert size={15} className="text-ink flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-ink">
            The system is blocking Kabmo&rsquo;s notifications
          </div>
          <p className="text-ink/65 text-[11px] mt-1 leading-relaxed">
            Every banner and its chime is dropped before it reaches you. Allow Kabmo in your system
            notification settings, then come back — this page re-reads the answer.
          </p>
        </div>
      </div>
      {canOpenSettings && (
        <button
          type="button"
          onClick={() => void openNotificationSettings()}
          className="px-3 py-1.5 rounded-md border border-ink/20 bg-paper hover:bg-ink/5 text-ink font-medium text-[11px] transition-all shadow-xs"
        >
          Open system settings
        </button>
      )}
    </div>
  );
}
