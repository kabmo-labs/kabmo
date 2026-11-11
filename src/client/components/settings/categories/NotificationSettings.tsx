/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import {
  BellRing,
  CircleCheck,
  CircleQuestionMark,
  Monitor,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import { playNotificationSound } from '@/client/hooks/ui/notification-sound';
import { requestNotificationPermission } from '@/client/lib/notifications/os';
import { notificationPlatformForClient } from '@/client/lib/notifications/platform';

interface NotificationSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

interface SwitchProps {
  /** Named device or event: the accessible label reads "Enable <label>". */
  label: string;
  enabled: boolean;
  onToggle: () => void;
}

function Switch({ label, enabled, onToggle }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${label}`}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        enabled ? 'bg-ink' : 'bg-ink/20'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-paper shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

interface SystemToggleProps {
  icon: typeof BellRing;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

function SystemToggle({ icon: Icon, title, description, enabled, onToggle }: SystemToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-ink/5 border border-ink/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon size={16} className={enabled ? 'text-ink' : 'text-ink/40'} />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">{title}</div>
          <p className="text-ink/65 text-[11px] mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <Switch label={title} enabled={enabled} onToggle={onToggle} />
    </div>
  );
}

interface PlatformSectionProps {
  icon: typeof Monitor;
  title: string;
  description: string;
  enabled: boolean;
  /** This client's own device class, marked so the two switches are not a guess. */
  current: boolean;
  onToggle: () => void;
}

function PlatformSection({ icon: Icon, title, description, enabled, current, onToggle }: PlatformSectionProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-canvas/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={15} className={enabled ? 'text-ink' : 'text-ink/40'} />
          <span className="text-sm font-semibold text-ink">{title}</span>
          {current && (
            <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-ink/10 text-ink/80 font-bold">
              This device
            </span>
          )}
        </div>
        <Switch label={`${title} notifications`} enabled={enabled} onToggle={onToggle} />
      </div>
      <p className="text-ink/65 text-[11px] leading-relaxed">{description}</p>
    </div>
  );
}

const PLATFORM_KEYS = {
  desktop: 'notifyDesktopEnabled',
  mobile: 'notifyMobileEnabled',
} as const;

type NotificationEventKey = 'notifyOnFinish' | 'notifyOnAsk' | 'notifyOnError';

export function NotificationSettings({ settings, onUpdate }: NotificationSettingsProps) {
  const [isPlayingTest, setIsPlayingTest] = useState(false);

  const handleTestSound = () => {
    setIsPlayingTest(true);
    playNotificationSound();
    setTimeout(() => setIsPlayingTest(false), 600);
  };

  const isSoundEnabled = settings.chatCompletionSound ?? settings.soundAlerts ?? true;
  const desktopEnabled = settings.notifyDesktopEnabled !== false;
  const mobileEnabled = settings.notifyMobileEnabled !== false;
  const anySystemNotification = settings.notifyOnFinish === true
    || settings.notifyOnAsk === true
    || settings.notifyOnError === true;
  const currentPlatform = notificationPlatformForClient();

  // A preference can be turned on in another tab, a browser, or before this
  // shell was installed — and the OS permission belongs to THIS shell. Opening
  // the page that owns the preference is the honest moment to ask, and the
  // shell answers immediately when permission is already granted.
  useEffect(() => {
    const enabledHere = currentPlatform === 'mobile' ? mobileEnabled : desktopEnabled;
    if (anySystemNotification && enabledHere) void requestNotificationPermission();
  }, [anySystemNotification, desktopEnabled, mobileEnabled, currentPlatform]);

  // Turning a switch on asks for permission immediately, so it can never read
  // "on" without the shell having had its chance to prompt.
  const setPlatform = (platform: keyof typeof PLATFORM_KEYS, next: boolean) => {
    onUpdate({ [PLATFORM_KEYS[platform]]: next });
    if (next) void requestNotificationPermission();
  };

  const setSystemNotification = (key: NotificationEventKey, next: boolean) => {
    onUpdate({ [key]: next });
    if (next) void requestNotificationPermission();
  };

  return (
    <div className="w-full space-y-6 text-xs text-ink">
      {/* Primary Section: AI Response Sound Notification */}
      <div className="bg-paper border border-ink/15 rounded-lg p-4 shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-ink/5 border border-ink/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              {isSoundEnabled ? (
                <Volume2 size={16} className="text-ink" />
              ) : (
                <VolumeX size={16} className="text-ink/40" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold text-ink flex items-center gap-2">
                <span>AI Response Completion Sound</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-ink/10 text-ink/80 font-bold">
                  Audio Chime
                </span>
              </div>
              <p className="text-ink/65 text-[11px] mt-1 leading-relaxed">
                Play an audible notification chime when the AI completes generating its response, thinking blocks, or diagnostic execution.
              </p>
            </div>
          </div>

          <Switch
            label="AI response completion sound"
            enabled={isSoundEnabled}
            onToggle={() => {
              const next = !isSoundEnabled;
              onUpdate({
                chatCompletionSound: next,
                soundAlerts: next,
              });
              if (next) {
                playNotificationSound();
              }
            }}
          />
        </div>

        {/* Test Button & Audio Preview */}
        <div className="pt-3 border-t border-ink/10 flex items-center justify-between">
          <span className="text-[11px] text-ink/60 flex items-center gap-1.5">
            <Sparkles size={13} className="text-ink/60" />
            Warm harmonic chime synthesized natively via Web Audio
          </span>

          <button
            type="button"
            onClick={handleTestSound}
            className={`px-3 py-1.5 rounded-md border border-ink/20 bg-paper hover:bg-ink/5 text-ink font-medium text-[11px] flex items-center gap-1.5 transition-all shadow-xs active:scale-95 ${
              isPlayingTest ? 'border-ink bg-ink/10' : ''
            }`}
          >
            <Volume2 size={13} className={isPlayingTest ? 'animate-bounce text-ink' : 'text-ink/70'} />
            <span>{isPlayingTest ? 'Playing...' : 'Test Sound'}</span>
          </button>
        </div>
      </div>

      {/* System Notifications */}
      <div className="bg-paper border border-ink/15 rounded-lg p-4 shadow-xs space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-ink/5 border border-ink/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <BellRing size={16} className="text-ink" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">System Notifications</div>
            <p className="text-ink/65 text-[11px] mt-1 leading-relaxed">
              Sent whether or not Kabmo is the window you are looking at. Clicking one opens that
              session; the sidebar badge stays the in-app record either way.
            </p>
          </div>
        </div>

        {/* Two delivery sections: each master switch silences its own device class. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <PlatformSection
            icon={Monitor}
            title="Desktop"
            description="This computer: a browser tab, an installed PWA, or the desktop shell."
            enabled={desktopEnabled}
            current={currentPlatform === 'desktop'}
            onToggle={() => setPlatform('desktop', !desktopEnabled)}
          />
          <PlatformSection
            icon={Smartphone}
            title="Mobile"
            description="A phone or tablet, including the Android and iOS shells."
            enabled={mobileEnabled}
            current={currentPlatform === 'mobile'}
            onToggle={() => setPlatform('mobile', !mobileEnabled)}
          />
        </div>

        <div className="pt-3 border-t border-ink/10">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50 pb-1">
            Notify me when
          </div>
          <div className="divide-y divide-ink/10">
            <SystemToggle
              icon={CircleCheck}
              title="Run finished"
              description="A session's agent finished its turn."
              enabled={settings.notifyOnFinish === true}
              onToggle={() => setSystemNotification('notifyOnFinish', settings.notifyOnFinish !== true)}
            />
            <SystemToggle
              icon={CircleQuestionMark}
              title="Waiting for you"
              description="An agent is blocked on a question or an approval."
              enabled={settings.notifyOnAsk === true}
              onToggle={() => setSystemNotification('notifyOnAsk', settings.notifyOnAsk !== true)}
            />
            <SystemToggle
              icon={TriangleAlert}
              title="Run failed"
              description="A run ended in failure, with the reason when the agent reported one."
              enabled={settings.notifyOnError === true}
              onToggle={() => setSystemNotification('notifyOnError', settings.notifyOnError !== true)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
