import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Laptop, Monitor, Ratio, Smartphone, Tablet } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { ViewportMode } from '@/shared/types';

interface BrowserViewportSelectorProps {
  viewportMode: ViewportMode;
  onChangeViewport: (mode: ViewportMode) => void;
  zoomLevel?: number;
  onSetZoom?: (zoom: number) => void;
}

const VIEWPORT_OPTIONS: Array<{
  id: ViewportMode;
  label: string;
  category: 'responsive' | 'mobile';
  icon: typeof Monitor;
}> = [
  { id: 'responsive', label: 'Responsive (100% Fluid)', category: 'responsive', icon: Monitor },
  { id: 'desktop-16-9', label: 'Desktop 16:9 (Auto H:W)', category: 'responsive', icon: Ratio },
  { id: 'laptop', label: 'Laptop (1024 × 768)', category: 'responsive', icon: Laptop },
  { id: 'tablet', label: 'Tablet (768 × 1024)', category: 'mobile', icon: Tablet },
  { id: 'mobile', label: 'Mobile Phone (375 × 667)', category: 'mobile', icon: Smartphone },
  { id: 'mobile-lg', label: 'Mobile Large (414 × 896)', category: 'mobile', icon: Smartphone },
];

export function BrowserViewportSelector({
  viewportMode,
  onChangeViewport,
  zoomLevel = 100,
  onSetZoom,
}: BrowserViewportSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(dropdownRef, () => setDropdownOpen(false));

  const getViewportLabel = (mode: ViewportMode) => {
    switch (mode) {
      case 'desktop-16-9':
        return 'Desktop 16:9';
      case 'laptop':
        return 'Laptop 1024p';
      case 'tablet':
        return 'Tablet 768p';
      case 'mobile':
        return 'Mobile 375p';
      case 'mobile-lg':
        return 'Mobile Lg 414p';
      case 'responsive':
      default:
        return 'Responsive';
    }
  };

  return (
    <div className="flex items-center space-x-1.5 flex-shrink-0">
      {/* Quick Viewport Buttons */}
      <div className="hidden sm:flex items-center bg-canvas border border-ink/10 rounded-md p-0.5">
        <button
          type="button"
          onClick={() => onChangeViewport('responsive')}
          className={`p-1 rounded text-xs transition-colors cursor-pointer ${
            viewportMode === 'responsive' ? 'bg-ink text-canvas font-medium' : 'text-ink/50 hover:text-ink'
          }`}
          title="Responsive (100% Fluid)"
        >
          <Monitor size={12} />
        </button>
        <button
          type="button"
          onClick={() => onChangeViewport('desktop-16-9')}
          className={`p-1 rounded text-xs transition-colors cursor-pointer ${
            viewportMode === 'desktop-16-9' ? 'bg-ink text-canvas font-medium' : 'text-ink/50 hover:text-ink'
          }`}
          title="Desktop 16:9 (Auto Height following Width)"
        >
          <Ratio size={12} />
        </button>
        <button
          type="button"
          onClick={() => onChangeViewport('tablet')}
          className={`p-1 rounded text-xs transition-colors cursor-pointer ${
            viewportMode === 'tablet' ? 'bg-ink text-canvas font-medium' : 'text-ink/50 hover:text-ink'
          }`}
          title="Tablet (768px)"
        >
          <Tablet size={12} />
        </button>
        <button
          type="button"
          onClick={() => onChangeViewport('mobile')}
          className={`p-1 rounded text-xs transition-colors cursor-pointer ${
            viewportMode === 'mobile' ? 'bg-ink text-canvas font-medium' : 'text-ink/50 hover:text-ink'
          }`}
          title="Mobile (375px)"
        >
          <Smartphone size={12} />
        </button>
      </div>

      {/* Viewport Testing Dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center space-x-1 px-2 py-1 rounded bg-canvas border border-ink/15 hover:border-ink/30 text-ink text-[11px] font-mono transition-colors cursor-pointer"
          title="Device & Responsive Testing Menu"
        >
          <span className="hidden md:inline text-[10px] font-medium">
            {getViewportLabel(viewportMode)}
          </span>
          <ChevronDown size={11} className="text-ink/60" />
        </button>

        {dropdownOpen && (
          <div className="glass-popover absolute right-0 top-full mt-1 w-56 bg-paper border border-ink/15 rounded-lg shadow-xl py-1 z-50 text-xs font-mono">
            {/* Responsive Section */}
            <div className="px-2.5 py-1 text-[10px] text-ink/40 uppercase tracking-wider font-semibold">
              Responsive Testing
            </div>
            {VIEWPORT_OPTIONS.filter((opt) => opt.category === 'responsive').map((opt) => {
              const Icon = opt.icon;
              const isSelected = viewportMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChangeViewport(opt.id);
                    setDropdownOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-ink/5 cursor-pointer ${
                    isSelected ? 'bg-ink/10 font-semibold text-ink' : 'text-ink/75'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Icon size={13} className="text-ink/60" />
                    <span>{opt.label}</span>
                  </div>
                  {isSelected && <Check size={12} className="text-success" />}
                </button>
              );
            })}

            {/* Mobile Section */}
            <div className="mt-1 pt-1 border-t border-ink/10 px-2.5 py-1 text-[10px] text-ink/40 uppercase tracking-wider font-semibold">
              Mobile Testing
            </div>
            {VIEWPORT_OPTIONS.filter((opt) => opt.category === 'mobile').map((opt) => {
              const Icon = opt.icon;
              const isSelected = viewportMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChangeViewport(opt.id);
                    setDropdownOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-ink/5 cursor-pointer ${
                    isSelected ? 'bg-ink/10 font-semibold text-ink' : 'text-ink/75'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Icon size={13} className="text-ink/60" />
                    <span>{opt.label}</span>
                  </div>
                  {isSelected && <Check size={12} className="text-success" />}
                </button>
              );
            })}

            {/* Zoom Presets Section */}
            {onSetZoom && (
              <>
                <div className="mt-1 pt-1 border-t border-ink/10 px-2.5 py-1 text-[10px] text-ink/40 uppercase tracking-wider font-semibold">
                  Zoom Scale ({zoomLevel}%)
                </div>
                <div className="grid grid-cols-3 gap-1 px-2 py-1">
                  {[50, 75, 100, 125, 150, 200].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => {
                        onSetZoom(z);
                        setDropdownOpen(false);
                      }}
                      className={`px-1.5 py-1 text-center rounded text-[11px] font-mono cursor-pointer transition-colors ${
                        zoomLevel === z
                          ? 'bg-ink text-canvas font-semibold'
                          : 'bg-canvas border border-ink/10 text-ink/75 hover:bg-ink/5'
                      }`}
                    >
                      {z}%
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
