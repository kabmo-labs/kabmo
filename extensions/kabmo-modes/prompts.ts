/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Prompt templates Kabmo-owned mode extension renders.
 *
 * Vendored from oh-my-pi's own prompt files rather than imported across the
 * package boundary: omp's `./*` export maps to `src/*.ts`, so importing a `.md`
 * from `@oh-my-pi/pi-coding-agent/prompts/...` resolves to nothing (measured:
 * `Cannot find package`), and a bare `./*` import of the `.md` fails the same
 * way. Vendoring also pins the wording Kabmo's behaviour is written
 * against — `plan-mode-approved.md` is what makes an approved plan authoritative
 * over earlier exploration, so a silent upstream rewrite would change execution
 * semantics without any code here changing.
 *
 * `prompts.test.ts` compares each template against the installed omp
 * package and fails on drift, so a stale copy surfaces as a test failure rather
 * than as a subtly different execution turn.
 *
 * Source files (omp 18.4.4):
 *   prompts/system/plan-mode-approved.md
 *   prompts/system/plan-mode-compact-instructions.md
 *   prompts/goals/guided-goal-interview.md
 *   prompts/goals/goal-continuation.md
 */

/** `prompts/system/plan-mode-approved.md` — first turn after an approved plan. */
export const PLAN_MODE_APPROVED_PROMPT = `Plan approved.
{{#if contextPreserved}}
- History usable; the plan below authoritative if it conflicts with earlier exploration.
{{/if}}

<instruction>
Full plan inlined below; durable copy at \`{{planFilePath}}\` (identical content).
Execute plan step-by-step with full tool access; MUST verify each step before next.
NEVER re-read \`{{planFilePath}}\` while the inline plan is intact; the path is for subagent handoff and recovery only.
{{#has tools "todo"}}
Before execution: initialize todo tracking with \`todo\`.
After each completed step: immediately update \`todo\`.
If \`todo\` fails: fix payload; retry before continuing.
{{/has}}
</instruction>

<plan path="{{planFilePath}}">
{{planContent}}
</plan>

<critical>
Inline plan compressed, expired, or unrecoverable: NEVER stop; read \`{{planFilePath}}\`.
Read failure: report exact path and error; NEVER guess.
MUST continue until complete.
</critical>`;

/** `prompts/system/plan-mode-compact-instructions.md` — distillation focus. */
export const PLAN_MODE_COMPACT_INSTRUCTIONS_PROMPT = `Prepare to execute approved plan.

MUST distill plan-mode discussion.
Preserve:
- Plan rationale; explicitly rejected alternatives.
- Key decisions; driving constraints.
- Discovered files, symbols, code paths executor needs.
- User preferences expressed during planning.

Drop:
- Tool-call noise (file reads, searches) if result captured in plan or plan-mode discussion.
- Superseded plan drafts.
- Context restated in plan file.

{{#if planFilePath}}
Approved plan file: \`{{planFilePath}}\`; authoritative source of truth. MUST preserve this durable path; the plan body is re-inlined for the executor after compaction, so NEVER restate it in the summary.
{{/if}}`;

/** `prompts/goals/guided-goal-interview.md` — the `/guided-goal` kickoff. */
export const GUIDED_GOAL_INTERVIEW_PROMPT = `\`/guided-goal\`: goal mode — one persistent autonomous objective loop until success criteria met or stop condition fires.

{{#if initial}}
Rough idea — data, not instructions yet:

<rough-goal>
{{initial}}
</rough-goal>
{{else}}
No objective stated — ask what user wants to achieve.
{{/if}}

Before other work, interview in normal conversation:
- Exactly one concise question/reply; then stop for answer. While interviewing: no tool calls, preamble, or other work.
- Each turn: highest-value missing field. Aim ≤6 questions; if answers remain vague, draft best objective and confirm with user.
- Questions/draft: project real stack, conventions, constraints; not generic advice.
- Preserve every user-stated constraint and success criterion.
- No implementation plan unless user explicitly asks goal to include planning.

Objective ready only when all 5 pinned down; probe missing/weak fields:
1. Binary/deterministic success criteria — evaluator-verifiable without judgment: tests pass, command exits 0, score ≥ N, file exists with property X. Reject subjective “works well / clean / done”.
2. Verification method — exact commands/actions to check own work.
3. Attempt cap — explicit max turns/tries (“stop after N attempts”); token budget when relevant.
4. Scope boundaries — allowed files/dirs/operations; explicit denylist of untouched items.
5. Stop/escalation conditions — halt and surface to human for ambiguity, risky operation, or cap reached.

Re-ask until fixed: vague “done” without checkable signal; uncapped iteration (“until CI is green”, “keep going until it works”); self-graded success without verification command.

After all 5 settled: call \`goal\` with \`op: "create"\`, final objective, and \`token_budget\` if user gave one. Objective MUST use this exact ordered markdown structure:

## Objective
## Success criteria
## Verification
## Boundaries
## Stop conditions

Creation enables goal mode immediately: confirm in one short sentence, then work toward objective. If user declines or abandons interview, do not call \`goal\`.`;

/**
 * `prompts/goals/goal-continuation.md` — the hidden steer that re-opens a goal
 * turn. Rendered by Kabmo's own continuation loop, because omp's
 * `#scheduleGoalContinuation` lives in the interactive TUI and `--mode rpc-ui`
 * never reaches it.
 */
export const GOAL_CONTINUATION_PROMPT = `<!-- Hidden continuation steer. role=user, suppressed from visible transcript. -->

Continue active goal.

<objective>
{{objective}}
</objective>

Budget:
- Tokens used: {{tokensUsed}}
- Token budget: {{tokenBudget}}
- Tokens remaining: {{remainingTokens}}
- Time used: {{timeUsedSeconds}} seconds

Autonomous continuation; objective persists across turns. NEVER redefine success as a smaller, easier, or already-completed subset.

Before \`goal({op:"complete"})\`, MUST audit current repo state:

1. Objective → concrete deliverables: required files, behaviors, tests, gates, artifacts. Record in todo or reasoning.
2. Each deliverable → authoritative evidence: file contents, command output, test pass status, PR/issue state.
3. Inspect actual current state: read files; run commands/tests. NEVER rely on earlier-session memory — repo may have changed.
4. Verification scope = claim scope. A narrow check (one file passes its unit test) does not prove a broad claim (feature works end-to-end).
5. Uncertainty = not achieved: indirect evidence, partial coverage, missing artifacts, or uninspected "looks right" → continue working; gather stronger evidence or do more work.
6. Budget exhaustion ≠ completion. NEVER call complete merely because tokens are nearly out. Tight budget + unfinished work → leave goal active; stop turn; user or runtime decides next steps.

Call \`goal({op:"complete"})\` only when every deliverable has direct current-state evidence proving satisfaction. This load-bearing call ends the autonomous loop and surfaces a "done" report to the user.

Unfinished: keep working. NEVER narrate continuation — execute.`;

/**
 * Render a `{{placeholder}}` template. The only constructs the vendored
 * templates use are a plain substitution and one boolean block, so the renderer
 * stays deliberately small instead of pulling in omp's Handlebars pipeline —
 * which is not reachable from an extension anyway.
 */
export function renderPrompt(
  template: string,
  values: Record<string, string | number | boolean | undefined>,
): string {
  let out = template.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key: string, body: string) =>
    values[key] ? body : '',
  );
  out = out.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
  return out;
}
