/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's application entry: one window, one bridge, two facts it owns.
 *
 * What it deliberately does NOT do:
 *
 * - **It never sets `KABMO_DATA_DIR`.** The managed server inherits the
 *   environment, so its database stays where `kabmo serve` puts it
 *   (`%USERPROFILE%\.kabmo`) and `kabmo status` keeps seeing the instance the
 *   window is on.
 * - **It does not pass `--tray`.** The server would raise a second icon.
 * - **It never proxies.** Every WebSocket upgrade is origin-checked against the
 *   `Host` header (`lib/http/same-origin.ts`), so a custom scheme in front of the
 *   server answers 403 on the realtime, terminal and dictation sockets. The
 *   webview loads the real `http://host:port` URL.
 */

using System.Windows;

namespace KabmoDesktop.App;

public static class Program
{
    [STAThread]
    public static int Main()
    {
        // `OnMainWindowClose`: the window IS the app, so closing it ends the
        // process — which is also when the child servers are stopped.
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var shell = new ShellHost();
        app.MainWindow = shell.Window;
        app.Run(shell.Window);
        return 0;
    }
}
