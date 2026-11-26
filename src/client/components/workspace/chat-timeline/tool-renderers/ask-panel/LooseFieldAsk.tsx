/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A field dialog that matched NO question of the ask card, drawn where it is
 * answerable. The card owns the frame (see `looseByTool`) because the modal has
 * no ask body; this is the last resort before the agent stays parked.
 */

import { useState } from 'preact/hooks';
import type { ExtensionUiDialogRequest } from '@kabmo-labs/kabmo-chat-contracts/agent';
import { FrameControl } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/FrameControl';
import { QuestionCard } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/QuestionCard';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

export function LooseFieldAsk({
  frame,
  onRespond,
}: {
  frame: ExtensionUiDialogRequest;
  onRespond: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const multi = frame.selectionMarker === 'checkbox';
  return (
    <QuestionCard index={0} total={1} question={frame.title || 'Input needed'} multi={multi}>
      <FrameControl
        frame={frame}
        multi={multi}
        selected={selected}
        onAnswer={(value) => onRespond(frame, { value })}
        onToggle={(label) => {
          setSelected((current) => (
            current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
          ));
          onRespond(frame, { value: label });
        }}
        onRespond={(response) => onRespond(frame, response)}
      />
    </QuestionCard>
  );
}
