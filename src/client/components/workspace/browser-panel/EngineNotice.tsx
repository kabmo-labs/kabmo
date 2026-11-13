/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Why the Browser Agent panel is empty, when the reason is the ENGINE.
 *
 * The panel mirrors the project-shared Chromium over CDP. omp opens tabs in its
 * own WebKit engine (ABKit) by default when that engine is installed, and
 * WebKit has no CDP endpoint and no frame stream — so a WebKit session can
 * never appear here, no matter how long the panel waits. Without this notice
 * the panel said "No browser is open" while the agent was browsing, which is
 * the one explanation that is actively wrong.
 *
 * The button is the fix, and the cost is stated beside it: switching to
 * Chromium buys the mirror and gives up the engine's anti-detection and its
 * smaller footprint. The figures are the ones measured on this machine with a
 * single tab open (WebKit ~93 MB across 2 processes, Chromium ~259 MB across 7;
 * ABKit 419 MB on disk, Chrome for Testing 346 MB).
 */

import { AlertTriangle, Loader2 } from 'lucide-preact';

interface BrowserEngineNoticeProps {
  saving: boolean;
  error: string | null;
  onUseChromium: () => void;
  /** `body` fills the panel; `strip` is the one-line banner above a live view. */
  variant: 'body' | 'strip';
}

const COSTS: ReadonlyArray<readonly [string, string]> = [
  ['RAM', '~93 MB → ~259 MB untuk satu tab'],
  ['Disk', '~346 MB untuk Chrome for Testing bila belum terpasang'],
  ['Idle', 'Tab Chromium terus melukis; omp membekukannya saat turn selesai'],
  ['Deteksi', 'Halaman bisa melihat otomasi (navigator.webdriver, CDP)'],
];

function SwitchButton({ saving, onUseChromium }: { saving: boolean; onUseChromium: () => void }) {
  return (
    <button
      type="button"
      onClick={onUseChromium}
      disabled={saving}
      className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-ink/5 px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-ink/10 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving && <Loader2 size={11} className="animate-spin" />}
      {saving ? 'Mengaktifkan…' : 'Pakai Chromium'}
    </button>
  );
}

export function BrowserEngineNotice({
  saving,
  error,
  onUseChromium,
  variant,
}: BrowserEngineNoticeProps) {
  if (variant === 'strip') {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 bg-ink/[0.03] px-2.5 py-1.5 flex-shrink-0">
        <span className="min-w-0 truncate text-[11px] text-ink/70">
          Agen memakai WebKit — tab baru tidak akan muncul di panel ini.
        </span>
        <SwitchButton saving={saving} onUseChromium={onUseChromium} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto p-6 text-center select-none my-auto">
      <div className="w-12 h-12 rounded-xl bg-ink/5 border border-ink/10 flex items-center justify-center text-ink/40 mb-3">
        <AlertTriangle size={24} />
      </div>
      <h3 className="text-sm font-semibold text-ink mb-1">
        Agen memakai WebKit — panel ini tidak bisa memantulkannya
      </h3>
      <p className="text-xs text-ink/60 max-w-sm">
        WebKit milik omp tidak punya CDP dan tidak mengekspos aliran frame, jadi tab yang
        dijalankannya tidak bisa ditampilkan di sini. Panel ini hanya bisa memantulkan Chromium.
      </p>

      <div className="mt-4 w-full max-w-sm rounded-lg border border-ink/10 bg-paper text-left">
        <div className="border-b border-ink/10 px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/50">
          Biaya pindah ke Chromium
        </div>
        <dl className="divide-y divide-ink/5">
          {COSTS.map(([label, value]) => (
            <div key={label} className="flex gap-2 px-3 py-1.5">
              <dt className="w-14 flex-shrink-0 text-[11px] font-medium text-ink/70">{label}</dt>
              <dd className="text-[11px] text-ink/60">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-3 flex flex-col items-center gap-1.5">
        <SwitchButton saving={saving} onUseChromium={onUseChromium} />
        <p className="text-[10.5px] text-ink/45 max-w-sm">
          Berlaku untuk tab yang dibuka berikutnya; sesi tidak perlu di-restart. Tab WebKit yang
          sudah terbuka tetap tidak terlihat.
        </p>
        {error && (
          <p role="alert" className="text-[11px] text-error max-w-sm">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
