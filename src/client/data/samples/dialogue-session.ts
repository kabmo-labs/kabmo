import type { ChatMessageData } from '@/shared/types';

export const SAMPLE_DIALOGUE_SESSION_ID = '02b195b0-f245-85b7-c6c7-61c1c7927d6a';

export function getSampleDialogueSession(): {
  id: string;
  title: string;
  messages: ChatMessageData[];
} {
  return {
    id: SAMPLE_DIALOGUE_SESSION_ID,
    title: 'Deployment & Repo Summarizer (OMP Dialogue Sample)',
    messages: [
      {
        id: '86458b47',
        role: 'user',
        content: 'List the files in the current directory using a tool call, then tell me what you found. Keep it brief.',
        date: 'Sep 9, 04:33 AM',
        attachments: [],
      },
      {
        id: '696dea39',
        role: 'ai',
        content: '',
        date: 'Sep 9, 04:33 AM',
        intent: 'Listing current directory entries',
        toolCalls: [
          {
            id: 'call_00_ET_dq1dHTxC1nKS6G9KnNhj7084',
            type: 'read_file',
            name: 'read',
            title: 'read — .',
            target: '.',
            input: { path: '.' },
            status: 'success',
            output:
              '.\n  - workspace.db                            112.0KB   2m ago\n  - notes/\n    - plan-render-tool-calling.md           14.2KB    36m ago\n    - tool-calling-ask-omp-ompweb.md        13.6KB    46m ago\n  - package.json                            1.5KB     22h ago\n  - AGENTS.md                               8.5KB     23h ago\n  - app/\n    - tailwind.css                          9.2KB     2h ago\n    - hooks/\n    - db.server.ts                          11.4KB    3h ago\n    - components/\n  - public/\n  - metadata.json                           244B      2d ago',
          },
        ],
      },
      {
        id: '1a6cb095',
        role: 'ai',
        content:
          'Elysia + Bun app (Kabmo). Top-level contents:\n\n- **App source** — `src/` (client, server, shared)\n- **Config** — `package.json`, `tsconfig.json`, `bunfig.toml`, `bun.lock`, `AGENTS.md`, `DESIGN.md`\n- **Static/PWA** — `public/` (icons, manifest, service worker)\n- **DB** — `workspace.db` (112 KB)\n- **Misc** — `notes/` (2 planning docs)\n\nRoot has no stray source files; project is cleanly under `src/`.',
        date: 'Sep 9, 04:33 AM',
        thinking: {
          thought: 'Brief listing.',
          isGenerating: false,
        },
      },
      {
        id: '9bc79eff',
        role: 'user',
        content:
          'I need to choose a deployment strategy for this project. Ask me which approach you should use: Docker Compose, Kubernetes, or Vercel. Wait for my answer before doing anything else.',
        date: 'Sep 9, 04:34 AM',
        attachments: [],
      },
      {
        id: 'b4f3a1b1',
        role: 'ai',
        content: '',
        date: 'Sep 9, 04:34 AM',
        thinking: {
          thought:
            'The user wants me to ask which deployment strategy to use: Docker Compose, Kubernetes, or Vercel. I should use the ask tool with those options.',
          isGenerating: false,
        },
        intent: 'Asking which deployment approach to use',
        toolCalls: [
          {
            id: 'call_00_Sgk0kGtQs62HegmTP1zA0168',
            type: 'custom',
            name: 'ask',
            title: 'ask — Deployment Strategy',
            input: {
              questions: [
                {
                  id: 'deploy_strategy',
                  question: 'Which deployment strategy should I use for this project?',
                  header: 'Deployment',
                  multi: false,
                  recommended: 0,
                  options: [
                    {
                      label: 'Docker Compose',
                      description:
                        'Single-host container orchestration; good for self-managed VPS with SQLite persistence and long-running edge/runtime processes.',
                    },
                    {
                      label: 'Kubernetes',
                      description:
                        'Cluster orchestration for multi-node scale, rolling deploys, and resilience; heavier operational overhead.',
                    },
                    {
                      label: 'Vercel',
                      description:
                        'Serverless edge platform; simplest for web-first deployment but complicates SQLite state and background bun processes.',
                    },
                  ],
                },
              ],
            },
            status: 'success',
            output: 'Ask input was cancelled',
          },
        ],
      },
      {
        id: '492db420',
        role: 'ai',
        content: '',
        date: 'Sep 9, 04:36 AM',
        error: {
          id: 67112960,
          message: 'Interrupted by user',
          stopReason: 'aborted',
        },
      },
      {
        id: 'bd7df642',
        role: 'user',
        content: 'Ask me a simple question using the ask tool: which color do you prefer, Red or Blue? Wait for my answer.',
        date: 'Sep 9, 04:36 AM',
        attachments: [],
      },
      {
        id: '630646bf',
        role: 'ai',
        content: '',
        date: 'Sep 9, 04:42 AM',
        intent: 'Asking preferred color',
        toolCalls: [
          {
            id: 'call_00_ET_V6S6ndf0jUfWhIWNiW5L8913',
            type: 'custom',
            name: 'ask',
            title: 'ask — Color Choice',
            input: {
              questions: [
                {
                  header: 'Color',
                  id: 'pref_color',
                  multi: false,
                  options: [
                    { description: 'Warm, high-energy tone.', label: 'Red' },
                    { description: 'Cool, calm tone.', label: 'Blue' },
                  ],
                  question: 'Which color do you prefer?',
                  recommended: 0,
                },
              ],
            },
            status: 'success',
            output: 'User selected: Blue',
          },
        ],
      },
      {
        id: 'ec8d377c',
        role: 'ai',
        content: 'Blue it is.',
        date: 'Sep 9, 04:42 AM',
      },
      {
        id: 'c790cc08',
        role: 'user',
        content:
          'Run a bash command to check the git status, then use the edit tool to make a trivial change to examples/new_file.js (add a comment), then spawn a task subagent to summarize the repo. Do all three.',
        date: 'Sep 9, 04:43 AM',
        attachments: [],
      },
      {
        id: '57793175',
        role: 'ai',
        content: '',
        date: 'Sep 9, 04:43 AM',
        thinking: {
          thought:
            'Three steps: 1. Run bash git status. 2. Read new_file.js before editing. 3. Spawn task subagent to summarize repo.',
          isGenerating: false,
        },
        intent: 'Checking git status & spawning task agent',
        toolCalls: [
          {
            id: 'call_00_ZWxM8mNOYoriCHgEbkq04095',
            type: 'bash',
            name: 'bash',
            title: 'bash — git status',
            command: 'git status',
            input: { command: 'git status' },
            status: 'success',
            output:
              'On branch main\nYour branch is ahead of origin/main by 7 commits.\nChanges not staged for commit:\n\tmodified:   app/components/workspace/ChatTimeline.tsx\n\tmodified:   app/hooks/useChatTimeline.ts\nUntracked files:\n\tnotes/',
          },
          {
            id: 'call_01_CdS5HH475VZVfh1Fzy7m8061',
            type: 'read_file',
            name: 'read',
            title: 'read — examples/new_file.js',
            target: 'examples/new_file.js',
            input: { path: 'examples/new_file.js' },
            status: 'success',
            output: "console.log('New file');",
          },
          {
            id: 'call_02_inzTpsVADRKizgEwXw1g8184',
            type: 'custom',
            name: 'task',
            title: 'task — RepoSummarizer',
            input: {
              context:
                '# Goal\nProduce a concise summary of the Kabmo repository for the user.\n\n# Constraints\nRead-only investigation. Skip formatters and linters.',
              tasks: [
                {
                  name: 'RepoSummarizer',
                  agent: 'scout',
                  task: '# Target\nSummarize repository purpose, tech stack, and structure at /Users/rajebdev/JatisMobile/ompchamber.',
                },
              ],
            },
            status: 'success',
            output:
              'Spawned agent `RepoSummarizer` (job `RepoSummarizer`). Subagent yielded successfully.',
          },
        ],
      },
      {
        id: 'ea496c64',
        role: 'ai',
        content: '',
        date: 'Sep 9, 04:43 AM',
        intent: 'Adding comment to examples/new_file.js',
        toolCalls: [
          {
            id: 'call_00_GqzW4abxWgc8fnyek8rW7530',
            type: 'edit_file',
            name: 'edit',
            title: 'edit — examples/new_file.js',
            target: 'examples/new_file.js',
            input: {
              path: 'examples/new_file.js',
              old_string: "console.log('New file');",
              new_string: "// Example file — logs a greeting\nconsole.log('New file');",
            },
            status: 'success',
            output:
              "[examples/new_file.js]\n1:// Example file — logs a greeting\n2:console.log('New file');",
          },
        ],
      },
      {
        id: 'a75c7e8a',
        role: 'ai',
        content:
          'All three done:\n\n1. **Git status** — on `main`, 7 commits ahead of `origin/main`.\n2. **Edit** — added a comment to `examples/new_file.js`.\n3. **Task subagent** — spawned `RepoSummarizer` (scout); its summary will auto-deliver when it settles.',
        date: 'Sep 9, 04:43 AM',
      },
      {
        id: '4bfcb3bb',
        role: 'ai',
        content: '',
        notice:
          'Background job RepoSummarizer has completed. Resume your work using the result below.\n<task-result id="RepoSummarizer" agent="scout" status="completed" duration="55.2s">\nRepo summary ready.\n</task-result>',
        date: 'Sep 9, 04:44 AM',
      },
      {
        id: '0eb26c5d',
        role: 'ai',
        content: '',
        notice:
          '<system-reminder>\n`ast_edit` result above: PREVIEW — no files changed. Finalize now with `write`: write a one-sentence plain-text reason to `xd://resolve` to APPLY, or `xd://reject` to DISCARD.\n</system-reminder>',
        date: 'Sep 9, 04:44 AM',
      },
      {
        id: '65e71033',
        role: 'ai',
        content:
          'Repo summary from `RepoSummarizer`:\n\n**Kabmo** — developer web-view console and diagnostic chamber for AI **Oh-My-Pi** autonomous agent.\n\n**Stack:** Remix v2 + React 19 + Vite, Tailwind CSS v4, TypeScript (strict, ES2022). Runs under npm or Bun.\n\n**Structure:**\n- `app/routes/` — Remix flat-routes, large REST-style `api/` domain tree\n- `app/components/` — common, layout, workspace, mobile, settings\n- `app/hooks/` — chat, terminal, git-tree, agent streaming\n- `app/lib/omp/` — bridges to oh-my-pi runtime (RPC managers, session readers)\n- `app/types/`, `app/data/` (mock presets)\n\n**Config:** `MOCK` mode toggles seeded demo data vs real data. SQLite persistence (`app/db.server.ts`).\n\n**Deployment-relevant:** PWA support, xterm/KaTeX/Shiki rendering.',
        date: 'Sep 9, 04:44 AM',
      },
    ],
  };
}
