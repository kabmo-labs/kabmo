/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A panel plugin's settings form, rendered from its declared schema.
 *
 * The schema is the plugin's `settings-schema.json`, read by the server, so the
 * form exists without the plugin running — a switched-off plugin can still be
 * configured. Three field types are rendered (`string`, `number`, `boolean`);
 * the schema validator refuses anything else before it reaches this file, which
 * is why there is no fallback branch that would draw a control the server cannot
 * validate.
 *
 * A secret is treated as WRITE-ONLY. The server never sends the stored value, so
 * the box starts empty with a "stored" placeholder: an untouched field is left
 * out of the request, and only text the user actually typed replaces it.
 */

import { useEffect, useState } from 'preact/hooks';
import { AlertTriangle, Loader2, SlidersHorizontal } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import { PLUGIN_SECRET_MASK } from '@/shared/lib/plugins/settings';
import type { PluginSettingDefinition } from '@kabmo-labs/kabmo-sdk';

type SettingValue = string | number | boolean;
type Draft = Record<string, string | boolean>;

interface SettingsPayload {
  pluginId: string;
  definitions: Record<string, PluginSettingDefinition>;
  values: Record<string, SettingValue>;
}

interface PluginSettingsModalProps {
  pluginId: string;
  /** The plugin's display name, for the dialog header. */
  name: string;
  onClose: () => void;
}

export function PluginSettingsModal({ pluginId, name, onClose }: PluginSettingsModalProps) {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/panels/settings/${encodeURIComponent(pluginId)}`, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorOf(response));
        return (await response.json()) as SettingsPayload;
      })
      .then(
        (next) => {
          if (cancelled) return;
          setPayload(next);
          setDraft(initialDraft(next.definitions, next.values));
        },
        (cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  const definitions = payload ? Object.entries(payload.definitions) : [];

  function change(key: string, value: string | boolean) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function submit(event: Event) {
    event.preventDefault();
    if (!payload) return;
    setError(null);
    setSaved(false);

    const values: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(payload.definitions)) {
      const current = draft[key];
      if (definition.type === 'boolean') {
        values[key] = current === true;
        continue;
      }
      const text = String(current ?? '');
      // An untouched secret is not sent: the field means "keep the stored
      // value", and the server never gave us the value to repeat.
      if (definition.secret && !text) continue;
      if (definition.type === 'number') {
        const parsed = Number(text.trim());
        if (text.trim() === '' || !Number.isFinite(parsed)) {
          setError(`${definition.label} needs a number.`);
          return;
        }
        values[key] = parsed;
        continue;
      }
      values[key] = text;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/panels/settings/${encodeURIComponent(pluginId)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      if (!response.ok) throw new Error(await errorOf(response));
      const next = (await response.json()) as SettingsPayload;
      setPayload(next);
      setDraft(initialDraft(next.definitions, next.values));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-lg"
      header={
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal size={15} className="text-ink/50 flex-shrink-0" />
          <span className="text-sm font-medium text-ink truncate">{name}</span>
          <span className="text-[11px] text-ink/45 font-mono truncate">{pluginId}</span>
        </div>
      }
      form={{ onSubmit: submit, className: 'px-5 py-4 space-y-4' }}
      footer={
        <div className="flex items-center gap-2">
          {error ? (
            <span className="flex items-start gap-1.5 text-error min-w-0">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="text-[11px] leading-snug">{error}</span>
            </span>
          ) : saved ? (
            <span className="text-[11px] text-success">Saved</span>
          ) : null}
          <button
            type="submit"
            disabled={saving || !payload}
            className="ml-auto px-3 py-1.5 rounded-md bg-ink text-paper text-[11px] font-medium hover:bg-ink/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      {!payload ? (
        error ? null : (
          <div className="flex items-center gap-2 text-ink/50">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Reading settings…</span>
          </div>
        )
      ) : definitions.length === 0 ? (
        <p className="text-xs text-ink/50">This plugin declares no settings.</p>
      ) : (
        definitions.map(([key, definition]) => (
          <SettingField
            key={key}
            name={key}
            definition={definition}
            value={draft[key]}
            stored={definition.secret === true && payload.values[key] === PLUGIN_SECRET_MASK}
            onChange={(value) => change(key, value)}
          />
        ))
      )}
    </Modal>
  );
}

/** Every field is one labelled control plus its description. */
function SettingField({
  name,
  definition,
  value,
  stored,
  onChange,
}: {
  name: string;
  definition: PluginSettingDefinition;
  value: string | boolean | undefined;
  /** A secret already has a value; the box starts empty and says so. */
  stored: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const inputClass =
    'w-full px-2.5 py-1.5 rounded-lg border border-ink/15 bg-paper focus:outline-none focus:border-ink/40 text-xs text-ink transition-colors';

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink" for={`plugin-setting-${name}`}>
        {definition.label}
      </label>
      {definition.description ? (
        <p className="text-[11px] text-ink/50 leading-snug">{definition.description}</p>
      ) : null}

      {definition.type === 'boolean' ? (
        <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
          <input
            id={`plugin-setting-${name}`}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.currentTarget.checked)}
            className={`${CHECKBOX_CLASS} accent-ink cursor-pointer`}
          />
          <span className="text-[11px] text-ink/70">{value === true ? 'on' : 'off'}</span>
        </label>
      ) : (
        <input
          id={`plugin-setting-${name}`}
          type={definition.type === 'number' ? 'number' : definition.secret ? 'password' : 'text'}
          value={typeof value === 'string' ? value : ''}
          spellcheck={false}
          autocomplete="off"
          placeholder={stored ? 'stored — type a new value to replace' : undefined}
          onInput={(event) => onChange(event.currentTarget.value)}
          className={`${inputClass} font-mono`}
        />
      )}
    </div>
  );
}

/** The server's error sentence, or the status when the body carried none. */
async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `The settings request failed (${response.status})`;
}

/** The form's starting values: secrets empty, everything else as stored. */
function initialDraft(
  definitions: Record<string, PluginSettingDefinition>,
  values: Record<string, SettingValue>,
): Draft {
  const draft: Draft = {};
  for (const [key, definition] of Object.entries(definitions)) {
    if (definition.type === 'boolean') {
      draft[key] = values[key] === true;
      continue;
    }
    draft[key] = definition.secret ? '' : String(values[key] ?? '');
  }
  return draft;
}
