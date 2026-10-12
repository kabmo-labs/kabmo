import { ArrowLeft, Check, Copy, Download, Eye, EyeOff, Save, WrapText, ZoomIn, ZoomOut } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';

interface EditorHeaderProps {
  fileName: string;
  /** Markdown files can toggle between source and rendered preview. */
  isMarkdown: boolean;
  isPreview: boolean;
  wordWrap: boolean;
  copied: boolean;
  /** Raster image: wrap and font zoom are text-only, so both are hidden. */
  isImage?: boolean;
  /** The file is gone from disk: the name goes red and struck through. */
  missing?: boolean;
  /** Save, offered ONLY while the file is missing. */
  onSave?: () => void;
  onClose: () => void;
  onTogglePreview: () => void;
  onToggleWrap: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

/** Mobile editor top bar: back/close, file identity, and the file actions. */
export function EditorHeader({
  fileName,
  isMarkdown,
  isPreview,
  wordWrap,
  copied,
  isImage = false,
  missing = false,
  onSave,
  onClose,
  onTogglePreview,
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
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
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

        {isMarkdown && (
          <button
            type="button"
            onClick={onTogglePreview}
            className={`p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer ${isPreview ? 'bg-ink text-canvas' : ''}`}
            title={isPreview ? 'View code' : 'Preview markdown'}
          >
            {isPreview ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}

        {!isImage && (
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
