import { PanelLeftClose } from 'lucide-preact';
import { StreamStatusDot } from '@/client/components/common/StreamStatusDot';
import { withChord } from '@/client/lib/ui/with-chord';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';

/**
 * The sidebar's title bar.
 *
 * It carries two things and no more: the wordmark (with the stream indicator
 * badged on it, the placement the phone's header uses) and the control that
 * collapses the sidebar. New Session is NOT here — it sits in the toolbar
 * immediately before New Workspace, the same slot the phone's drawer gives it,
 * so both layouts offer the primary action in the same place.
 *
 * The collapse control lives here because it is not a list action: it governs
 * the panel, and the toolbar row is where the actions on the LIST compete for
 * width. Here it is always visible at any sidebar width, which is what the
 * phone's own header already does with its close button.
 */
export function SessionSidebarHeader({
  streamStatus,
  onCollapse,
}: {
  streamStatus?: AgentStreamStatus;
  onCollapse?: () => void;
}) {
  const label = withChord('toggleSidebar', 'Collapse Sidebar');
  return (
    <div 
      className="h-10 flex-shrink-0 flex items-center justify-between px-4 border-b border-ink/10 titlebar-drag-region select-none"
      style={{ paddingLeft: 'max(1rem, env(titlebar-area-x, 0px))' }}
    >
      {/* The stream indicator badges the wordmark's top-right corner, the
          same placement the phone's header uses — it reads as part of the
          title instead of competing with the icon controls for a slot. */}
      <span className="relative font-bold text-sm tracking-tight flex items-center">
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-500 font-extrabold text-[15px] tracking-tighter">OMP</span>
        <span className="ml-[1px]">Chamber</span>
        <span className="absolute -top-0.5 -right-1.5 flex">
          <StreamStatusDot status={streamStatus} />
        </span>
      </span>

      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          title={label}
          aria-label={label}
          className="w-7 h-7 -mr-1.5 inline-flex items-center justify-center rounded text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer titlebar-no-drag"
        >
          <PanelLeftClose size={15} />
        </button>
      )}
    </div>
  );
}
