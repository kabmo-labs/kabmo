// macOS tray host — a real NSStatusItem in the menu bar, owned by the server.
//
// Run as `osascript -l JavaScript <this file> <config.json>`. JXA is used
// rather than a compiled helper because it needs no toolchain: `osascript`
// ships with macOS, it can build an AppKit status item, and `NSApplication.run`
// keeps the process alive with a real event loop. Verified on this machine: a
// status item created here reports a visible 22pt button in the menu bar and
// its target/action fires.
//
// TWO LIFECYCLE RULES, and the feature is these two:
//
//   1. The host is the SERVER's child, and it dies with it. `getppid` is polled
//      on a timer; when the parent exits the child is reparented to launchd
//      (pid 1), the change is seen, and the icon goes away. That is what makes
//      a SIGKILLed or crashed server leave no orphan icon — verified: with the
//      parent gone the ppid becomes 1 and the host terminates itself.
//   2. The menu's Quit signals the SERVER (SIGTERM to the parent), so the icon
//      and the console it fronts end together. A tray that outlived its server
//      would be an icon for a port nobody serves.
//
// Every other menu row is either a platform call (open a URL, open a file) or a
// callback into the CLI (`serve --startup` / `--no-startup`), so liveness,
// server control and login registration each exist once, in `src/server/lib`.

ObjC.import('AppKit');
ObjC.import('Foundation');

// `getppid`/`kill` are not in the Foundation bridge by default; binding them is
// what makes parent-death detection and the Quit signal possible without
// shelling out on every tick.
ObjC.bindFunction('getppid', ['int', []]);
ObjC.bindFunction('kill', ['int', ['int', 'int']]);

/** Read the whole config document the server wrote. */
function readConfig(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(
    $.NSString.alloc.initWithUTF8String(path),
    $.NSUTF8StringEncoding,
    $(),
  );
  if (!text || !text.js) throw new Error('Could not read tray config at ' + path);
  return JSON.parse(text.js);
}

/** Start a command detached, with its output discarded. */
function spawnDetached(argv) {
  const task = $.NSTask.alloc.init;
  task.setLaunchPath($.NSString.alloc.initWithUTF8String(argv[0]));
  task.setArguments($(argv.slice(1)));
  const devNull = $.NSFileHandle.fileHandleForWritingAtPath($.NSString.alloc.initWithUTF8String('/dev/null'));
  if (devNull) {
    task.setStandardOutput(devNull);
    task.setStandardError(devNull);
  }
  task.launch;
}

/** Ask the desktop to open a URL or a file with whatever owns it. */
function openWithDefault(target) {
  $.NSWorkspace.sharedWorkspace.openURL($.NSURL.fileURLWithPath($.NSString.alloc.initWithUTF8String(target)));
}

function run(argv) {
  const config = readConfig(argv[0]);
  const App = $.NSApplication.sharedApplication;
  // Accessory: a menu-bar icon and no Dock tile, which is what a tray is.
  App.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

  const startPpid = $.getppid();
  const cliArgv = (extra) => [config.bun, config.cli, 'serve', ...extra, '--port', String(config.port)];

  const openConsole = () => $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(config.url));
  const openLogs = () => openWithDefault(config.logFile);
  const toggleLogin = () => spawnDetached(cliArgv([config.loginInstalled ? '--no-startup' : '--startup']));
  const quit = () => {
    // Signal the SERVER, then exit. Signalling first is what makes the console
    // go down with the icon rather than being left running with no tray.
    try {
      $.kill(startPpid, 15);
    } catch {
      // The server is already gone; exiting is then all that is left.
    }
    App.terminate(null);
  };

  ObjC.registerSubclass({
    name: 'KabmoTray',
    methods: {
      'menuNeedsUpdate:': {
        types: ['void', ['id']],
        implementation: function (menu) {
          menu.removeAllItems;
          const rows = [
            { title: 'Open Console', action: openConsole },
            { title: 'Open Logs', action: openLogs },
            { separator: true },
            { title: config.loginInstalled ? 'Disable Start at Login' : 'Start at Login', action: toggleLogin },
            { separator: true },
            { title: 'Quit Kabmo', action: quit },
          ];
          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            if (row.separator) {
              menu.addItem($.NSMenuItem.separatorItem);
              continue;
            }
            const item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(
              row.title,
              $.NSSelectorFromString('activate:'),
              '',
            );
            item.setTarget(this);
            item.setTag(index);
            menu.addItem(item);
          }
        },
      },
      'activate:': {
        types: ['void', ['id']],
        implementation: function (sender) {
          const raw = sender.tag;
          const index = Number(raw && raw.js !== undefined ? raw.js : raw);
          const actions = [openConsole, openLogs, null, toggleLogin, null, quit];
          const action = Number.isInteger(index) ? actions[index] : null;
          if (action) action();
        },
      },
      'watchParent:': {
        types: ['void', ['id']],
        implementation: function () {
          // Reparented to launchd: the server is gone, so the icon must be too.
          if ($.getppid() !== startPpid) {
            App.terminate(null);
          }
        },
      },
    },
  });

  const handler = $.KabmoTray.alloc.init;
  const statusItem = $.NSStatusBar.systemStatusBar.statusItemWithLength($.NSVariableStatusItemLength);

  // The bundled icon when it loads; the name otherwise, so a missing asset
  // leaves a visible tray rather than an invisible zero-width item.
  let drew = false;
  try {
    const image = $.NSImage.alloc.initWithContentsOfFile($.NSString.alloc.initWithUTF8String(config.icon));
    if (image && image.size && image.size.width > 0) {
      image.setSize($.NSMakeSize(18, 18));
      statusItem.setImage(image);
      drew = true;
    }
  } catch {
    // Fall through to the title below.
  }
  if (!drew) statusItem.setTitle($.NSString.alloc.initWithUTF8String(config.label));

  statusItem.setToolTip($.NSString.alloc.initWithUTF8String(config.label + ' — ' + config.url));

  const menu = $.NSMenu.alloc.init;
  // The menu is rebuilt per open (`menuNeedsUpdate:`), so the login row reads
  // live state. Auto-enabling would fight that, and every row here has an
  // action anyway.
  menu.setAutoenablesItems(false);
  menu.setDelegate(handler);
  statusItem.setMenu(menu);

  // Parent watch: 2s is a compromise — fast enough that a killed server does
  // not leave a dead icon on screen for long, cheap enough to be invisible
  // (one `getppid` syscall per tick).
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
    2.0,
    handler,
    $.NSSelectorFromString('watchParent:'),
    $(),
    true,
  );

  App.run;
}
