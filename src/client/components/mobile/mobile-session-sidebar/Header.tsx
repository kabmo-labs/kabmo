import { X } from 'lucide-preact';
import { BrandWordmark } from '@/client/components/common/brand-wordmark';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';

export function MobileSessionHeader({ onClose, viewLabel = 'Sessions' }: { onClose: () => void; viewLabel?: string }) {
  return (
    <div 
      className="border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0 bg-canvas titlebar-drag-region select-none"
      style={{
        height: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
        // `px-3`, the toolbar's own inset: the wordmark above and the New
        // Session button below share one left edge, which the header's old
        // 14px did not.
        paddingLeft: titlebarPaddingLeft('0.75rem', true),
        // The drawer is the full window width, so on a desktop showing the
        // mobile layout its close button sits under the window controls too.
        paddingRight: titlebarPaddingRight('0.75rem', true),
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div className="flex items-center space-x-2.5 titlebar-no-drag">
        <span className="font-bold text-sm tracking-tight flex items-center">
          <BrandWordmark className="text-[16px]" />
        </span>
        <span className="text-ink/25 text-xs select-none">/</span>
        <span className="text-[11px] font-semibold text-ink/60 uppercase tracking-wider font-mono">{viewLabel}</span>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-9 h-9 rounded-xl hover:bg-ink/5 active:bg-ink/10 text-ink flex items-center justify-center transition-colors cursor-pointer titlebar-no-drag"
        title="Close sidebar"
        aria-label="Close sidebar"
      >
        <X size={19} strokeWidth={2} />
      </button>
    </div>
  );
}
