import { useEffect, useRef, useState } from 'preact/hooks';
import { AlertTriangle, FileX, Loader2 } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CodeSurface, type CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { ImageViewer } from '@/client/components/common/image-viewer';
import { EditorHeader } from '@/client/components/mobile/mobile-right-sidebar/Header';
import { SaveDeletedFileModal } from '@/client/components/workspace/editor/SaveDeletedFileModal';
import { useScrollbarFadeRef } from '@/client/hooks/ui/scrollbar-fade';
import { useFileEditor } from '@/client/hooks/editor/use-file-editor';
import { useSearchRevealTarget } from '@/client/hooks/editor/use-search-reveal';
import {
  EDITOR_DEFAULT_FONT_SIZE,
  EDITOR_LINE_HEIGHT,
  EDITOR_MAX_FONT_SIZE,
  EDITOR_MIN_FONT_SIZE,
} from '@/shared/lib/code/editor/typography';
import { useEditorFontStack } from '@/client/hooks/editor/font';

interface MobileFullEditorProps {
  file: {
    name: string;
    path?: string;
    content?: string;
    root?: string;
    repo?: string;
  };
  onClose: () => void;
  /** The file this editor names is gone from disk. */
  missing?: boolean;
  /** Fired after a debounced write lands, so the workspace panels can refresh. */
  onFileSaved?: () => void;
}

export function MobileFullEditor({ file, missing = false, onClose, onFileSaved }: MobileFullEditorProps) {
  const [isPreview, setIsPreview] = useState(file.name.endsWith('.md'));
  const [fontSize, setFontSize] = useState(EDITOR_DEFAULT_FONT_SIZE);
  const [wordWrap, setWordWrap] = useState(true);
  const fade = useScrollbarFadeRef();
  const editorFontFamily = useEditorFontStack();

  const isMd = file.name.endsWith('.md');

  const editor = useFileEditor(file, {
    flushOnUnmount: true,
    reportSaveError: true,
    downloadMimeType: 'text/plain;charset=utf-8',
    onFileSaved,
    // The write path stands down on a deleted file (and asks before a Save
    // recreates it) — see `use-file-writes.ts`.
    missing,
  });

  // A search row on the phone opens this full-screen editor, so the hand-off
  // has to be served here too: the matched ranges are painted, and the caret is
  // placed on the hit once the buffer is on screen.
  const reveal = useSearchRevealTarget(
    file.path ?? null,
    editor.content,
    editor.loaded && !editor.loadError,
  );
  const surfaceRef = useRef<CodeSurfaceHandle | null>(null);
  const revealMarks = reveal && reveal.matches.length > 0 ? reveal.matches : undefined;
  const currentMark = reveal?.currentIndex ?? -1;
  const firedRef = useRef<unknown>(null);
  useEffect(() => {
    if (!reveal || firedRef.current === reveal.request) return;
    firedRef.current = reveal.request;
    const match = reveal.matches[reveal.currentIndex];
    if (!match) return;
    surfaceRef.current?.select(match.start, match.end, false);
    surfaceRef.current?.revealOffset(match.start);
  }, [reveal]);

  const content = editor.content;
  const lang = editor.language;
  const linesCount = content.split('\n').length;

  return (
    <div className="fixed inset-x-0 top-0 h-dvh z-[60] bg-paper flex flex-col font-mono text-xs select-none">
      
      <EditorHeader
        fileName={file.name}
        isMarkdown={isMd}
        isPreview={isPreview}
        wordWrap={wordWrap}
        copied={editor.copied}
        isImage={editor.isImage}
        missing={missing}
        onSave={editor.saveNow}
        onClose={onClose}
        onTogglePreview={() => setIsPreview(!isPreview)}
        onToggleWrap={() => setWordWrap(!wordWrap)}
        onZoomOut={() => setFontSize(prev => Math.max(EDITOR_MIN_FONT_SIZE, prev - 1))}
        onZoomIn={() => setFontSize(prev => Math.min(EDITOR_MAX_FONT_SIZE, prev + 1))}
        onCopy={editor.copy}
        onDownload={editor.download}
      />

      {/* A deleted file: the buffer is still on screen and still editable, so
          the state has to be stated where the user is looking, and the Save
          that recreates it has to be confirmed. Same rule as the desktop pane. */}
      {missing && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-error/30 bg-error/10 text-error shrink-0">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11.5px] font-sans">This file was deleted from disk.</div>
            <div className="text-[11px] font-sans text-error/80">
              The buffer is still here. Saving recreates the file — autosave is off until then.
            </div>
          </div>
        </div>
      )}

      {/* Editor Content Area - Desktop styled: bg-paper text-ink. An image owns
          its own pan/zoom, so it replaces the scrolling text container rather
          than living inside it. */}
      {editor.isImage && editor.imageUrl ? (
        <ImageViewer src={editor.imageUrl} name={file.name} className="flex-1 min-h-0" />
      ) : (
        <div ref={fade.ref} onScroll={fade.onScroll} className="flex-1 min-h-0 overflow-auto relative bg-paper text-ink select-text">
          {editor.isLoading ? (
            <div className="flex items-center justify-center h-full text-ink/40 text-xs gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading file content...</span>
            </div>
          ) : editor.unsupported ? (
            // Same distinction the desktop pane draws: a file refused for its
            // KIND was not a failed read, and saying so is the whole point.
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <FileX size={20} className="text-ink/40" />
              <span className="text-xs text-ink/70 font-sans">{file.name} cannot be opened here</span>
              <span className="text-[11px] text-ink/50 font-sans max-w-[42ch]">{editor.unsupported}</span>
            </div>
          ) : editor.loadError ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <AlertTriangle size={20} className="text-error" />
              <span className="text-xs text-error font-sans">Could not read {file.name}</span>
              <span className="text-[11px] text-ink/50 font-mono break-all">{editor.loadError}</span>
            </div>
          ) : isMd && isPreview ? (
            /* Markdown Preview Mode — styled by `.prose-content` (the chat
               timeline's system), see the desktop editor for why there is no
               `prose` wrapper. */
            <div className="p-4 bg-paper text-ink min-h-full font-sans" style={{ fontSize: `${fontSize}px` }}>
              <MarkdownRenderer
                content={content}
                document
                scope={{ path: file.path ?? file.name, root: file.root, repo: file.repo }}
              />
            </div>
          ) : (
            /* Code Editor with Line Numbers - Desktop styled: gutter bg-canvas border-r border-ink/10 */
            <CodeSurface
              ref={surfaceRef}
              value={content}
              onValueChange={editor.onChange}
              language={lang}
              wordWrap={wordWrap}
              marks={revealMarks}
              currentMark={currentMark}
              rootClassName="flex min-h-full bg-paper"
              // The gutter auto-sizes to its widest number rather than taking a
              // fixed width: the numbers scale with the zoom control, and a
              // pinned `w-10` clipped a 3-digit line number at 18px.
              gutterClassName="flex flex-col text-right pr-2 select-none text-ink/30 bg-canvas border-r border-ink/10 font-mono flex-shrink-0"
              gutterLineClassName="min-w-[1.5rem]"
              gutterStyle={{
                fontSize,
                paddingTop: 12,
                paddingBottom: 12,
                lineHeight: EDITOR_LINE_HEIGHT,
                fontFamily: editorFontFamily,
              }}
              editorWrapperClassName="flex-1 p-3 overflow-x-auto min-w-0 bg-paper text-ink code-surface"
              editorClassName="focus:outline-none"
              editorStyle={{
                fontFamily: editorFontFamily,
                fontSize,
                lineHeight: EDITOR_LINE_HEIGHT,
                backgroundColor: 'transparent',
                minHeight: '100%',
                color: 'var(--theme-ink)',
              }}
            />
          )}
        </div>
      )}

      {/* Bottom Status Bar - Desktop styled: bg-canvas border-t border-ink/10 */}
      <footer
        className="bg-canvas border-t border-ink/10 px-3 flex items-center justify-between text-[10px] text-ink/60 flex-shrink-0 font-mono"
        style={{
          height: 'calc(1.75rem + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="flex items-center space-x-3">
          {editor.isImage ? (
            <span className="uppercase">Image</span>
          ) : (
            <>
              <span>{linesCount} lines</span>
              <span>{content.length} chars</span>
              <span className="uppercase">{lang}</span>
            </>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {editor.saveStatus === 'saving' && (
            <>
              <Loader2 size={10} className="animate-spin" />
              <span>Saving…</span>
            </>
          )}
          {editor.saveStatus === 'saved' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
              <span>Saved</span>
            </>
          )}
          {editor.saveStatus === 'error' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
              <span className="text-error">Save failed</span>
            </>
          )}
          {editor.saveStatus === 'idle' && file.path && <span className="truncate max-w-[140px]">{file.path}</span>}
        </div>
      </footer>

      {editor.saveMissingConfirm && file.path && (
        <SaveDeletedFileModal
          fileName={file.name}
          filePath={file.path}
          onClose={editor.cancelSaveMissing}
          onConfirm={editor.confirmSaveMissing}
        />
      )}

    </div>
  );
}
