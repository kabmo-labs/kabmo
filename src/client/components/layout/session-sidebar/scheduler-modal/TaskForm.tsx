/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The schedule editor: kind picker, spec field with inline validation and a
 * live "next run" preview, target folder/session, and the prompt.
 *
 * Validation is the SHARED one (`@/shared/lib/schedule/parse`), so the preview
 * the user reads here is the exact clock the runtime will use — a second,
 * client-only parser is how a form ends up accepting a spec the server then
 * refuses.
 */

import { useEffect, useState } from 'preact/hooks';
import { Loader2 } from 'lucide-preact';
import { validateSchedule } from '@/shared/lib/schedule/parse';
import type { ScheduleKind } from '@/shared/types/schedule';
import type { ScheduleDraft } from '@/client/hooks/workspace/scheduled-tasks';
import type { ScheduleFolderOption } from '@/client/components/layout/session-sidebar/scheduler-modal/folders';

interface TaskFormProps {
  /** Workspace folders a task can run in. */
  folders: ScheduleFolderOption[];
  /** Existing task being edited, or null for a new one. */
  initial: (ScheduleDraft & { id: string }) | null;
  /** The session the composer is on, offered as "resume this conversation". */
  activeSessionId: string | null;
  busy: boolean;
  onSubmit: (draft: ScheduleDraft) => void;
  onCancel: () => void;
}

const KIND_LABELS: Record<ScheduleKind, string> = {
  once: 'Once',
  every: 'Every',
  cron: 'Cron',
};

const KIND_HINTS: Record<ScheduleKind, string> = {
  once: 'An ISO timestamp, e.g. 2026-10-01T09:00',
  every: 'A duration, e.g. 30m, 1h30m, 2 days',
  cron: '5 fields: minute hour day-of-month month day-of-week',
};

const KIND_PLACEHOLDERS: Record<ScheduleKind, string> = {
  once: '2026-10-01T09:00',
  every: '1h30m',
  cron: '0 9 * * 1-5',
};

function formatNext(at: number): string {
  const delta = at - Date.now();
  if (delta <= 0) return 'due now';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function TaskForm({
  folders,
  initial,
  activeSessionId,
  busy,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('every');
  const [spec, setSpec] = useState('1h');
  const [folderId, setFolderId] = useState<number | null>(null);
  const [useActiveSession, setUseActiveSession] = useState(false);

  // Reload the fields whenever the editor opens on a different task. Keyed on
  // the id so an unrelated parent re-render cannot wipe what the user typed.
  useEffect(() => {
    setName(initial?.name ?? '');
    setPrompt(initial?.prompt ?? '');
    setKind(initial?.kind ?? 'every');
    setSpec(initial?.spec ?? '1h');
    setFolderId(initial?.folderId ?? null);
    setUseActiveSession(Boolean(initial?.sessionId));
  }, [initial?.id]);

  const validation = validateSchedule(kind, spec);
  const canSubmit = Boolean(prompt.trim()) && validation.ok && !busy;

  const submit = () => {
    if (!canSubmit || !validation.ok) return;
    onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      kind,
      spec: spec.trim(),
      folderId,
      // Resuming a session only makes sense for a fresh draft; an existing
      // task keeps whatever it was saved with unless the box is re-ticked.
      sessionId: useActiveSession ? initial?.sessionId ?? activeSessionId : null,
      // The model snapshot is resolved server-side from the persisted
      // composer selection, so an edit never rewrites it.
      model: initial?.model ?? null,
    });
  };

  return (
    <div className="space-y-3 text-xs">
      <div>
        <label className="block font-semibold mb-1 text-ink">Name <span className="text-ink/40 font-normal">(optional)</span></label>
        <input
          type="text"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="Morning standup digest"
          className="w-full bg-paper border border-ink/20 rounded px-2.5 py-1.5 outline-none focus:border-ink/50 text-xs"
        />
      </div>

      <div>
        <label className="block font-semibold mb-1 text-ink">Prompt</label>
        <textarea
          value={prompt}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          placeholder="Describe the task, ask a question, or paste commands…"
          rows={4}
          className="w-full bg-paper border border-ink/20 rounded px-2.5 py-1.5 outline-none focus:border-ink/50 text-xs resize-y min-h-[80px]"
        />
      </div>

      <div className="flex items-end gap-2">
        <div className="w-28 flex-shrink-0">
          <label className="block font-semibold mb-1 text-ink">Schedule</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as ScheduleKind)}
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 outline-none focus:border-ink/50 text-xs"
          >
            {(Object.keys(KIND_LABELS) as ScheduleKind[]).map((value) => (
              <option key={value} value={value}>{KIND_LABELS[value]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block font-semibold mb-1 text-ink">When</label>
          <input
            type="text"
            value={spec}
            onInput={(e) => setSpec(e.currentTarget.value)}
            placeholder={KIND_PLACEHOLDERS[kind]}
            className={`w-full bg-paper border rounded px-2.5 py-1.5 outline-none text-xs font-mono ${
              validation.ok ? 'border-ink/20 focus:border-ink/50' : 'border-error/50 focus:border-error'
            }`}
          />
        </div>
      </div>

      <p className={`text-[11px] ${validation.ok ? 'text-ink/50' : 'text-error'}`}>
        {validation.ok
          ? `Next run ${formatNext(validation.nextRunAt)} · ${new Date(validation.nextRunAt).toLocaleString()}`
          : validation.error}
      </p>
      <p className="text-[11px] text-ink/40">{KIND_HINTS[kind]}</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-semibold mb-1 text-ink">Run in</label>
          <select
            value={folderId === null ? '' : String(folderId)}
            onChange={(e) => setFolderId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 outline-none focus:border-ink/50 text-xs"
          >
            <option value="">Server default directory</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className={`flex items-center gap-2 text-[11px] ${activeSessionId ? 'text-ink/70' : 'text-ink/30'}`}>
            <input
              type="checkbox"
              checked={useActiveSession}
              disabled={!activeSessionId}
              onChange={(e) => setUseActiveSession(e.currentTarget.checked)}
              className="accent-ink"
            />
            <span>Resume the open session each run</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-ink/60 hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-ink text-canvas rounded hover:bg-ink/90 transition-colors disabled:opacity-40"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {initial ? 'Save changes' : 'Schedule task'}
        </button>
      </div>
    </div>
  );
}
