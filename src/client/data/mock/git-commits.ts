import type { GitCommit } from '@kabmo-labs/kabmo-app-contracts/git';

export const SAMPLE_GIT_COMMITS: GitCommit[] = [
  {
    hash: '8f8ca583e7162b190f898394e1e3ad81472a1290',
    shortHash: '8f8ca583',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 12:40 PM',
    message: 'feat(chat): persist composer draft and attachments per session',
    body: `inputValue and inputAttachments are now session-scoped so each session keeps its own pending draft; send-success clearing and steer-failure restore flow through the persisted setter unchanged.

Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)

Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>`,
    parents: ['6d3bac50'],
    refs: ['HEAD -> main', 'origin/main'],
    lane: 0,
    files: [
      {
        file: 'app/hooks/chat/timeline/index.ts',
        status: 'M',
        additions: 3,
        deletions: 2,
        diff: `@@ -7,6 +7,7 @@
 import { useChatTimelineActions } from '@/client/hooks/chat/timeline/actions';
 import { useChatTimelineSend } from '@/client/hooks/chat/timeline/send';
 import { normalizeNoticePositions } from '@/shared/lib/chat/order';
 import { createOmpAgentCallbacks } from '@/shared/lib/chat/timeline/omp-callbacks';
+import { useSessionState } from '@/client/hooks/workspace/session-state';
 
 interface UseChatTimelineOptions {
   folders?: any[];
   appSettings?: Record<string, any>;
@@ -38,6 +39,7 @@
   }, [setSearchParams]);
 
   const { scrollRef, showScrollBottom, isScrolling, handleScroll, scrollToBottom } = useChatTimelineScroll();
 
-  const [inputValue, setInputValue] = useState('');
-  const [inputAttachments, setInputAttachments] = useState<Attachment[]>([]);
+  const { draft, setDraft, attachments, setAttachments } = useSessionState(sessionId);
+  const [inputValue, setInputValue] = useState(draft);`,
      },
      { file: 'app/components/workspace/SearchPanel.tsx', status: 'M', additions: 11, deletions: 10 },
      { file: 'app/components/workspace/context-panel/RawMessagesList.tsx', status: 'M', additions: 4, deletions: 3 },
      { file: 'app/components/workspace/git-panel/ChangesList.tsx', status: 'M', additions: 3, deletions: 3 },
      { file: 'app/components/workspace/git-panel/RepoHeader.tsx', status: 'M', additions: 3, deletions: 2 },
      { file: 'app/components/workspace/git-panel/index.tsx', status: 'M', additions: 3, deletions: 2 },
      { file: 'app/hooks/workspace/git-tree.ts', status: 'M', additions: 22, deletions: 16 },
    ],
  },
  {
    hash: '6d3bac504561a0e5b7218679124a91cfb23190ab',
    shortHash: '6d3bac50',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 12:40 PM',
    message: 'feat(panels): persist git, search, and context panel state per session',
    parents: ['ce7e5189'],
    lane: 0,
    files: [
      { file: 'app/components/workspace/SearchPanel.tsx', status: 'M', additions: 11, deletions: 10 },
      { file: 'app/components/workspace/context-panel/RawMessagesList.tsx', status: 'M', additions: 4, deletions: 3 },
      { file: 'app/components/workspace/git-panel/ChangesList.tsx', status: 'M', additions: 3, deletions: 3 },
      { file: 'app/components/workspace/git-panel/RepoHeader.tsx', status: 'M', additions: 3, deletions: 2 },
      { file: 'app/components/workspace/git-panel/index.tsx', status: 'M', additions: 3, deletions: 2 },
      { file: 'app/hooks/workspace/git-tree.ts', status: 'M', additions: 22, deletions: 16 },
    ],
  },
  {
    hash: 'ce7e5189001b2a3c4d5e6f7a8b9c0d1e2f3a4b5c',
    shortHash: 'ce7e5189',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 12:40 PM',
    message: 'feat(panels): persist editor, file-explorer, browser, and terminal state per session',
    parents: ['c087fa59'],
    lane: 0,
    files: [
      { file: 'app/components/workspace/editor/index.tsx', status: 'M', additions: 8, deletions: 4 },
      { file: 'app/components/workspace/terminal-panel/index.tsx', status: 'M', additions: 12, deletions: 5 },
    ],
  },
  {
    hash: 'c087fa59123456789abcdef0123456789abcdef0',
    shortHash: 'c087fa59',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 12:39 PM',
    message: 'feat(layout): persist active right panel and opened files per session',
    parents: ['221aa007'],
    lane: 0,
    files: [
      { file: 'app/components/layout/RightActivityBar.tsx', status: 'M', additions: 5, deletions: 2 },
      { file: 'app/components/layout/desktop-layout/index.tsx', status: 'M', additions: 7, deletions: 3 },
    ],
  },
  {
    hash: '221aa007abcdef0123456789abcdef0123456789',
    shortHash: '221aa007',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 12:39 PM',
    message: 'feat(terminal): add per-session terminal output snapshot helpers',
    parents: ['faf45f6f'],
    lane: 0,
    files: [
      { file: 'app/hooks/workspace/terminal-output.ts', status: 'A', additions: 45, deletions: 0 },
    ],
  },
  {
    hash: 'faf45f6f11223344556677889900aabbccddeeff',
    shortHash: 'faf45f6f',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 12:39 PM',
    message: 'feat(workspace): add per-session ui state persistence core',
    parents: ['190196bd'],
    lane: 0,
    files: [
      { file: 'app/lib/workspace/session-state/store.ts', status: 'M', additions: 30, deletions: 12 },
    ],
  },
  {
    hash: '190196bd99887766554433221100ffeeddccbbaa',
    shortHash: '190196bd',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 11:03 AM',
    message: 'refactor(omp): unify live and reload message parsing behind shared core parser',
    parents: ['c6944825'],
    lane: 0,
    files: [
      { file: 'app/lib/omp/session/parse-message-blocks.ts', status: 'M', additions: 18, deletions: 24 },
    ],
  },
  {
    hash: 'c694482500aabbccddee11223344556677889900',
    shortHash: 'c6944825',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 10:55 AM',
    message: 'fix(ui): use real session model in mobile view and drop fake fallbacks',
    parents: ['aef783a5'],
    lane: 0,
    files: [
      { file: 'app/components/mobile/ScreenSwitcher.tsx', status: 'M', additions: 6, deletions: 9 },
    ],
  },
  {
    hash: 'aef783a512312312312312312312312312312312',
    shortHash: 'aef783a5',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 10:54 AM',
    message: 'fix(agent): fall back to persisted model selection on new-session spawn',
    parents: ['3537f24b'],
    lane: 0,
    files: [
      { file: 'app/lib/omp/rpc/manager.ts', status: 'M', additions: 4, deletions: 2 },
    ],
  },
  {
    hash: '3537f24b45645645645645645645645645645645',
    shortHash: '3537f24b',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 10, 2026, 10:54 AM',
    message: 'fix(omp): lift tool intent to message level in live mapper',
    parents: ['e39af6e8'],
    lane: 0,
    files: [
      { file: 'app/lib/omp/session/mapper.ts', status: 'M', additions: 14, deletions: 8 },
    ],
  },
  {
    hash: 'e39af6e878978978978978978978978978978978',
    shortHash: 'e39af6e8',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 07:00 PM',
    message: 'refactor(ui): route inline alert/error banners through toast notifications',
    parents: ['131681d9'],
    lane: 0,
    files: [
      { file: 'src/App.tsx', status: 'M', additions: 4, deletions: 1 },
      { file: 'src/components/Header.tsx', status: 'M', additions: 3, deletions: 0 },
      { file: 'src/components/LoginModalView.tsx', status: 'M', additions: 5, deletions: 11 },
      { file: 'src/components/crd/CrdForm.tsx', status: 'M', additions: 5, deletions: 17 },
      { file: 'src/components/sync/SyncLogsView.tsx', status: 'M', additions: 7, deletions: 16 },
      { file: 'src/components/ui/ApiConfigModal.tsx', status: 'M', additions: 15, deletions: 36 },
    ],
  },
  {
    hash: '131681d9aaaabbbbccccddddeeeeffff00001111',
    shortHash: '131681d9',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 03:46 PM',
    message: 'fix(docker): persist sqlite data with named volume',
    parents: ['008cbe07'],
    lane: 0,
    files: [
      {
        file: '.dockerignore',
        status: 'M',
        additions: 1,
        deletions: 0,
        diff: `@@ -1,7 +1,8 @@
 node_modules
 dist
+data
 .env
 .env.*
 !.env.example
 .git
 2 unmodified lines`,
      },
      { file: 'docker-compose.yml', status: 'M', additions: 5, deletions: 0 },
    ],
  },
  {
    hash: '008cbe0711112222333344445555666677778888',
    shortHash: '008cbe07',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 01:25 PM',
    message: 'feat(logging): structured timestamped logging across all web flows, bridged to docker logs',
    parents: ['81ad44d5', 'b3b71ed5'],
    refs: ['origin/feat/whatsapp-notification', 'feat/whatsapp-notification'],
    lane: 0,
    files: [
      { file: 'server.ts', status: 'M', additions: 19, deletions: 3 },
    ],
  },
  {
    hash: '81ad44d522223333444455556666777788889999',
    shortHash: '81ad44d5',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 01:07 PM',
    message: 'WIP on main: b3b71ed fix(pbpmd): history modal reads live BOFIS API instead of sqlite cache',
    parents: ['9616fad9'],
    refs: ['refs/stash'],
    lane: 1,
    files: [
      { file: 'app/routes/api/pb-pmd/$id.history.ts', status: 'M', additions: 22, deletions: 6 },
    ],
  },
  {
    hash: '9616fad933334444555566667777888899990000',
    shortHash: '9616fad9',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 01:07 PM',
    message: 'index on main: b3b71ed fix(pbpmd): history modal reads live BOFIS API instead of sqlite cache',
    parents: ['b3b71ed5'],
    lane: 1,
    files: [
      { file: 'app/routes/api/pb-pmd/$id.history.ts', status: 'M', additions: 15, deletions: 4 },
    ],
  },
  {
    hash: 'b3b71ed544445555666677778888999900001111',
    shortHash: 'b3b71ed5',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 12:55 PM',
    message: 'fix(pbpmd): history modal reads live BOFIS API instead of sqlite cache',
    parents: ['4dc73776'],
    lane: 0,
    files: [
      { file: 'app/routes/api/pb-pmd/$id.history.ts', status: 'M', additions: 8, deletions: 12 },
    ],
  },
  {
    hash: '4dc7377655556666777788889999000011112222',
    shortHash: '4dc73776',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 12:50 PM',
    message: 'feat(ui): 13th KPI card TOTAL MANDAYS + gapless 6-col dashboard grid',
    parents: ['acab6465'],
    lane: 0,
    files: [
      { file: 'app/components/dashboard/KPIGrid.tsx', status: 'M', additions: 35, deletions: 7 },
    ],
  },
  {
    hash: 'acab646566667777888899990000111122223333',
    shortHash: 'acab6465',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 12:45 PM',
    message: 'feat(pbpmd): history modal table layout, wider modal, drop edit scenario action',
    parents: ['86a6d6c5'],
    lane: 0,
    files: [
      { file: 'app/components/pbpmd/HistoryModal.tsx', status: 'M', additions: 24, deletions: 18 },
    ],
  },
  {
    hash: '86a6d6c577778888999900001111222233334444',
    shortHash: '86a6d6c5',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 12:45 PM',
    message: 'feat(pbpmd): pb history modal reads sqlite cache via /api/pb-pmd/:id/history',
    parents: ['9ffea446'],
    lane: 0,
    files: [
      { file: 'app/routes/api/pb-pmd/$id.history.ts', status: 'M', additions: 42, deletions: 5 },
    ],
  },
  {
    hash: '9ffea44688889999000011112222333344445555',
    shortHash: '9ffea446',
    author: 'Wijarnako Putra Rajeb',
    date: 'Sep 1, 2026, 12:45 PM',
    message: 'feat(dashboard): crdApproved threshold shifted 5 minutes from history date_end',
    parents: [],
    lane: 0,
    files: [
      { file: 'app/lib/dashboard/calculator.ts', status: 'M', additions: 12, deletions: 2 },
    ],
  },
];
