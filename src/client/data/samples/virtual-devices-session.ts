import type { ChatMessageData } from '@/shared/types';
import { internalUrlCalls } from '@/client/data/samples/virtual-devices-internal-url';

export const SAMPLE_DEVICES_SESSION_ID = '03c286c1-e356-96c8-d7d8-72d2d8938e7b';

export function getSampleDevicesSession(): {
  id: string;
  title: string;
  messages: ChatMessageData[];
} {
  const date = 'Sep 10, 04:15 PM';

  const messages: ChatMessageData[] = [
    {
      id: 'msg-dev-1',
      role: 'user',
      date,
      content: 'Check the language server capabilities and run diagnostics across the project to identify any syntax or type warnings.',
    },
    {
      id: 'msg-dev-2',
      role: 'ai',
      date,
      thinking: {
        duration: '1.9s',
        summary: 'Query active language server capabilities and run diagnostic scan via virtual device.',
        thought: `1. Query active language server capabilities using virtual device xd://lsp with action: "capabilities".
2. Run diagnostic scan on app/components/Header.tsx to surface errors, warnings, and hints.
3. Present findings clearly.`,
      },
      toolCalls: [
        {
          id: 'call_dev_lsp_cap',
          type: 'custom',
          name: 'lsp',
          title: 'lsp — Server Capabilities',
          target: 'xd://lsp',
          input: { action: 'capabilities' },
          status: 'success',
          duration: '42ms',
          details: {
            xdev: {
              tool: 'lsp',
              args: { action: 'capabilities' },
            },
          },
          output: `typescript-language-server:
  capabilities: {"textDocumentSync":1,"completionProvider":true,"hoverProvider":true,"definitionProvider":true,"referencesProvider":true,"documentFormattingProvider":true,"codeActionProvider":true}
tailwindcss-language-server:
  capabilities: {"textDocumentSync":1,"completionProvider":true,"hoverProvider":true,"colorProvider":true}`,
        },
        {
          id: 'call_dev_lsp_diag',
          type: 'custom',
          name: 'lsp',
          title: 'lsp — Diagnostics Scan',
          target: 'xd://lsp',
          input: { action: 'diagnostics', file: 'app/components/Header.tsx' },
          status: 'success',
          duration: '65ms',
          details: {
            xdev: {
              tool: 'lsp',
              args: { action: 'diagnostics', file: 'app/components/Header.tsx' },
            },
          },
          output: `# app/components/
## Header.tsx
  18:7 [error] [typescript] Type 'string | undefined' is not assignable to type 'string'. (2322)
  45:10 [warning] [typescript] 'deprecatedProp' is deprecated. (6385)
  165:10 [hint] [typescript] 'isSyncing' is declared but its value is never read. (6133)`,
        },
      ],
      content: `I queried the active language servers and scanned \`app/components/Header.tsx\`:

- **Active Servers**: \`typescript-language-server\` and \`tailwindcss-language-server\` are connected with full document sync, code action, and hover capabilities.
- **Diagnostics**: Found 1 type error, 1 deprecation warning, and 1 unused variable hint (\`isSyncing\`) on line 165.`,
    },
    {
      id: 'msg-dev-3',
      role: 'user',
      date,
      content: 'Can you search for usages of isSyncing and look up modern React state synchronization patterns?',
    },
    {
      id: 'msg-dev-4',
      role: 'ai',
      date,
      thinking: {
        duration: '2.4s',
        summary: 'Search usages with ripgrep and retrieve documentation via DuckDuckGo web search.',
        thought: `1. Search for isSyncing occurrences across source files.
2. Search web for modern React state synchronization patterns using web_search.
3. Prepare refactoring proposal.`,
      },
      toolCalls: [
        {
          id: 'call_dev_search',
          type: 'grep',
          name: 'grep',
          title: 'grep — isSyncing',
          target: 'isSyncing',
          input: { query: 'isSyncing', path: 'app/' },
          status: 'success',
          duration: '38ms',
          output: `[20 results limit reached. Showing first 3 matches]
app/components/Header.tsx
  18│const Header = ({ isSyncing, title }: HeaderProps) => {
  45│  // TODO: remove isSyncing
app/hooks/useSync.ts
  12│export const useSync = () => { const [isSyncing] = useState(false); return { isSyncing }; };`,
        },
        {
          id: 'call_dev_web_search',
          type: 'web_search',
          name: 'web_search',
          title: 'web_search — react 19 sync patterns',
          target: 'react 19 state synchronization patterns',
          input: { query: 'react 19 state synchronization patterns' },
          status: 'success',
          duration: '420ms',
          details: {
            sources: [
              {
                title: 'React 19 Action and Transition State Patterns',
                url: 'https://react.dev/blog/2024/04/25/react-19',
                snippet: 'Exploring useActionState and optimistic state updates without manual isSyncing flags.',
                date: '2024-04-25',
                provider: 'duckduckgo',
              },
              {
                title: 'Clean Refactoring of Unused Variables in TypeScript',
                url: 'https://typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
                snippet: 'Leveraging AST transformation to eliminate dead state variables safely.',
                date: '2024-03-16',
                provider: 'duckduckgo',
              },
            ],
          },
          output: 'Found 2 authoritative sources on React 19 state sync patterns and AST elimination.',
        },
      ],
      content: `The variable \`isSyncing\` is only referenced in \`Header.tsx\` and \`useSync.ts\`. Modern React 19 practices recommend replacing ad-hoc boolean flags with optimistic actions or cleaner prop signatures.`,
    },
    {
      id: 'msg-dev-5',
      role: 'user',
      date,
      content: 'Stage an AST transformation to remove isSyncing, run a background vulnerability audit, and apply the change.',
    },
    {
      id: 'msg-dev-6',
      role: 'ai',
      date,
      thinking: {
        duration: '3.1s',
        summary: 'Stage AST edit, run background worker audit via hub, resolve proposal, and prompt user.',
        thought: `1. Stage AST edit via virtual device xd://ast_edit.
2. Dispatch background audit tasks via hub worker queue.
3. Apply proposal resolution via xd://resolve.
4. Mark trailing commit tool as skipped waiting for user review.`,
      },
      toolCalls: [
        {
          id: 'call_dev_ast_edit',
          type: 'custom',
          name: 'ast_edit',
          title: 'ast_edit — app/components/Header.tsx',
          target: 'xd://ast_edit',
          input: {
            paths: ['app/components/Header.tsx'],
            ops: [
              {
                pat: 'const Header = ({ isSyncing, title }: HeaderProps)',
                out: 'const Header = ({ title }: HeaderProps)',
              },
            ],
          },
          status: 'success',
          duration: '88ms',
          details: {
            xdev: {
              tool: 'ast_edit',
              args: {
                paths: ['app/components/Header.tsx'],
                ops: [
                  {
                    pat: 'const Header = ({ isSyncing, title }: HeaderProps)',
                    out: 'const Header = ({ title }: HeaderProps)',
                  },
                ],
              },
              inner: {
                applied: false,
                scopePath: 'app/components/Header.tsx',
                displayContent: `--- a/app/components/Header.tsx
+++ b/app/components/Header.tsx
@@ -18,1 +18,1 @@
-const Header = ({ isSyncing, title }: HeaderProps) => {
+const Header = ({ title }: HeaderProps) => {`,
              },
            },
          },
          output: 'Staged as a proposal in memory for app/components/Header.tsx. Files not modified yet.',
        },
        {
          id: 'call_dev_hub',
          type: 'hub',
          name: 'hub',
          title: 'hub — Worker Orchestrator',
          target: 'hub',
          input: { op: 'wait', timeout: 5000 },
          status: 'success',
          duration: '110ms',
          details: {
            op: 'wait',
            jobs: [
              {
                id: 'job-sec-audit',
                type: 'subagent',
                label: 'Security & Dependency Vulnerability Audit',
                durationMs: 3450,
                resolvedModel: 'gemini-2.5-flash',
                status: 'completed',
              },
              {
                id: 'job-typecheck',
                type: 'verifier',
                label: 'Deep Typecheck & Regression Suite',
                durationMs: 1820,
                resolvedModel: 'claude-3-5-sonnet',
                status: 'running',
                completionPercent: 55,
                requests: 90,
                cost: 18.4,
                contextTokens: 163_840,
                contextWindow: 1_048_576,
                stage: 'implementing',
              },
            ],
          },
          output: 'Wait limit reached; 1 of 2 background jobs still running — read proc:// for status.',
        },
        ...internalUrlCalls,
        {
          id: 'call_dev_resolve',
          type: 'custom',
          name: 'resolve',
          title: 'resolve — Apply AST Proposal',
          target: 'xd://resolve',
          input: { target: 'xd://resolve', proposalId: 'prop_ast_901', action: 'apply' },
          status: 'success',
          duration: '52ms',
          details: {
            xdev: {
              tool: 'resolve',
              args: { action: 'apply', target: 'app/components/Header.tsx' },
            },
            resolved: true,
            applied: true,
            file: 'app/components/Header.tsx',
            reason: 'Applied AST proposal: Removed unused isSyncing parameter from HeaderProps',
          },
          output: 'Successfully applied AST proposal to app/components/Header.tsx.',
        },
        {
          id: 'call_dev_commit_skip',
          type: 'bash',
          name: 'bash',
          title: 'bash — git commit staged changes',
          target: 'git commit -m "refactor: drop unused isSyncing"',
          command: 'git commit -m "refactor: drop unused isSyncing"',
          status: 'skipped',
          synthetic: true,
          details: {
            __synthetic: true,
            source: 'assistant_stop_skipped',
            executed: false,
            reason: 'Assistant stopped before tool execution; waiting for confirmation.',
          },
          output: '',
        },
      ],
      content: `The AST proposal has been successfully resolved and applied to \`app/components/Header.tsx\`. The background security and typecheck worker tasks completed with zero regressions.`,
    },
    {
      id: 'msg-dev-7',
      role: 'user',
      date,
      content: 'What should we do next?',
    },
    {
      id: 'msg-dev-8',
      role: 'ai',
      date,
      thinking: {
        duration: '1.2s',
        summary: 'Prompt user with choices for next step.',
        thought: 'Ask user whether to proceed with integration tests or create git commit.',
      },
      toolCalls: [
        {
          id: 'call_dev_ask',
          type: 'custom',
          name: 'ask',
          title: 'ask — Next Action',
          input: {
            questions: [
              {
                id: 'next_step',
                question: 'The AST refactoring is applied. Which step would you like to take next?',
                header: 'Next Step',
                multi: false,
                recommended: 0,
                options: [
                  {
                    label: 'Run integration test suite',
                    description: 'Run full bun test suite to ensure end-to-end component stability.',
                  },
                  {
                    label: 'Commit and push changes',
                    description: 'Create a clean git commit for the Header.tsx refactoring.',
                  },
                ],
              },
            ],
          },
          status: 'success',
          duration: '3200ms',
          output: 'User selected: Run integration test suite',
        },
      ],
      content: 'Understood! I am ready to run the integration test suite whenever you give the command.',
    },
  ];

  return {
    id: SAMPLE_DEVICES_SESSION_ID,
    title: 'Virtual Devices & Diagnostics (Oh-My-Pi Sample)',
    messages,
  };
}
