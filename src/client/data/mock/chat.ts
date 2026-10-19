import type { ChatMessageData } from '@/shared/types';
import { getSampleToolsSession, SAMPLE_TOOLS_SESSION_ID } from '@/client/data/samples/tools-session';
import { getSampleDialogueSession, SAMPLE_DIALOGUE_SESSION_ID } from '@/client/data/samples/dialogue-session';
import { getSampleDevicesSession, SAMPLE_DEVICES_SESSION_ID } from '@/client/data/samples/virtual-devices-session';
import { getSampleSubagentSession, SAMPLE_SUBAGENT_SESSION_ID } from '@/client/data/samples/subagent-session';

export { SAMPLE_DEVICES_SESSION_ID, SAMPLE_SUBAGENT_SESSION_ID };

export function getSessionData(sessionId: string | null) {
  if (!sessionId) return null;

  if (sessionId === SAMPLE_SUBAGENT_SESSION_ID || sessionId === 'subagent') {
    return getSampleSubagentSession();
  }

  if (sessionId === SAMPLE_TOOLS_SESSION_ID || sessionId === '1' || sessionId === 'sample' || sessionId === 'showcase') {
    return getSampleToolsSession();
  }

  if (sessionId === SAMPLE_DIALOGUE_SESSION_ID || sessionId === '2' || sessionId === 'dialogue') {
    return getSampleDialogueSession();
  }

  if (sessionId === SAMPLE_DEVICES_SESSION_ID || sessionId === '3' || sessionId === 'devices' || sessionId === 'virtual-devices') {
    return getSampleDevicesSession();
  }

  const id = parseInt(sessionId, 10) || 1;
  const date = "Sep 4, 09:00 PM";

  const messages: ChatMessageData[] = [
    {
      id: `msg-${id}-1`,
      role: 'user',
      date,
      content: `Can you help me implement the requested changes for session ${id}? I need to commit only the specific folder related to this task.`,
    },
    {
      id: `msg-${id}-2`,
      role: 'ai',
      date,
      thinking: {
        duration: "2.8s",
        summary: "Inspect git status and check workspace changes before committing .history folder.",
        thought: "1. The user requested to commit only the .history folder for session " + id + ".\n2. Need to verify git working directory state first with git status --short.\n3. Also inspect diff to verify untracked vs modified files in .history.\n4. If no staged changes exist, report status cleanly to user."
      },
      toolCalls: [
        {
          id: `t-${id}-1`,
          type: 'bash',
          title: 'Shell Command',
          target: 'git status --short',
          command: 'git status --short',
          output: '?? app/types/chat.ts\n M app/data/chatMockData.ts',
          status: 'success',
          duration: '45ms'
        },
        {
          id: `t-${id}-2`,
          type: 'bash',
          title: 'Git Diff Stats',
          target: 'git diff --stat',
          command: 'git diff --stat',
          output: ' app/data/chatMockData.ts | 48 ++++++++++++++++++++++++++++++------------------\n 1 file changed, 30 insertions(+), 18 deletions(-)',
          status: 'success',
          duration: '62ms'
        }
      ],
      systemNote: `.history/ has no changes per git status. Let me verify with a broader recursive check.`,
      actions2: [
        {
          id: `t-${id}-3`,
          type: 'bash',
          title: 'Shell Check',
          target: '.history/ directory scan',
          command: 'git status --short -- .history/ ; git ls-files --others --exclude-standard .history',
          output: '0 matches found. .history/ working tree clean.',
          status: 'success',
          duration: '38ms'
        }
      ],
      content: `I've analyzed the current workspace state for session ${id}. Verified that .history/ is clean and in sync with the upstream branch.`,
      summary: "Nothing to commit — the .history/ folder is fully in sync with origin/main."
    },
    {
      id: `msg-${id}-3`,
      role: 'user',
      date,
      content: `Oh wait, please also run a build command using "bun run build" just to make sure everything compiles properly before we proceed further. The build script is very long and usually outputs a lot of logs, so I want to be safe!`,
    },
    {
      id: `msg-${id}-4`,
      role: 'ai',
      date,
      thinking: {
        duration: "1.4s",
        summary: "Trigger bun build runner, evaluate output exit code, and verify edge adapter artifacts.",
        thought: "Executing standard build pipeline via Bun. Checking for TypeScript diagnostic errors and Vite static generation bundle size."
      },
      toolCalls: [
        {
          id: `t-${id}-4`,
          type: 'bash',
          title: 'Bun Build Runner',
          target: 'bun run build',
          command: 'bun run build',
          output: `[bun] $ vite build\nvite v5.4.19 building for production...\n✓ 42 modules transformed.\ndist/client/assets/index-Dk93ka.js   148.24 kB │ gzip: 42.10 kB\ndist/client/assets/index-L0w2kx.css   18.62 kB │ gzip:  4.12 kB\n✓ built in 342ms\n\n[remisJS] Edge adapter ready: 0 errors, 0 warnings.`,
          status: 'success',
          duration: '1.2s'
        }
      ],
      content: `Understood! I've executed the build command. The compilation finished with zero errors and produced the client bundles cleanly.`,
      summary: "Build succeeded in 1.2s — 42 modules transformed without diagnostic warnings."
    },
    {
      id: `msg-${id}-5`,
      role: 'user',
      date,
      content: `Great! Next, can we add a scroll-to-bottom button in the chat timeline? If the chat gets too long and I scroll up, I want a quick way to jump back down.`,
    },
    {
      id: `msg-${id}-6`,
      role: 'ai',
      date,
      thinking: {
        duration: "3.2s",
        summary: "Identify scroll container ref, implement scroll threshold check, and add floating arrow trigger button.",
        thought: "1. Need to use useRef on the chat container.\n2. Attach onScroll handler: check if (scrollHeight - scrollTop - clientHeight > 100).\n3. Render floating scroll-to-bottom button with smooth behavior.\n4. Edit ChatTimeline.tsx with new state and event bindings."
      },
      toolCalls: [
        {
          id: `t-${id}-read-1`,
          type: 'view_file',
          title: 'View File',
          target: 'examples/index.js',
          command: 'view_file examples/index.js',
          output: `// examples/index.ts\nconst port = Number(Bun.env.PORT) || 3000;\n\nBun.serve({\n  port,\n  fetch() {\n    return Response.json({ status: 'healthy', runtime: 'bun' });\n  },\n});\n\nconsole.log(\`Server running at http://localhost:\${port}/\`);`,
          status: 'success',
          duration: '14ms'
        },
        {
          id: `t-${id}-5`,
          type: 'edit_file',
          title: 'Edit File',
          target: '/app/components/workspace/ChatTimeline.tsx',
          command: 'edit_file app/components/workspace/ChatTimeline.tsx',
          diff: {
            file: 'app/components/workspace/ChatTimeline.tsx',
            added: 24,
            removed: 4,
            diffText: `@@ -28,4 +28,24 @@\n+  const [showScrollBottom, setShowScrollBottom] = useState(false);\n+  const handleScroll = useCallback(() => {\n+    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;\n+    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 100);\n+  }, []);\n+  const scrollToBottom = () => scrollRef.current?.scrollTo({ top: scrollHeight, behavior: 'smooth' });`
          },
          output: 'Successfully applied diff to /app/components/workspace/ChatTimeline.tsx',
          status: 'success',
          duration: '310ms'
        }
      ],
      content: `I've implemented the floating scroll-to-bottom button in the chat timeline. It tracks your scroll position dynamically and provides a 1-tap jump to the bottom.`,
      summary: "Scroll-to-bottom button integrated with smooth scrolling and responsive threshold triggers."
    },
    {
      id: `msg-${id}-7`,
      role: 'user',
      date,
      content: `That works perfectly. One more design tweak: can you fix the navbar? The active session title should be perfectly aligned with the chat timeline, and let's change the typography for the workspace category in the sidebar to 13px, and session items to 12px.`,
    },
    {
      id: `msg-${id}-8`,
      role: 'ai',
      date,
      thinking: {
        duration: "4.1s",
        summary: "Synchronize navbar title positioning and adjust typography scales across SessionSidebar and CategoryItem.",
        thought: "1. Refactor DesktopLayout to ensure navbar title seamlessly aligns with chat column.\n2. Update CategoryItem font-size to text-[13px] and font-semibold.\n3. Update SessionItem font-size to text-[12px] font-mono."
      },
      toolCalls: [
        {
          id: `t-${id}-6`,
          type: 'edit_file',
          title: 'Edit File',
          target: '/app/routes/_index.tsx',
          command: 'edit_file app/routes/_index.tsx',
          diff: {
            file: 'app/routes/_index.tsx',
            added: 6,
            removed: 2,
            diffText: `@@ -118,2 +118,6 @@\n-  <DesktopLayout />\n+  <DesktopLayout folders={folders} sessionId={sessionId} />`
          },
          status: 'success',
          duration: '180ms'
        },
        {
          id: `t-${id}-7`,
          type: 'edit_file',
          title: 'Edit File',
          target: '/app/components/layout/SessionSidebar.tsx',
          command: 'edit_file app/components/layout/SessionSidebar.tsx',
          diff: {
            file: 'app/components/layout/SessionSidebar.tsx',
            added: 12,
            removed: 5,
            diffText: `@@ -45,5 +45,12 @@\n-  className="text-xs"\n+  className="text-[13px] font-semibold text-ink"\n-  className="text-[11px]"\n+  className="text-[12px] font-mono text-ink/70"`
          },
          status: 'success',
          duration: '220ms'
        }
      ],
      content: `I've updated the layout alignment and sidebar typography:\n- Active session title is now nested directly within the timeline header for pixel-perfect alignment.\n- Category typography updated to 13px.\n- Session items updated to 12px font-mono.`,
      summary: "Navbar alignment calibrated and sidebar typography updated to 13px / 12px."
    },
    {
      id: `msg-${id}-9`,
      role: 'user',
      date,
      content: `Awesome, that looks way better now! By the way, how do I configure the AI model settings for the workspace?`,
    },
    {
      id: `msg-${id}-10`,
      role: 'ai',
      date,
      thinking: {
        duration: "0.8s",
        summary: "Provide user instructions for AI model selection and custom Kabmo settings.",
        thought: "The user is asking about model configuration. Direct them to the settings gear in the sidebar and the inline model switch pill above the chat input."
      },
      content: `You can configure the AI models in two convenient locations:\n\n1. **Inline Model Switcher**: Click the model badge (e.g. \`[CMD] DeepSeek V4 Pro\`) right above the chat input box to switch models on the fly.\n2. **Kabmo Settings**: Click the settings gear icon in the bottom-left of the sidebar to configure API keys, temperature, and custom system prompts for Oh-My-Pi.`
    }
  ];

  return {
    title: `Task Session #${id}`,
    date,
    model: "DeepSeek V4 Pro",
    messages
  };
}
