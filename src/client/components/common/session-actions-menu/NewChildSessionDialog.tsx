/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "New child session" from a row's menu.
 *
 * The child needs a first prompt — a session with none is not a thing Kabmo can
 * create — so the menu item opens this small form instead of firing a request
 * blind. The harness is explicit because cross-provider delegation is the point:
 * one agent asks another to review.
 */

import { useState } from 'preact/hooks';
import { Modal } from '@/client/components/common/Modal';
import { HARNESS_IDS, harnessDescriptor } from '@/shared/lib/harness/catalog';

export interface NewChildSessionDialogProps {
  parentSessionId: string;
  onClose: () => void;
}

export function NewChildSessionDialog({ parentSessionId, onClose }: NewChildSessionDialogProps) {
  const [harness, setHarness] = useState('omp-rpc');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parentSessionId,
          harness,
          prompt: prompt.trim(),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { sessionId?: string; error?: string }
        | null;
      if (!response.ok || !body?.sessionId) {
        setError(body?.error ?? 'Could not create the child session.');
        setBusy(false);
        return;
      }
      window.location.assign(`/?sessionId=${encodeURIComponent(body.sessionId)}`);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  };

  return (
    <Modal
      header="New child session"
      onClose={onClose}
      form={{ onSubmit: submit, className: 'flex flex-col gap-3' }}
      zClass="z-[80]"
      footer={
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs text-ink/70 hover:bg-ink/5 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="px-3 py-1.5 rounded-md text-xs bg-ink text-paper disabled:opacity-40 cursor-pointer"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      }
    >
      <label className="flex flex-col gap-1 px-4 pt-3 text-xs">
        <span className="text-ink/60">Harness</span>
        <select
          value={harness}
          onChange={(event) => setHarness(event.currentTarget.value)}
          className="rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-xs"
        >
          {HARNESS_IDS.map((id) => (
            <option key={id} value={id}>
              {harnessDescriptor(id)?.label ?? id}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 px-4 text-xs">
        <span className="text-ink/60">First prompt</span>
        <textarea
          value={prompt}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          rows={5}
          autoFocus
          className="rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-xs font-sans resize-y"
          placeholder="What should this child do?"
        />
      </label>
      {error && <p className="px-4 text-xs text-error">{error}</p>}
    </Modal>
  );
}
