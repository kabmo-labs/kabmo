import { Compass, CornerDownLeft, Keyboard, WrapText } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';

export type KeybindingOption = 'Enter' | 'Shift + Enter' | 'Ctrl / Cmd + Enter';

interface ComposerKeysSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function ComposerKeysSection({ settings, onUpdate }: ComposerKeysSectionProps) {
  const options: KeybindingOption[] = ['Enter', 'Shift + Enter', 'Ctrl / Cmd + Enter'];

  const handleKeybindingChange = (
    action: 'keybindingSend' | 'keybindingNewLine' | 'keybindingSteering',
    newValue: KeybindingOption
  ) => {
    onUpdate((prev) => {
      const updates: Partial<SettingsState> = { [action]: newValue };

      const otherActions = (
        [
          'keybindingSend',
          'keybindingNewLine',
          'keybindingSteering',
        ] as const
      ).filter((a) => a !== action);

      for (const other of otherActions) {
        if (prev[other] === newValue) {
          updates[other] = prev[action];
        }
      }

      return { ...prev, ...updates };
    });
  };

  const keybindingRows = [
    {
      id: 'keybindingSend' as const,
      label: 'Send Message',
      desc: 'Submit prompt and initiate agent reasoning',
      icon: CornerDownLeft,
      value: settings.keybindingSend || 'Enter',
    },
    {
      id: 'keybindingNewLine' as const,
      label: 'Line Break',
      desc: 'Insert newline inside input box without dispatching',
      icon: WrapText,
      value: settings.keybindingNewLine || 'Shift + Enter',
    },
    {
      id: 'keybindingSteering' as const,
      label: 'Steering Intervention',
      desc: 'Send prompt with steering interruption priority',
      icon: Compass,
      value: settings.keybindingSteering || 'Ctrl / Cmd + Enter',
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Keyboard size={15} className="text-ink/70" />
          <h4 className="text-sm font-semibold text-ink">Keyboard Shortcuts</h4>
        </div>
        <span className="text-[10px] text-ink/50 font-mono">Auto-conflict resolution</span>
      </div>

      <div className="bg-paper border border-ink/15 rounded-lg divide-y divide-ink/10 shadow-xs overflow-hidden">
        {keybindingRows.map((row) => (
          <div
            key={row.id}
            className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-ink/[0.015] transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-md bg-ink/5 flex items-center justify-center text-ink/70 flex-shrink-0 mt-0.5">
                <row.icon size={14} />
              </div>
              <div>
                <div className="font-semibold text-xs text-ink">{row.label}</div>
                <div className="text-[11px] text-ink/60 mt-0.5">{row.desc}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <select
                value={row.value}
                onChange={(e) => handleKeybindingChange(row.id, e.currentTarget.value as KeybindingOption)}
                className="bg-paper border border-ink/20 rounded-md px-2.5 py-1.5 outline-none focus:border-ink text-[11px] font-medium text-ink cursor-pointer hover:border-ink/40 transition-colors"
              >
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
