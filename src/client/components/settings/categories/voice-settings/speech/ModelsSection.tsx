/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Voice → Speech → Local models.
 *
 * Three lists in one place, because they answer one question — "what can I pick
 * right now?":
 *
 * - **Installed**: what the server can load. One is selected; the others are
 *   removable, because a 146 MB model the user no longer wants is disk they
 *   cannot get back from anywhere else.
 * - **Available**: the bundles this build can fetch in one click, with the size
 *   stated before the click. A download is a wait, not a surprise.
 * - **From a link**: a bundle the catalog does not know. The server detects the
 *   architecture from the archive's own file names and refuses anything it
 *   cannot run, so a wrong link says so instead of half-installing.
 *
 * A job's progress comes from the server, not from this component's own
 * bookkeeping: the download survives a settings tab being closed and reopened.
 */

import { useState } from 'preact/hooks';
import { Download, Link2, Loader2, Trash2, TriangleAlert } from 'lucide-preact';
import {
  describeLocalModel,
  formatModelSize,
  type InstallJob,
  type LocalTtsModelInfo,
} from '@/shared/lib/tts/local-models';
import type { LocalModelInfo, LocalTtsModelsActions } from '@/client/hooks/settings/local-tts-models';
import { INPUT_CLASS } from '@/client/components/settings/categories/voice-settings/speech/styles';

export interface SpeechModelsSectionProps {
  config: { model: string };
  server: LocalTtsModelsActions;
  onSelect: (id: string) => void;
}

function jobFor(jobs: readonly InstallJob[], id: string): InstallJob | undefined {
  return jobs.find((job) => job.id === id);
}

function statusLine(job: InstallJob | undefined): string {
  if (!job) return '';
  switch (job.status) {
    case 'downloading': {
      const of = job.total > 0 ? ` of ${formatModelSize(job.total)}` : '';
      return `Downloading ${formatModelSize(job.received) || '0 MB'}${of}`;
    }
    case 'extracting':
      return 'Unpacking';
    case 'probing':
      return 'Loading the model once';
    case 'ready':
      return 'Ready';
    case 'error':
      return job.error ?? 'The install failed.';
  }
}

function JobRow({ job, onRetry }: { job: InstallJob; onRetry: () => void }) {
  const running = job.status === 'downloading' || job.status === 'extracting' || job.status === 'probing';
  return (
    <div className="rounded-lg border border-ink/15 bg-ink/[0.02] px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] text-ink/70">
        {running ? <Loader2 size={12} className="animate-spin" /> : <TriangleAlert size={12} className="text-error" />}
        <span className="font-medium text-ink">{job.label}</span>
        <span className="text-ink/60">{statusLine(job)}</span>
        {job.status === 'error' && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto rounded border border-ink/20 px-1.5 py-0.5 text-[10px] text-ink/70 hover:border-ink/40 hover:text-ink"
          >
            Try again
          </button>
        )}
      </div>
      {running && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-ink/50 transition-[width] duration-300"
            style={{ width: `${Math.round(Math.max(0.02, Math.min(1, job.progress)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function InstalledRow({
  model,
  selected,
  job,
  busy,
  onSelect,
  onRemove,
}: {
  model: LocalModelInfo;
  selected: boolean;
  job: InstallJob | undefined;
  busy: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-ink bg-ink/5 ring-1 ring-ink/20' : 'border-ink/15 bg-paper hover:border-ink/30'
      }`}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-ink">{model.label}</span>
          {selected && <span className="rounded bg-ink px-1.5 py-0.5 text-[9px] uppercase text-paper">In use</span>}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink/60">{describeLocalModel(model)}</p>
        {model.languages.length === 0 && (
          <p className="mt-1 text-[10px] leading-relaxed text-ink/50">
            This model declares no languages, so the language is passed through unchanged.
          </p>
        )}
        {job?.status === 'error' && <p className="mt-1 text-[10px] text-error">{job.error}</p>}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        aria-label={`Remove ${model.label}`}
        className="rounded-md border border-ink/15 p-1.5 text-ink/60 transition-colors hover:border-error/40 hover:text-error disabled:opacity-40"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export function SpeechModelsSection({ config, server, onSelect }: SpeechModelsSectionProps) {
  const [link, setLink] = useState('');
  const state = server.state;
  const installed = state?.models ?? [];
  const catalog = state?.catalog ?? [];
  const jobs = state?.jobs ?? [];
  const installedIds = new Set(installed.map((model) => model.id));

  const available: LocalTtsModelInfo[] = catalog.filter((entry) => !installedIds.has(entry.id));
  const runtimeDown = state !== null && !state.runtime.available;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Local models</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          Runs inside Kabmo&apos;s own server — no key, no upload. Pick the model here, then its
          voice and language under Voice and rate.
        </p>
      </div>

      {server.error && (
        <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] leading-relaxed text-error">
          {server.error}
        </p>
      )}

      {runtimeDown && (
        <p className="rounded-lg border border-ink/15 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          {state?.runtime.reason ?? 'The ONNX runtime is unavailable on this platform.'}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-medium text-ink/70">Installed</p>
        {state === null ? (
          <p className="text-[11px] text-ink/50">Reading the installed models…</p>
        ) : installed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/20 px-3 py-3 text-[11px] leading-relaxed text-ink/60">
            No model yet. Download one below — Supertonic 3 speaks Indonesian and English, and
            nothing leaves this machine.
          </p>
        ) : (
          installed.map((model) => (
            <InstalledRow
              key={model.id}
              model={model}
              // An empty setting means "the first installed model", which is what
              // the server synthesizes with — so it has to read as in use.
              selected={config.model === model.id || (!config.model && installed[0]?.id === model.id)}
              job={jobFor(jobs, model.id)}
              busy={server.busy}
              onSelect={() => onSelect(model.id)}
              onRemove={() => void server.remove(model.id)}
            />
          ))
        )}
      </div>

      {available.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-ink/70">Available to download</p>
          {available.map((entry) => {
            const job = jobFor(jobs, entry.id);
            return (
              <div key={entry.id} className="rounded-lg border border-ink/15 bg-paper p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink">{entry.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink/60">{describeLocalModel(entry)}</p>
                    {entry.notes && <p className="mt-1 text-[10px] leading-relaxed text-ink/50">{entry.notes}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={server.busy || runtimeDown || (job !== undefined && job.status !== 'error')}
                    onClick={() => void server.install({ id: entry.id })}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink transition-colors hover:border-ink/40 hover:bg-ink/5 disabled:opacity-40"
                  >
                    <Download size={11} />
                    Download
                  </button>
                </div>
                {job && <div className="mt-2"><JobRow job={job} onRetry={() => void server.install({ id: entry.id })} /></div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="block text-[11px] font-medium text-ink/70">Add from a link</span>
          <div className="flex gap-2">
            <input
              type="url"
              value={link}
              onInput={(event) => setLink(event.currentTarget.value)}
              placeholder="https://…/sherpa-onnx-…-int8.tar.bz2"
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={server.busy || runtimeDown || !link.trim()}
              onClick={() => {
                const url = link.trim();
                if (!url) return;
                void server.install({ url }).then((ok) => {
                  if (ok) setLink('');
                });
              }}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-ink/20 px-2.5 text-[11px] text-ink transition-colors hover:border-ink/40 hover:bg-ink/5 disabled:opacity-40"
            >
              <Link2 size={11} />
              Add
            </button>
          </div>
        </label>
        <p className="text-[10px] leading-relaxed text-ink/50">
          A `.tar.bz2` or `.tar.gz` bundle from sherpa-onnx&apos;s TTS releases. Kabmo reads the
          archive and keeps it only if it is a Supertonic or Kokoro bundle; a model it cannot run is
          refused before anything is written.
        </p>
        {jobs
          .filter((job) => job.status === 'error' && !installedIds.has(job.id))
          .map((job) => (
            <JobRow
              key={job.id}
              job={job}
              // A curated model is retried by id; a pasted bundle only by its
              // URL, which the job kept for exactly this reason.
              onRetry={() => void server.install(job.url ? { url: job.url } : { id: job.id })}
            />
          ))}
      </div>
    </section>
  );
}
