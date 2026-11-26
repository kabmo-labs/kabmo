import type { ChatMessageData } from '@/shared/types';
import type { SubagentHistoryEntry } from '@kabmo-labs/kabmo-omp-contracts/subagent';
import { SAMPLE_SCOUT_SUBAGENT_ID, rawScoutSubagentEvents } from '@/client/data/samples/sample-subagents/scout-raw';
import { SAMPLE_SLEEPER_SUBAGENT_ID, rawSleeperSubagentEvents } from '@/client/data/samples/sample-subagents/sleeper-raw';

export {
  SAMPLE_SCOUT_SUBAGENT_ID,
  rawScoutSubagentEvents,
  SAMPLE_SLEEPER_SUBAGENT_ID,
  rawSleeperSubagentEvents,
};

export const SAMPLE_SUBAGENT_SESSION_ID = '01a08ecc-1c26-70a2-9f74-8199f14f131a';

export const scoutSubagentHistoryEntry: SubagentHistoryEntry = {
  id: SAMPLE_SCOUT_SUBAGENT_ID,
  agent: 'scout',
  agentSource: 'bundled',
  status: 'completed',
  task: 'Count .tsx files under src/ of /Users/rajebdev/JatisMobile/bofis-pro (recursive)',
  assignment: 'Count .tsx files under src/ (recursive)',
  description: 'Count .tsx files under src/ (recursive)',
  index: 0,
  durationMs: 8700,
  cost: 0.0041,
  transcriptAvailable: true,
};

export const sleeperSubagentHistoryEntry: SubagentHistoryEntry = {
  id: SAMPLE_SLEEPER_SUBAGENT_ID,
  agent: 'scout',
  agentSource: 'bundled',
  status: 'completed',
  task: 'Complete assignment: Bash `sleep 45 && echo done`',
  assignment: 'Run `sleep 45 && echo done` and report stdout verbatim',
  description: 'Supervised bash process execution',
  index: 1,
  durationMs: 45000,
  cost: 0.0050,
  transcriptAvailable: true,
};

export const sampleSubagentUserPrompt = `Hitung semua file .tsx di dalam folder src/ secara rekursif menggunakan subagent scout.`;

export function getSampleSubagentSession(): { id: string; title: string; messages: ChatMessageData[] } {
  const date = 'Sep 11, 11:48 AM';

  const messages: ChatMessageData[] = [
    {
      id: 'msg-subagent-parent-1',
      role: 'user',
      date,
      content: sampleSubagentUserPrompt,
    },
    {
      id: 'msg-subagent-parent-2',
      role: 'ai',
      date,
      thinking: {
        duration: '1.8s',
        summary: 'Spawn scout subagent to recursively scan and count .tsx files under src/.',
        thought: `1. User requests a recursive count of .tsx files under src/.
2. Delegate to 'scout' subagent with read-only tools: glob, grep, read, yield.
3. Subagent will scan the workspace with 'src/**/*.tsx', analyze directory distribution, and yield structured result.
4. Render task delegation card and subagent inspection transcript.`,
      },
      toolCalls: [
        {
          id: 'call_subagent_task_1',
          type: 'task',
          name: 'task',
          title: 'task — spawn scout subagent',
          intent: 'Count .tsx files under src/ (recursive)',
          target: 'scout',
          input: {
            agent: 'scout',
            task: 'Complete assignment thoroughly:\n\n# Target\nCount .tsx files under src/ of /Users/rajebdev/JatisMobile/bofis-pro (recursive).\n\n# Change\nNone — read-only. Use glob for src/**/*.tsx.\n\n# Acceptance\nReport the integer count and the command/pattern used as evidence. No other commentary.',
          },
          status: 'success',
          output: `Subagent scout [${SAMPLE_SCOUT_SUBAGENT_ID}] completed successfully.\n\nResult:\n25 — pattern \`src/**/*.tsx\` via glob (recursive).\n\nDetails:\nSummary: 25 .tsx files under src/ (recursive).\nArchitecture: Counted via glob pattern \`src/**/*.tsx\` returning 25 matches.`,
        },
      ],
      content: `Subagent **scout** telah selesai memproses target. Ditemukan total **25 file .tsx** di dalam direktori \`src/\`:

- **Pattern Glob**: \`src/**/*.tsx\`
- **Total File**: 25 file \`.tsx\`
- **Status Subagent**: Selesai (*done*) via \`yield\`
- **Model**: \`deepseek/deepseek-v4-pro\` (thinking level: *low*)

Anda dapat mengklik subagent **scout** pada daftar subagent di sidebar kiri atau menekan card tugas untuk memeriksa log transkrip interaktif lengkap.`,
    },
  ];

  return {
    id: SAMPLE_SUBAGENT_SESSION_ID,
    title: 'Cek stream subagent di ompweb',
    messages,
  };
}
