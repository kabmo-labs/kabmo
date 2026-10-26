import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CodeSurface, type CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { FindWidget } from '@/client/components/workspace/editor/FindWidget';
import { CommandPalette } from '@/client/components/workspace/editor/CommandPalette';
import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { indentUnitFor, useEditorIndent } from '@/client/hooks/editor/indent-settings';
import { useEditorTyping } from '@/client/hooks/editor/typing-settings';
import { EditorStatusBar } from '@/client/components/workspace/editor/StatusBar';
import { useWheelZoom } from '@/client/hooks/editor/wheel-zoom';
import { GoToLineModal } from '@/client/components/workspace/editor/GoToLineModal';
import { QuickOpenModal } from '@/client/components/workspace/editor/QuickOpenModal';
import type { CaretPosition } from '@/client/hooks/editor/caret-position';
import { lineStartOffset } from '@/shared/lib/code/editor/lines';
import type { UseFileEditorResult } from '@/client/hooks/editor/use-file-editor';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';
import { EDITOR_LINE_HEIGHT } from '@/shared/lib/code/editor/typography';
import type { ViewerKind } from '@/shared/lib/fs/document-kind';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import type { EditorThemeState } from '@/client/hooks/editor/theme';

interface FileDocumentProps {
  activeFile: { id: number | string; name: string; path: string; root?: string; repo?: string };
  editor: UseFileEditorResult;
  find: EditorFindState;
  surfaceRef: RefObject<CodeSurfaceHandle>;
  paletteOpen: boolean;
  onClosePalette: () => void;
  /** Bumped when the user asks for "go to line"; a counter, so one bump is one open. */
  goToLineRequest: number;
  /** The file picker is open. */
  quickOpen: boolean;
  onCloseQuickOpen: () => void;
  onOpenPath?: (path: string) => void;
  rootPath?: string | null;
  repoPath?: string | null;
  onRunCommand: (command: EditorCommand) => void;
  wordWrap: boolean;
  zoomLevel: number;
  /** The setter, so ⌘/Ctrl + wheel can zoom without a second source of truth. */
  setZoomLevel: (update: (current: number) => number) => void;
  editorFontFamily: string;
  editorTheme: EditorThemeState;
  /** The surface this file's kind is drawn by (see `document-kind`). */
  viewerKind: ViewerKind;
  /** The rendered view is on for the active file — render it, not the source. */
  isPreview: boolean;
  /**
   * A search hit was jumped to in this file. The find bar is closed (a search
   * jump must not cover the lines it is showing), but its matches still have to
   * be painted — that is the "highlight the results in the opened file" half of
   * the feature.
   */
  revealActive: boolean;
}

/**
 * The file's own document area: find bar, command palette, and either the
 * rendered markdown or the code surface.
 *
 * Extracted from the editor panel for the file-size ceiling, and it earns the
 * boundary — everything here is the DOCUMENT, while the panel around it is the
 * tab strip, the toolbar and the branch that decides which of the three
 * surfaces (file, diff, plugin panel) is showing.
 */
export function FileDocument({
  activeFile,
  editor,
  find,
  surfaceRef,
  paletteOpen,
  onClosePalette,
  goToLineRequest,
  quickOpen,
  onCloseQuickOpen,
  onOpenPath,
  rootPath = null,
  repoPath = null,
  onRunCommand,
  wordWrap,
  zoomLevel,
  setZoomLevel,
  editorFontFamily,
  editorTheme,
  viewerKind,
  isPreview,
  revealActive,
}: FileDocumentProps) {
  // Only markdown reaches this component in preview mode; the CSV grid and the
  // SVG picture are drawn by the viewer dispatch instead (they replace the code
  // surface rather than living inside its scroller).
  const isMd = viewerKind === 'markdown';
  // One indentation level, from the settings blob. Read here rather than passed
  // down: the setting is a live event, and a prop captured at boot would not reach
  // an editor that is already open.
  const editorIndent = useEditorIndent();
  const editorTyping = useEditorTyping();
  const [caret, setCaret] = useState<CaretPosition | null>(null);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  // The request is a COUNTER: the dialog closes itself, and a boolean would need a
  // matching "closed" write from this component to the panel that owns the chord.
  useEffect(() => {
    if (goToLineRequest > 0) setGoToLineOpen(true);
  }, [goToLineRequest]);
  /**
   * The code surface's scroller, which belongs to CodeMirror and appears only
   * once its view mounts. Reported through `onScroller` because a `ref` cannot
   * reach a node the component does not render.
   */
  const [codeScroller, setCodeScroller] = useState<HTMLElement | null>(null);
  // ⌘/Ctrl + wheel, and a trackpad pinch, clamped to the toolbar's own bounds. Armed on
  // the render the scroller arrives in: it exists only once the view mounts.
  useWheelZoom(codeScroller, setZoomLevel);
  // The document owns its scroller, so it remembers where the reader left it.
  // One offset per SURFACE: the rendered markdown and its source are different
  // documents in the same container and share neither a line nor a height.
  const scroll = useScrollRestore({
    tabKey: String(activeFile.id),
    surface: isMd && isPreview ? 'rendered' : 'code',
    ready: editor.loaded,
    // `undefined` on the markdown branch, which owns its own scroller and uses
    // the binding's `ref` instead.
    element: isMd && isPreview ? undefined : codeScroller,
  });

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {find.open ? <FindWidget find={find} /> : null}
      {paletteOpen ? <CommandPalette onRun={onRunCommand} onClose={onClosePalette} /> : null}
      {quickOpen && onOpenPath ? (
        <QuickOpenModal
          root={rootPath}
          repo={repoPath}
          onOpen={(path) => {
            onCloseQuickOpen();
            // Through `handleOpenFile`, so the tab gets the id scheme every other
            // opener shares rather than one computed here.
            onOpenPath(path);
          }}
          onClose={onCloseQuickOpen}
        />
      ) : null}
      {goToLineOpen ? (
        <GoToLineModal
          lineCount={editor.content ? editor.content.split('\n').length : 1}
          onGo={(line) => {
            setGoToLineOpen(false);
            // The handle already owns "put the caret here and show it", which is why
            // this needs no CodeMirror import: the find bar, the outline jump and the
            // search reveal all go through the same two calls.
            const offset = lineStartOffset(editor.content, line - 1);
            surfaceRef.current?.select(offset, offset, true);
            surfaceRef.current?.revealOffset(offset);
          }}
          onClose={() => setGoToLineOpen(false)}
        />
      ) : null}
      {isMd && isPreview ? (
        <div
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          // No accessible name exists for a scroll container, so the E2E layer
          // addresses it by testid (see `tests/e2e/fixtures/selectors.ts`).
          data-testid="editor-scroller"
          className="flex-1 overflow-auto bg-paper flex"
        >
          {/* No `prose` wrapper: markdown is styled by `.prose-content` alone
              (the same system the chat timeline uses). The typography plugin
              fought it — `.prose img` added 2em vertical margins that ballooned
              a badge row into its own line box, and `--tw-prose-*` colors
              ignored the theme. */}
          <div className="p-6 max-w-4xl mx-auto font-sans flex-1" style={{ fontSize: `${zoomLevel}px` }}>
            <MarkdownRenderer
              content={editor.content}
              document
              scope={{ path: activeFile.path, root: activeFile.root, repo: activeFile.repo }}
            />
          </div>
        </div>
      ) : (
        // The code surface owns its own scroller (CodeMirror's), so it is NOT
        // wrapped in one: an outer `overflow-auto` would take the document's
        // height and the editor's viewport would be the whole file.
        <CodeSurface
          ref={surfaceRef}
          value={editor.content}
          onValueChange={editor.onChange}
          language={editor.language}
          wordWrap={wordWrap}
          documentKey={String(activeFile.id)}
          marks={find.open || revealActive ? find.matches : undefined}
          currentMark={find.currentIndex}
          onCommand={onRunCommand}
          onScroller={setCodeScroller}
          onCaret={setCaret}
          scrollTestId="editor-scroller"
          // The editor theme paints its own surface, so the app's `bg-paper`
          // must not sit under it: an explicit theme's background is opaque and
          // would be a rectangle inside the panel's own colour.
          className="flex-1 min-h-0 text-ink select-text"
          themeVars={editorTheme.vars}
          themes={editorTheme.themes}
          indentUnitText={indentUnitFor(editorIndent)}
          typing={editorTyping}
          padding={16}
          style={{
            fontFamily: editorFontFamily,
            fontSize: `${zoomLevel}px`,
            lineHeight: EDITOR_LINE_HEIGHT,
          }}
        />
      )}

      {/* Where the caret is, how the file is indented, and how it ends. The phone's
          strip has printed the first of those since the editor was rebuilt; the
          desktop pane had nothing, so the line number had to be counted. */}
      {!isMd || !isPreview ? (
        <EditorStatusBar
          caret={caret}
          eol={editor.eol}
          onSetEol={editor.setEol}
          indentWidth={editorIndent.width}
          insertSpaces={editorIndent.insertSpaces}
          language={editor.language}
          byteViewer={editor.isBinaryViewer}
          viewerKind={viewerKind}
          lineCount={editor.content ? editor.content.split('\n').length : 0}
        />
      ) : null}
    </div>
  );
}
