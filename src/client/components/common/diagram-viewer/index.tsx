/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Full-screen viewer for a hydrated mermaid diagram.
 *
 * Opened by clicking a rendered diagram in the chat timeline (see
 * `MarkdownRenderer`), which hands over the SVG snapshot it read from the
 * inline block — the viewer never re-runs mermaid, so it shows exactly the
 * pixels the message shows. The full-bleed surface, the fit, the zoom/pan and
 * the control pill are `FullscreenViewer`, shared with a tool result's picture
 * so both previews stay one interaction.
 */

import { FullscreenViewer } from '@/client/components/common/fullscreen-viewer';
import type { DiagramSnapshot } from '@/client/components/common/diagram-viewer/read-block';

export interface DiagramViewerProps extends DiagramSnapshot {
  onClose: () => void;
}

export function DiagramViewer({ svg, width, height, onClose }: DiagramViewerProps) {
  return (
    <FullscreenViewer onClose={onClose} ariaLabel="Diagram viewer" measureKey={svg}>
      <div
        className="diagram-viewer-diagram"
        style={{ width: `${width}px`, height: `${height}px` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </FullscreenViewer>
  );
}
