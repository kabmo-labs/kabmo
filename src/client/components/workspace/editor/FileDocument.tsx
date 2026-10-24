import { useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CodeSurface, type CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { FindWidget } from '@/client/components/workspace/editor/FindWidget';
import { CommandPalette } from '@/client/components/workspace/editor/CommandPalette';
import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import type { UseFileEditorResult } from '@/client/hooks/editor/use-file-editor';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';
import { EDITOR_LINE_HEIGHT } from '@/shared/lib/code/editor/typography';
import type { ViewerKind } from '@/shared/lib/fs/document-kind';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

interface FileDocumentProps {
  activeFile: { id: number | string; name: string; path: string; root?: string; repo?: string };
  editor: UseFileEditorResult;
  find: EditorFindState;
  surfaceRef: RefObject<CodeSurfaceHandle>;
  paletteOpen: boolean;
  onClosePalette: () => void;
  onRunCommand: (command: EditorCommand) => void;
  wordWrap: boolean;
  zoomLevel: number;
  editorFontFamily: string;
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
  onRunCommand,
  wordWrap,
  zoomLevel,
  editorFontFamily,
  viewerKind,
  isPreview,
  revealActive,
}: FileDocumentProps) {
  // Only markdown reaches this component in preview mode; the CSV grid and the
  // SVG picture are drawn by the viewer dispatch instead (they replace the code
  // surface rather than living inside its scroller).
  const isMd = viewerKind === 'markdown';
  /**
   * The code surface's scroller, which belongs to CodeMirror and appears only
   * once its view mounts. Reported through `onScroller` because a `ref` cannot
   * reach a node the component does not render.
   */
  const [codeScroller, setCodeScroller] = useState<HTMLElement | null>(null);
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
          scrollTestId="editor-scroller"
          className="flex-1 min-h-0 bg-paper text-ink select-text"
          padding={16}
          style={{
            fontFamily: editorFontFamily,
            fontSize: `${zoomLevel}px`,
            lineHeight: EDITOR_LINE_HEIGHT,
          }}
        />
      )}
    </div>
  );
}
