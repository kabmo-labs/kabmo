import { useEffect, useState } from 'preact/hooks';
import { Check, ChevronDown, ChevronRight, KeyRound } from 'lucide-preact';
import type { PluginItem, PluginSettingSpec } from '@/shared/types';

interface PluginSettingsSectionProps {
  plugin: PluginItem;
  disabled: boolean;
  onSave: (plugin: PluginItem, key: string, value: string) => void;
  onDelete: (plugin: PluginItem, key: string) => void;
}

/**
 * A plugin's declared settings.
 *
 * Values come from `omp-plugins.lock.json` through the server, which never
 * forwards a `secret: true` value: a plugin's API key is stored in plaintext on
 * disk, and this pane is a browser surface, so a secret can be reported as set,
 * replaced or cleared — never shown. A value is written back through
 * `omp plugin config set`, which runs omp's OWN validation (type, `min`/`max`,
 * enum membership) rather than Kabmo re-deriving rules that live in omp's
 * schema.
 */
export function PluginSettingsSection({ plugin, disabled, onSave, onDelete }: PluginSettingsSectionProps) {
  return (
    <section className="space-y-2 pt-2 border-t border-ink/10">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Settings</h3>
        <p className="text-[11px] text-ink/50 mt-0.5">
          Stored in omp-plugins.lock.json and read by the plugin at load time.
        </p>
      </div>
      <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
        {plugin.settings.map((spec) => (
          <SettingRow
            key={spec.key}
            spec={spec}
            plugin={plugin}
            disabled={disabled}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function SettingRow({
  spec,
  plugin,
  disabled,
  onSave,
  onDelete,
}: {
  spec: PluginSettingSpec;
  plugin: PluginItem;
  disabled: boolean;
  onSave: (plugin: PluginItem, key: string, value: string) => void;
  onDelete: (plugin: PluginItem, key: string) => void;
}) {
  const stored = plugin.settingValues?.[spec.key];
  const isSecretSet = plugin.secretSet?.includes(spec.key) === true;
  const initial = initialValue(spec, stored, isSecretSet);
  const [value, setValue] = useState(initial);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => setValue(initial), [initial]);

  const isSet = stored !== undefined || isSecretSet;
  const dirty = value !== initial;

  return (
    <div className="px-3 py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${spec.key}` : `Expand ${spec.key}`}
          className="mt-0.5 p-0.5 rounded text-ink/40 hover:text-ink cursor-pointer"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-ink font-mono truncate">{spec.key}</span>
            <span className="text-[10px] font-mono text-ink/40">{spec.type}</span>
            {spec.secret && <KeyRound size={11} className="text-ink/40" />}
            {isSet && <Check size={11} className="text-success" />}
          </div>
          {spec.description && (
            <p className="text-[11px] text-ink/60 leading-snug mt-0.5">{spec.description}</p>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pl-6 space-y-1.5">
          <SettingInput spec={spec} value={value} isSecretSet={isSecretSet} disabled={disabled} onChange={setValue} />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={disabled || !dirty}
              onClick={() => onSave(plugin, spec.key, value)}
              className="px-2.5 py-1 rounded-md bg-ink text-paper text-[11px] font-medium hover:bg-ink/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            {isSet && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDelete(plugin, spec.key)}
                title="Remove the stored value; omp falls back to its default"
                className="px-2.5 py-1 rounded-md border border-ink/20 text-[11px] text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40"
              >
                Clear
              </button>
            )}
            {spec.env && <span className="text-[10px] font-mono text-ink/40">env: {spec.env}</span>}
            {spec.min !== undefined && spec.max !== undefined && (
              <span className="text-[10px] text-ink/40">{spec.min}–{spec.max}</span>
            )}
          </div>
          {isSecretSet && (
            <p className="text-[10px] text-ink/45 leading-snug">
              A value is stored. omp holds it on disk and never returns it, so it can be replaced or cleared
              but not shown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The value the input starts from.
 *
 * A stored secret has no value to show — the server withheld it — so the box
 * starts EMPTY rather than prefilled with a placeholder that a careless Save
 * would write back as the literal value (the same trap the provider dialog's
 * masked key has).
 */
function initialValue(spec: PluginSettingSpec, stored: unknown, isSecretSet: boolean): string {
  if (spec.secret && isSecretSet) return '';
  if (stored !== undefined && stored !== null) return String(stored);
  return spec.default === undefined ? '' : String(spec.default);
}

function SettingInput({
  spec,
  value,
  isSecretSet,
  disabled,
  onChange,
}: {
  spec: PluginSettingSpec;
  value: string;
  isSecretSet: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const className =
    'w-full px-2.5 py-1.5 rounded-lg border border-ink/15 bg-paper focus:outline-none focus:border-ink/40 text-[11px] text-ink transition-colors disabled:opacity-60';

  if (spec.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value === 'true'}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked ? 'true' : 'false')}
          className="accent-ink cursor-pointer"
        />
        <span className="text-[11px] text-ink/70">{value === 'true' ? 'true' : 'false'}</span>
      </label>
    );
  }

  if (spec.type === 'enum' && spec.values?.length) {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`${className} cursor-pointer`}
      >
        {!spec.values.includes(value) && <option value={value}>{value || '(unset)'}</option>}
        {spec.values.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={spec.type === 'number' ? 'number' : spec.secret ? 'password' : 'text'}
      value={value}
      disabled={disabled}
      spellcheck={false}
      placeholder={spec.secret && isSecretSet ? 'stored — type a new value to replace' : undefined}
      onInput={(event) => onChange(event.currentTarget.value)}
      className={`${className} font-mono`}
    />
  );
}
