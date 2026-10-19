/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a goal notice out of the text omp and Kabmo's own extension
 * inject into the transcript.
 *
 * Goal mode writes three kinds of `custom_message`, all of them `display:false`
 * and none of them a tool call — so the timeline's only path for them is a
 * `notice` row, which renders as a generic "System Notice" card whose subtitle
 * is the first line. That first line is an HTML comment
 * (`<!-- Hidden continuation steer … -->`) on a continuation turn, and the body
 * underneath is the whole internal prompt — a wall of instructions with the
 * objective buried in it. This parser turns those two shapes into fields a
 * dedicated card can lay out, and says which kind it saw so the card can name
 * it.
 *
 * The third kind, `goal-start`, carries the bare objective and nothing else:
 * no text can tell it apart from any other one-line notice, which is why the
 * caller passes the source `customType` (`noticeSource`).
 */

export type GoalNoticeKind = 'start' | 'continuation' | 'context';

export interface GoalNoticeData {
  kind: GoalNoticeKind;
  objective: string;
  tokensUsed?: number;
  tokenBudget?: number;
  /** omp's own wording for what is left (`unbounded`, or a count). */
  remaining?: string;
  timeUsedSeconds?: number;
  /**
   * Everything that is not the objective or the budget: the rules omp attaches
   * to the injection (the `goal` tool's ops, the audit-before-complete
   * requirement). Kept as markdown, shown under its own heading so it reads as
   * reference rather than as the message the user is being sent.
   */
  instructions: string;
}

const SOURCE_KIND: Record<string, GoalNoticeKind> = {
  'goal-start': 'start',
  'goal-continuation': 'continuation',
  'goal-mode-context': 'context',
};

/** `- Tokens used: 1431`, `- Token budget: none`, `- Time used: 14 seconds`. */
const BUDGET_LINE = /^-\s*(Tokens used|Token budget|Tokens remaining|Time used)\s*:\s*(.+?)\s*$/i;

function goalNoticeKind(notice: string, source: string | undefined): GoalNoticeKind | null {
  const fromSource = source ? SOURCE_KIND[source] : undefined;
  if (fromSource) return fromSource;
  // Rows written before `noticeSource` existed (Kabmo's own overlay keeps
  // notice rows, so a session saved by an older build still shows them). The
  // two multi-line kinds name themselves in their text; a bare objective cannot
  // and stays a generic notice.
  if (/<goal_context>/i.test(notice)) return 'context';
  if (/Hidden continuation steer/i.test(notice)) return 'continuation';
  return null;
}

function withoutComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** The `<objective>…</objective>` block omp wraps the goal in. */
function objectiveBlock(text: string): string | null {
  const match = /<objective>([\s\S]*?)<\/objective>/i.exec(text);
  return match ? match[1].trim() : null;
}

function count(value: string): number | undefined {
  const match = /(\d[\d,_]*)/.exec(value);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1].replace(/[,_]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseGoalNotice(notice: string, source?: string): GoalNoticeData | null {
  const kind = goalNoticeKind(notice, source);
  if (!kind) return null;

  // The opening turn carries the objective and nothing else — no budget, no
  // rules. Splitting its lines into "instructions" would just repeat it.
  if (kind === 'start') {
    return { kind, objective: withoutComments(notice).trim(), instructions: '' };
  }

  let tokensUsed: number | undefined;
  let tokenBudget: number | undefined;
  let remaining: string | undefined;
  let timeUsedSeconds: number | undefined;
  const rest: string[] = [];
  let inBudget = false;

  for (const rawLine of notice.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^Budget:?$/i.test(line)) {
      inBudget = true;
      continue;
    }
    const budget = inBudget ? BUDGET_LINE.exec(line) : null;
    if (budget) {
      const field = budget[1].toLowerCase();
      const value = budget[2];
      if (field === 'tokens used') tokensUsed = count(value);
      else if (field === 'token budget') tokenBudget = count(value);
      else if (field === 'tokens remaining') remaining = value;
      else timeUsedSeconds = count(value);
      continue;
    }
    rest.push(rawLine);
  }

  const objective = objectiveBlock(notice) ?? '';
  const instructions = withoutComments(rest.join('\n'))
    .replace(/<objective>[\s\S]*?<\/objective>/gi, '')
    .replace(/<\/?goal_context>/gi, '')
    // omp's own lead-in to the block; the card's own badge says the same thing.
    .replace(/^\s*Goal mode active\. Objective below:[^\n]*$/im, '')
    .trim();

  return {
    kind,
    objective,
    tokensUsed,
    tokenBudget,
    remaining,
    timeUsedSeconds,
    instructions,
  };
}
