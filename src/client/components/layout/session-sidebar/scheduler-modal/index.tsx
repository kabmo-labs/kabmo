/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modal for scheduled tasks: the create/edit form plus the task list.
 *
 * This is the real feature behind the sidebar's Calendar button, which used to
 * open a mock dialog whose textarea had no state, whose "Schedule Task" button
 * only closed the window, and whose options were decorative. omp has no
 * scheduler of its own, so Kabmo owns the clock (see
 * `@/server/lib/schedule/runtime.server`) and this modal is its only UI.
 *
 * The model snapshot is taken from what the composer has selected RIGHT NOW,
 * because a scheduled run happens with nobody watching: without it the task
 * would fire on whatever model the session last used, which is exactly the
 * setting a user changes between the task being written and its first run.
 */

import { useEffect, useState } from 'preact/hooks';
import { Calendar, X } from 'lucide-preact';
import { useScheduledTasks, type ScheduleDraft } from '@/client/hooks/workspace/scheduled-tasks';
import { TaskForm } from '@/client/components/layout/session-sidebar/scheduler-modal/TaskForm';
import { TaskList } from '@/client/components/layout/session-sidebar/scheduler-modal/TaskList';
import { useScheduleFolders } from '@/client/components/layout/session-sidebar/scheduler-modal/folders';
import type { ScheduledTask } from '@/shared/types/schedule';

export interface SchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Session the composer is on, offered as "resume this conversation". */
  activeSessionId?: string | null;
  /** Surfaces a failure outside the modal (the sidebar's toast stack). */
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

/** The editor's shape: a draft plus the id it edits, or null when creating. */
type EditorState = (ScheduleDraft & { id: string }) | null;

export function SchedulerModal({
  isOpen,
  onClose,
  activeSessionId = null,
  onToast,
}: SchedulerModalProps) {
  const controller = useScheduledTasks(isOpen);
  const folders = useScheduleFolders();
  const [editor, setEditor] = useState<EditorState>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  // A reopen must not resume the previous editing session's form: the task it
  // was editing may have been deleted, or the modal reopened on another
  // workspace entirely.
  useEffect(() => {
    if (isOpen) return;
    setEditor(null);
    setCreating(false);
    setBusy(false);
    setPending(null);
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      e.preventDefault();
      // Escape backs out of the editor first — closing the whole modal would
      // discard a half-written task with no warning.
      if (editor || creating) {
        setEditor(null);
        setCreating(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, busy, editor, creating]);

  if (!isOpen) return null;

  const submit = async (draft: ScheduleDraft) => {
    setBusy(true);
    const failure = editor ? await controller.patch(editor.id, draft) : await controller.create(draft);
    setBusy(false);
    if (failure) {
      onToast?.(failure, 'error');
      return;
    }
    onToast?.(editor ? 'Scheduled task updated.' : 'Scheduled task created.', 'success');
    setEditor(null);
    setCreating(false);
  };

  const toggleEnabled = async (task: ScheduledTask) => {
    setPending(task.id);
    const failure = await controller.patch(task.id, { enabled: !task.enabled });
    setPending(null);
    if (failure) onToast?.(failure, 'error');
  };

  const runNow = async (id: string) => {
    setPending(id);
    const failure = await controller.runNow(id);
    setPending(null);
    if (failure) {
      onToast?.(failure, 'error');
      return;
    }
    onToast?.('Task dispatched — open the session to watch it run.', 'success');
  };

  const remove = async (id: string) => {
    setPending(id);
    const failure = await controller.remove(id);
    setPending(null);
    if (failure) {
      onToast?.(failure, 'error');
      return;
    }
    if (editor?.id === id) setEditor(null);
  };

  const editing = editor !== null || creating;

  return (
    <div
      className="fixed inset-0 bg-ink/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Scheduled tasks"
    >
      <div
        className="bg-paper border border-ink/15 rounded-xl shadow-2xl w-[min(94vw,640px)] max-h-[88vh] flex flex-col overflow-hidden text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink/10">
          <div className="flex items-center gap-2">
            <Calendar size={15} />
            <h3 className="font-semibold text-sm">Scheduled Tasks</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -m-1.5 rounded text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {controller.error && !editing && (
            <p className="text-[11px] text-error border border-error/30 bg-error/5 rounded px-2.5 py-1.5">
              {controller.error}
            </p>
          )}

          {editing ? (
            <TaskForm
              folders={folders}
              initial={editor}
              activeSessionId={activeSessionId}
              busy={busy}
              onSubmit={submit}
              onCancel={() => {
                setEditor(null);
                setCreating(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full py-2 rounded-lg border border-dashed border-ink/20 text-xs font-medium text-ink/70 hover:text-ink hover:border-ink/40 transition-colors"
            >
              + New scheduled task
            </button>
          )}

          {!editing && (
            <TaskList
              tasks={controller.tasks}
              loading={controller.loading}
              pending={pending}
              onRunNow={runNow}
              onToggleEnabled={toggleEnabled}
              onEdit={(task) =>
                setEditor({
                  id: task.id,
                  name: task.name,
                  prompt: task.prompt,
                  kind: task.kind,
                  spec: task.spec,
                  folderId: task.folderId,
                  sessionId: task.sessionId,
                  model: task.model,
                })
              }
              onDelete={remove}
              loadRuns={controller.loadRuns}
            />
          )}
        </div>
      </div>
    </div>
  );
}
