/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Plan Review: the full-screen surface for a plan the model submitted.
 *
 * The five choices are omp's own, in its own order, because the operator is
 * choosing between omp behaviours and not Kabmo behaviours:
 *
 *  - **Approve and execute** — a fresh session; the planning transcript is not
 *    carried over, which is what makes it the roomiest option.
 *  - **Approve and compact context** — the current conversation is distilled
 *    around the plan, then execution runs in it.
 *  - **Approve and keep context** — the whole planning conversation stays.
 *  - **Refine plan** — annotations go back as a planning turn; nothing runs.
 *  - **Save and quit** — the plan is written to disk and nothing executes.
 *
 * Annotations are per-section: `a` on a focused section is the TUI's gesture, so
 * the notes are collected as a list and joined into the refinement prompt rather
 * than edited into the plan body — the model is what revises it.
 */

import { useMemo, useState } from 'preact/hooks';
import { Check, FileText, X } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { PLAN_REVIEW_CHOICES, type PlanProposal } from '@/shared/lib/omp/mode/types';

export interface PlanReviewPanelProps {
  proposal: PlanProposal;
  deciding: boolean;
  error: string | null;
  onDecide: (choice: string, feedback: string) => void;
  onDismiss: () => void;
}

/** Split the plan into sections at level-2 headings, which is what the TUI's
 *  contents sidebar lists. A plan with no `##` is one section. */
function sectionsOf(markdown: string): Array<{ heading: string; body: string }> {
  const lines = markdown.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[1].trim(), body: '' };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  if (sections.length === 0) return [{ heading: 'Plan', body: markdown }];
  return sections;
}

export function PlanReviewPanel({ proposal, deciding, error, onDecide, onDismiss }: PlanReviewPanelProps) {
  const [annotations, setAnnotations] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sections = useMemo(() => sectionsOf(proposal.planContent), [proposal.planContent]);
  const annotationCount = Object.values(annotations).filter((value) => value.trim()).length;

  const feedback = Object.entries(annotations)
    .filter(([, value]) => value.trim())
    .map(([heading, value]) => `### ${heading}\n${value.trim()}`)
    .join('\n\n');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-ink/15 bg-paper shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={15} className="shrink-0 text-ink/60" />
            <span className="truncate text-sm font-medium">{proposal.title}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink/40">{proposal.planFilePath}</span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss the review without deciding"
            title="Dismiss without deciding — the plan stays parked"
            className="rounded p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {sections.length > 1 && (
            <nav className="@container w-52 shrink-0 overflow-y-auto border-r border-ink/10 p-2 text-[11.5px]">
              {sections.map((section) => (
                <div key={section.heading} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveSection(activeSection === section.heading ? null : section.heading)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left transition-colors ${
                      activeSection === section.heading ? 'bg-ink/8 text-ink' : 'text-ink/70 hover:bg-ink/5'
                    }`}
                  >
                    <span className="truncate">{section.heading}</span>
                    {annotations[section.heading]?.trim() && <Check size={11} className="shrink-0 text-ink/50" />}
                  </button>
                  {activeSection === section.heading && (
                    <textarea
                      value={annotations[section.heading] ?? ''}
                      onChange={(event) =>
                        setAnnotations((prev) => ({ ...prev, [section.heading]: event.currentTarget.value }))
                      }
                      rows={3}
                      placeholder="Notes for this section…"
                      className="mt-1 w-full resize-y rounded border border-ink/15 bg-canvas/40 px-2 py-1 text-[11px] outline-none focus:border-ink"
                    />
                  )}
                </div>
              ))}
            </nav>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <MarkdownRenderer content={proposal.planContent} />
          </div>
        </div>

        {error && (
          <div className="border-t border-error/30 bg-error/10 px-4 py-2 text-[11.5px] text-error">{error}</div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 px-4 py-3">
          {annotationCount > 0 && (
            <span className="text-[10.5px] text-ink/50">
              {annotationCount} annotated section{annotationCount === 1 ? '' : 's'} — sent with Refine
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {PLAN_REVIEW_CHOICES.map((choice) => {
              const isRefine = choice === 'Refine plan';
              return (
                <button
                  key={choice}
                  type="button"
                  disabled={deciding}
                  onClick={() => onDecide(choice, isRefine ? feedback : '')}
                  className={`rounded px-3 py-1.5 text-[11.5px] transition-colors disabled:opacity-50 ${
                    choice === 'Approve and execute'
                      ? 'bg-ink text-canvas hover:bg-ink/80'
                      : 'border border-ink/20 text-ink hover:bg-ink/5'
                  }`}
                >
                  {choice}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
