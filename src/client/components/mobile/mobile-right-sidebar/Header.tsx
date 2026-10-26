import { ArrowLeft, Check, Copy, Download, Eye, EyeOff, Save, Search, WrapText, ZoomIn, ZoomOut } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';

interface EditorHeaderProps {
  fileName: string;
  /** The file has a rendered form (markdown prose, CSV grid, SVG), so the eye toggles. */
  hasPreview: boolean;
  isPreview: boolean;
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

/** Mobile editor top bar: back/close, file identity, and the file actions. */
export function EditorHeader({
  fileName,
  hasPreview,
  isPreview,
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
  return (
    <header
      className="bg-canvas border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0"
      style={{
        height: 'calc(3rem + env(safe-area-inset-top, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: titlebarPaddingLeft('0.75rem', true),
        paddingRight: titlebarPaddingRight('0.75rem', true),
      }}
    >
      <div className="flex items-center space-x-2 min-w-0 pr-2">
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-ink/10 text-ink transition-colors active:scale-90 flex-shrink-0 cursor-pointer"
          title="Close editor"
          aria-label="Close editor"
        >
          <ArrowLeft size={18} strokeWidth={2} />
        </button>

        <div className="flex items-center space-x-1.5 truncate">
          <FileIcon name={fileName} size={15} className={`flex-shrink-0${missing ? ' text-error' : ''}`} />
          <span className={`font-semibold text-xs truncate${missing ? ' text-error line-through' : ' text-ink'}`}>{fileName}</span>
        </div>
      </div>

      <div className="flex items-center space-x-1 text-ink/70 flex-shrink-0">
        {/* Only while the file is gone. With it present the debounced autosave
            and the closing flush already own every write, and a Save here would
            be a second way to do what typing already did. Missing is the one
            state where autosave stands down, so the explicit Save is the only
            route back — it opens the confirmation. */}
        {missing && onSave && (
          <button
            type="button"
            onClick={onSave}
            className="p-1.5 rounded bg-error text-canvas hover:bg-error/90 transition-colors cursor-pointer"
            title="Save and recreate the file"
            aria-label="Save and recreate the file"
          >
            <Save size={15} />
          </button>
        )}

        {!byteViewer && (
          <button
            type="button"
            onClick={onToggleFind}
            className={`p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer ${findOpen ? 'bg-ink text-canvas' : ''}`}
            title={findOpen ? 'Close find' : 'Find in file'}
            aria-label={findOpen ? 'Close find' : 'Find in file'}
            aria-pressed={findOpen}
          >
            <Search size={15} />
          </button>
        )}

        {hasPreview && (
          <button
            type="button"
            onClick={onTogglePreview}
            className={`p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer ${isPreview ? 'bg-ink text-canvas' : ''}`}
            // The rendered form is not always markdown (a CSV grid, an SVG
            // picture), so the words name the TOGGLE rather than one document
            // kind — and the icon-only button carries an aria-label for the
            // same reason every toolbar action does.
            title={isPreview ? 'View source' : 'Show preview'}
            aria-label={isPreview ? 'View source' : 'Show preview'}
          >
            {isPreview ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}

        {!byteViewer && (
          <>
            <button
              type="button"
              onClick={onToggleWrap}
              className={`p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer ${wordWrap ? 'text-ink' : ''}`}
              title="Toggle word wrap"
            >
              <WrapText size={15} />
            </button>

            <button
              type="button"
              onClick={onZoomOut}
              className="p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer"
              title="Decrease font size"
            >
              <ZoomOut size={15} />
            </button>

            <button
              type="button"
              onClick={onZoomIn}
              className="p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer"
              title="Increase font size"
            >
              <ZoomIn size={15} />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onCopy}
          className="p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer"
          title="Copy content"
        >
          {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
        </button>

        <button
          type="button"
          onClick={onDownload}
          className="p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer"
          title="Download file"
        >
          <Download size={15} />
        </button>
      </div>
    </header>
  );
}
