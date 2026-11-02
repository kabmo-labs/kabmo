/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The project's icon: the shared glyph set, a file upload, and a generated mark.
 *
 * Three things this has to get right, each of which used to fail silently:
 *
 * 1. **The icon is TWO fields (`icon` + `customIconUrl`) and they are ONE
 *    write.** Sent as two PATCHes they race and the slower response wins, so an
 *    uploaded image appeared, saved, and then reverted to the previous icon.
 *    `onSetCustomIcon` carries both facts through one request.
 * 2. **A normal photo is not an error.** A phone picture is several MB, which
 *    the old 512 KiB ceiling refused outright. The bytes are downscaled in the
 *    browser to a 128px mark first, which is what a sidebar row can draw
 *    anyway; only an image that cannot be decoded is refused.
 * 3. **A URL is saved only after it LOADS.** The "generate" mark used to be
 *    persisted unverified, so an offline or blocked request replaced the icon
 *    with a broken image.
 */

import { useRef, useState } from 'preact/hooks';
import type { ChangeEvent } from 'preact/compat';
import { Dice5, Loader2, Upload, X } from 'lucide-preact';
import { PROJECT_ICON_OPTIONS } from '@/shared/lib/workspace/project-icon';

interface ProjectIconGridProps {
  currentIcon: string;
  customIconUrl?: string;
  projectName: string;
  /** Choose a built-in glyph. Clears any custom icon in the same write. */
  onSelectIcon: (iconId: string) => void;
  /**
   * Set (or clear, with `undefined`) the custom mark. The caller writes BOTH
   * `customIconUrl` and the `icon` discriminator in one request.
   */
  onSetCustomIcon: (url: string | undefined) => void;
  disabled?: boolean;
}

/** The side of the mark a sidebar row and this grid draw. */
const MARK_PX = 128;

/** The longest edge the stored data URL may carry (~512 KiB of bytes). */
const MAX_MARK_CHARS = 700_000;

/**
 Read an image file into a square-ish mark as a PNG data URL.
 
 SVG is passed through untouched — it is already a vector and rasterizing it
 would lose quality — and a raster is downscaled to `MARK_PX`, which is smaller
 than any photo and far smaller than the 512 KiB the server accepts. Rejects when
 the browser cannot decode the file, which is the only genuinely unusable case.
 */
async function fileToIconMark(file: File): Promise<string> {
  const readable = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = (event) => {
    const result = event.target?.result;
    if (typeof result === 'string' && result) readable.resolve(result);
    else readable.reject(new Error('That file could not be read as an image.'));
  };
  reader.onerror = () => readable.reject(new Error('That file could not be read as an image.'));
  reader.readAsDataURL(file);
  const asDataUrl = await readable.promise;

  // A vector needs no resampling, and a GIF loses its animation either way.
  if (file.type === 'image/svg+xml') return asDataUrl;

  const decoded = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  image.onload = () => decoded.resolve(image);
  image.onerror = () => decoded.reject(new Error('That file is not an image Kabmo can read.'));
  image.src = asDataUrl;
  const loaded = await decoded.promise;

  const scale = Math.min(1, MARK_PX / Math.max(loaded.naturalWidth, loaded.naturalHeight));
  const width = Math.max(1, Math.round(loaded.naturalWidth * scale));
  const height = Math.max(1, Math.round(loaded.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return asDataUrl;
  context.drawImage(loaded, 0, 0, width, height);
  const scaled = canvas.toDataURL('image/png');
  // A downscale that somehow grew (a tiny source re-encoded) keeps the original.
  return scaled.length > 0 && scaled.length < asDataUrl.length ? scaled : asDataUrl;
}

export function ProjectIconGrid({
  currentIcon,
  customIconUrl,
  projectName,
  onSelectIcon,
  onSetCustomIcon,
  disabled = false,
}: ProjectIconGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    // Cleared immediately so picking the SAME file twice still fires a change.
    e.currentTarget.value = '';
    if (!file) return;
    setError(null);
    setIsReading(true);
    try {
      const mark = await fileToIconMark(file);
      if (mark.length > MAX_MARK_CHARS) {
        setError('That image is too detailed to store as a mark — try a PNG or SVG.');
        return;
      }
      onSetCustomIcon(mark);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsReading(false);
    }
  };

  const handleGenerate = () => {
    const seed = projectName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'project';
    const url = `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}&radius=50&size=${MARK_PX}`;
    setError(null);
    setIsGenerating(true);
    // Verify the mark loads before saving it: a blocked or offline request must
    // not overwrite the icon with a URL that renders as nothing.
    const probe = new Image();
    probe.onload = () => {
      setIsGenerating(false);
      onSetCustomIcon(url);
    };
    probe.onerror = () => {
      setIsGenerating(false);
      setError('The generated icon could not be loaded — check your connection.');
    };
    probe.src = url;
  };

  const busy = disabled || isReading || isGenerating;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-ink">Project icon</h4>
        {customIconUrl && (
          <button
            type="button"
            onClick={() => onSetCustomIcon(undefined)}
            disabled={busy}
            className="text-[11px] text-ink/50 hover:text-error transition-colors cursor-pointer disabled:opacity-50"
          >
            Use a standard icon
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PROJECT_ICON_OPTIONS.map((item) => {
          const isSelected = !customIconUrl && currentIcon === item.id;
          const IconComp = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectIcon(item.id)}
              disabled={busy}
              aria-label={item.label}
              aria-pressed={isSelected}
              title={item.label}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-all cursor-pointer disabled:opacity-50 ${
                isSelected
                  ? 'border border-ink/40 bg-ink/5 text-ink shadow-2xs'
                  : 'border border-transparent text-ink/60 hover:text-ink hover:bg-ink/5'
              }`}
            >
              <IconComp size={14} strokeWidth={1.8} />
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(event) => void handleFileUpload(event)}
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-ink/20 hover:border-ink/40 bg-paper text-ink text-xs font-medium transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
        >
          {isReading ? <Loader2 size={13} className="animate-spin text-ink/60" /> : <Upload size={13} className="text-ink/60" />}
          <span>{isReading ? 'Reading…' : 'Upload image'}</span>
        </button>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          title="Generate a stable identicon from the project name"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-ink/20 hover:border-ink/40 bg-paper text-ink text-xs font-medium transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
        >
          {isGenerating ? <Loader2 size={13} className="animate-spin text-ink/60" /> : <Dice5 size={13} className="text-ink/60" />}
          <span>{isGenerating ? 'Generating…' : 'Generate mark'}</span>
        </button>

        {customIconUrl && (
          <div className="flex items-center gap-2 ml-1 pl-2 border-l border-ink/10">
            <img
              src={customIconUrl}
              alt="Current custom icon"
              className="w-5 h-5 rounded-xs object-contain border border-ink/15"
              referrerPolicy="no-referrer"
            />
            <span className="text-[11px] text-ink/60">Custom icon in use</span>
            <button
              type="button"
              onClick={() => onSetCustomIcon(undefined)}
              disabled={busy}
              aria-label="Remove the custom icon"
              className="p-0.5 rounded text-ink/40 hover:text-error transition-colors cursor-pointer disabled:opacity-50"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      <p className="text-[11px] text-ink/50">
        Any image works — it is scaled down to a {MARK_PX}px mark. PNG, JPEG, WebP, GIF or SVG.
      </p>

      {error && <p className="text-[11px] text-error">{error}</p>}
    </div>
  );
}
