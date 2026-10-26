import { hydrate } from 'preact';
import { App } from '@/client/App';
import { bootSyntax } from '@/shared/lib/code/highlighter';
import { warmSyntaxTokenizers } from '@/shared/lib/code/highlighter-warmup';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { initDocumentTheme } from '@/client/hooks/ui/theme';
import { primeWindowChrome } from '@/client/hooks/ui/window-chrome';
import { installAuthFetchBridge, primeAuthState } from '@/client/hooks/ui/auth';
import { installPluginRuntime } from '@/client/lib/plugins/runtime';
import { installUiKit } from '@/client/lib/plugins/kit';
import { installScrollbarActivity } from '@/client/lib/scrollbar-activity';
import { installBackDispatcher } from '@/client/lib/native/back';
import { installPalettePublisher } from '@/client/lib/native/palette';
import { installResumeDispatcher } from '@/client/lib/native/resume';
import { installFileLaunchHandler } from '@/client/lib/launch/file-handlers';

import '@/client/tailwind.css';
import '@/shared/lib/markdown/katex-fonts.css';
import '@/shared/lib/markdown/fira-code-fonts.css';
import '@/shared/lib/fonts/nerd-symbols.css';

const root = document.getElementById('app');
const bootstrap = window.__OMP_BOOTSTRAP__;

// Both before the first render: the auth state decides whether the app or the
// login screen is mounted, and the fetch bridge must be in place before any
// hook issues a request, or a 401 during startup would go unnoticed.
primeAuthState(bootstrap?.authenticated, bootstrap?.authEnabled === true);
installAuthFetchBridge();

primeKabmoSettings(bootstrap?.appSettings);

// BEFORE the theme init, which writes the chrome meta: a phone that repainted
// it from the module default would flash the desktop's color for a frame. The
// server's two facts (user agent, authentication) are baked into the document,
// so they are seeded rather than re-derived here.
primeWindowChrome({
  isMobile: bootstrap?.initialIsMobile ?? false,
  authRequired: bootstrap?.authenticated === false,
});

// The catalog stylesheet and both theme attributes, before the first render:
// the server writes them into the shell, so this only repairs a document served
// by an older build.
initDocumentTheme();

// Both BEFORE the first render, and in this order: a plugin bundle reads the
// runtime the moment it is imported, and the UI kit reads the services its
// components call. Neither can wait for a panel to open, because the registry
// read starts the imports as soon as the layout mounts.
installPluginRuntime();
installUiKit();

// One document-level capture listener serves every scroll container, including
// the ones mounted later — which is why this is a boot-time install and not a
// hook. Before the first render so the first scroll of a restored session is
// already covered.
installScrollbarActivity();

// The native shell asks `window.__kabmoBack()` before walking WebView history.
// Installed before the first render for the same reason the listener above is:
// a back press during hydration must find the dispatcher, not `undefined`.
installBackDispatcher();

// A native shell's launch overlay is drawn before this page exists, so the
// palette has to cross to it as VALUES. It asks here (`__kabmoPalette()`), and
// each shell keeps the answer for its next cold start — the launch where
// nothing is running to ask. Installed before the first render because a shell
// asks on the load it is hiding, not on a later interaction.
installPalettePublisher();

// The native shell calls `window.__kabmoResume()` when its app returns to the
// foreground. A backgrounded Android WebView fires no `visibilitychange` and
// gets no `close` for a socket the server reaped, so the shell's own lifecycle
// is the only reliable resume signal there — see `shared/lib/realtime/resume.ts`
// for the watchdog that covers the case no event arrives at all.
installResumeDispatcher();

// A file the OS handed to Kabmo (PWA File Handling) arrives as a
// `FileSystemFileHandle` on `launchQueue`, and the consumer must be installed
// before the first render: launches that happened before the script ran are
// QUEUED, and reading one is what makes a cold start from a double-clicked file
// work. A no-op on a browser without the API (Firefox, Safari), which is why it
// is safe to call unconditionally.
installFileLaunchHandler((result) => {
  if (!result.ok) console.warn(`[kabmo] ${result.message}`);
});

// Fire-and-forget: warms the Shiki highlighter in parallel with hydration.
// Once the eager grammars land, each is tokenized once on a tiny sample during
// idle time — loading a grammar is not compiling it, and the compile used to be
// paid inside the first tool card the reader expanded.
void bootSyntax().then(() => warmSyntaxTokenizers());

if (root) {
  hydrate(
    <App
      initialIsMobile={bootstrap?.initialIsMobile}
      production={bootstrap?.production}
      appSettings={bootstrap?.appSettings}
    />,
    root,
  );
}
