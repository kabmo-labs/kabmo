/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Capture: which microphone, how short is too short, and when does a recording
 * stop itself.
 *
 * The device list is read through `enumerateDevices`, on REQUEST — never on
 * mount. Measured in the WebKit harness this repo drives in E2E: calling it on
 * first paint wedged the page's web process, so the whole settings page became
 * unresponsive on a machine with no media backend. A button makes that a single
 * failed action instead of a dead page, and the common case — one microphone —
 * needs no list at all.
 *
 * `deviceId` is a browser fact (it changes per origin and per profile), which is
 * why it is a setting the user picks rather than something the server can know.
 */

import { useState } from 'preact/hooks';
import { ListMusic, Mic } from 'lucide-preact';
import { SearchSelect } from '@/client/components/common/search-select';
import { DICTATION_MAX_MS, DICTATION_MIN_MS } from '@/shared/lib/dictation/gate';
import type { DictationConfig } from '@/shared/lib/dictation/settings';

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-[11px] text-ink outline-none transition-colors focus:border-ink/50';

export interface CaptureSectionProps {
  config: DictationConfig;
  onPatch: (patch: Partial<DictationConfig>) => void;
}

interface DeviceRow {
  id: string;
  label: string;
}

export function CaptureSection({ config, onPatch }: CaptureSectionProps) {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [listing, setListing] = useState(false);

  const listDevices = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }
    setListing(true);
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          })),
      );
    } catch {
      setDevices([]);
    } finally {
      setListing(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Microphone and limits</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          Capture happens in this browser; the engine only ever sees the finished utterance.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-ink/15 bg-paper px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-[10px] text-ink/50">
            <span className="flex items-center gap-1.5">
              <Mic size={11} /> Input device
            </span>
            <button
              type="button"
              disabled={listing}
              onClick={() => void listDevices()}
              className="inline-flex items-center gap-1 rounded-md border border-ink/20 px-1.5 py-0.5 text-[10px] font-medium text-ink/70 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-40"
            >
              <ListMusic size={10} className={listing ? 'animate-pulse' : ''} />
              {devices === null ? 'Find microphones' : 'Refresh list'}
            </button>
          </div>
          {/* A stored id that this browser no longer lists (a headset that is
              unplugged) stays visible as `(not listed)`, so the control cannot
              silently read "System default" while the hook keeps asking for the
              old one. */}
          <SearchSelect
            ariaLabel="Input device"
            value={config.deviceId}
            onChange={(next) => onPatch({ deviceId: next })}
            placeholder="System default"
            searchable={(devices ?? []).length > 10}
            triggerClassName={INPUT_CLASS}
            options={(devices ?? []).map((device) => ({ value: device.id, label: device.label }))}
          />
          {devices !== null && devices.length === 0 && (
            <span className="text-[11px] text-ink/50">
              No input devices are listed — the browser hides them until microphone permission has
              been granted once.
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink/50">Shortest utterance (ms)</span>
            <input
              type="number"
              min={100}
              max={5000}
              step={50}
              value={config.minMs}
              onInput={(event) => onPatch({ minMs: Number(event.currentTarget.value) })}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink/50">Stop after (ms)</span>
            <input
              type="number"
              min={1000}
              max={DICTATION_MAX_MS}
              step={1000}
              value={config.maxMs}
              onInput={(event) => onPatch({ maxMs: Number(event.currentTarget.value) })}
              className={INPUT_CLASS}
            />
          </label>
        </div>
        <p className="text-[11px] leading-relaxed text-ink/50">
          Anything shorter than {config.minMs} ms (default {DICTATION_MIN_MS} ms) is refused without
          a request, and silence is refused too — a stray tap is exactly what makes a recognizer
          answer with a hallucinated “Thank you.”. A recording stops itself at {config.maxMs} ms so a
          forgotten mic cannot grow past the provider's upload limit.
        </p>
      </div>
    </section>
  );
}
