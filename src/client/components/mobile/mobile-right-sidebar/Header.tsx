/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Mobile editor top bar: back/close, file identity, and the file actions.
 *
 * **Nine controls never fit one 390px row.** They used to try, at `p-1.5` each,
 * which measured every control at **27x27** — under the 36px phone-chrome box
 * the rest of the app uses and 17px under the 44px touch floor — and left five of
 * them with a `title` but no accessible name. The row now draws the controls a
 * reader reaches for mid-read (find, preview/review, the overflow) at the shared
 * plate size, and folds the rest into a menu: wrap and the two zoom steps, which
 * are settings a reader changes once, plus copy and download, which are
 * one-shot exports.
 *
 * The fold is a WIDTH decision, not a device class — the same rule the header
 * cluster and the sidebar toolbar follow — so a wider phone or a rotated one
 * gets them back in the row.
 */

import { useMemo } from 'preact/hooks';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  MessageSquare,
  Save,
  Search,
  WrapText,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { EditorAction, EDITOR_ACTION_GLYPH_PX } from '@/client/components/mobile/mobile-right-sidebar/Action';
import { EditorOverflowMenu } from '@/client/components/mobile/mobile-right-sidebar/Overflow';
import { phoneRowStyle } from '@/client/lib/ui/phone-row';
import { useViewportAtLeast } from '@/client/hooks/ui/media-query';

interface EditorHeaderProps {
  fileName: string;
  /** The file has a rendered form (markdown prose, CSV grid, SVG), so the eye toggles. */
  hasPreview: boolean;
  isPreview: boolean;
  /** A rendered markdown document is on screen, so its blocks can be judged. */
  hasReview: boolean;
  isReviewing: boolean;
  onToggleReview: () => void;
  wordWrap: boolean;
  copied: boolean;
  /** A byte-drawing viewer (image, PDF, DOCX, workbook): wrap and zoom are text-only, so both are hidden. */
  byteViewer?: boolean;
  /** The file is gone from disk: the name goes red and struck through. */
  missing?: boolean;
  /** Save, offered ONLY while the file is missing. */
  onSave?: () => void;
  onClose: () => void;
  onTogglePreview: () => void;
  /** Find/replace in the file. The phone had no way to search a file at all. */
  onToggleFind: () => void;
  /** The bar is open — the control reflects it. */
  findOpen: boolean;
  onToggleWrap: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

/**
 * The width below which the one-shot actions fold.
 *
 * Measured on the real bar: close (36) + name + find (36) + preview (36) +
 * overflow (36) + the row's own padding fits a 360px phone with ~40px to spare
 * for the file name. Copy and download are the two that never need to be one tap
 * away — a reader who copies a file's contents is done reading it.
 */
const FOLD_BELOW_PX = 420;

export function EditorHeader({
  fileName,
  hasPreview,
  isPreview,
  hasReview,
  isReviewing,
  onToggleReview,
  wordWrap,
  copied,
  byteViewer = false,
  missing = false,
  onSave,
  onClose,
  onTogglePreview,
  onToggleFind,
  findOpen,
  onToggleWrap,
  onZoomOut,
  onZoomIn,
  onCopy,
  onDownload,
}: EditorHeaderProps) {
  // A hook, so it is called before any early return (there is none here, but the
  // rule is the reason it sits at the top).
  const roomy = useViewportAtLeast(FOLD_BELOW_PX);

  const folded = useMemo(() => {
    const actions = [];
    if (!byteViewer) {
      actions.push(
        { id: 'wrap', label: wordWrap ? 'Word wrap: on' : 'Word wrap: off', icon: WrapText, onSelect: onToggleWrap },
        { id: 'zoom-out', label: 'Decrease font size', icon: ZoomOut, onSelect: onZoomOut },
        { id: 'zoom-in', label: 'Increase font size', icon: ZoomIn, onSelect: onZoomIn },
      );
    }
    if (!roomy) {
      actions.push(
        { id: 'copy', label: copied ? 'Copied' : 'Copy content', icon: copied ? Check : Copy, onSelect: onCopy },
        { id: 'download', label: 'Download file', icon: Download, onSelect: onDownload },
      );
    }
    return actions;
  }, [byteViewer, roomy, wordWrap, copied, onToggleWrap, onZoomOut, onZoomIn, onCopy, onDownload]);

  return (
    <header
      className="bg-canvas border-b border-ink/10 flex items-center justify-between gap-1 px-3 flex-shrink-0 titlebar-drag-region"
      style={phoneRowStyle()}
    >
      <div className="flex items-center gap-1 min-w-0 titlebar-no-drag">
        <EditorAction label="Close editor" onClick={onClose}>
          <ArrowLeft size={EDITOR_ACTION_GLYPH_PX} strokeWidth={2} />
        </EditorAction>

        <div className="flex min-w-0 items-center gap-1.5">
          <FileIcon name={fileName} size={15} className={`flex-shrink-0${missing ? ' text-error' : ''}`} />
          <span className={`truncate font-semibold text-xs${missing ? ' text-error line-through' : ' text-ink'}`}>
            {fileName}
          </span>
        </div>
      </div>

      <div className="flex flex-none items-center gap-0.5 text-ink/70 titlebar-no-drag">
        {/* Only while the file is gone. With it present the debounced autosave
            and the closing flush already own every write, and a Save here would
            be a second way to do what typing already did. Missing is the one
            state where autosave stands down, so the explicit Save is the only
            route back — it opens the confirmation. */}
        {missing && onSave && (
          <EditorAction label="Save and recreate the file" onClick={onSave} danger>
            <Save size={EDITOR_ACTION_GLYPH_PX} />
          </EditorAction>
        )}

        {!byteViewer && (
          <EditorAction label={findOpen ? 'Close find' : 'Find in file'} onClick={onToggleFind} active={findOpen}>
            <Search size={EDITOR_ACTION_GLYPH_PX} />
          </EditorAction>
        )}

        {/* Beside the eye, and only while the RENDERED document is on screen:
            reviewing the source has no blocks to judge. */}
        {hasReview && (
          <EditorAction
            label={isReviewing ? 'Exit review mode' : 'Review this document'}
            onClick={onToggleReview}
            active={isReviewing}
          >
            <MessageSquare size={EDITOR_ACTION_GLYPH_PX} />
          </EditorAction>
        )}

        {hasPreview && (
          <EditorAction
            label={isPreview ? 'View source' : 'Show preview'}
            onClick={onTogglePreview}
            active={isPreview}
          >
            {isPreview ? <EyeOff size={EDITOR_ACTION_GLYPH_PX} /> : <Eye size={EDITOR_ACTION_GLYPH_PX} />}
          </EditorAction>
        )}

        {/* The one-shot exports, only while the row can hold them. */}
        {roomy && (
          <>
            <EditorAction label="Copy content" onClick={onCopy}>
              {copied ? <Check size={EDITOR_ACTION_GLYPH_PX} className="text-success" /> : <Copy size={EDITOR_ACTION_GLYPH_PX} />}
            </EditorAction>
            <EditorAction label="Download file" onClick={onDownload}>
              <Download size={EDITOR_ACTION_GLYPH_PX} />
            </EditorAction>
          </>
        )}

        {folded.length > 0 && <EditorOverflowMenu actions={folded} />}
      </div>
    </header>
  );
}
