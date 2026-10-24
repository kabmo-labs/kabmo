/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The page ↔ shell bridge, over WebView2's own message channel.
 *
 * The page posts `{ id, method, params }` with `window.chrome.webview.postMessage`,
 * and the shell answers by executing `window.__kabmoReply(id, ok, payload)`. That
 * is the SAME contract the macOS shell installs over `WKScriptMessageHandler`, so
 * `src/client/lib/desktop/bridge.ts` and everything above it cannot tell which
 * shell it is talking to — which is the point of the client being shared.
 *
 * The identity script runs at document start, before the page's own scripts, for
 * two reasons: `__kabmoReply` has to exist when the first command answers, and
 * `__kabmoDesktop` carries the shell's identity so the navbar draws its server
 * control on the FIRST paint rather than flashing it in after a round trip.
 */

using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace KabmoDesktop.App;

/// <summary>What the shell reports about itself, once, before the page asks anything.</summary>
public sealed record ShellInfo(string Platform, string ShellVersion, bool OverlayTitlebar, bool WindowControls)
{
    /// <summary>
    /// The machine's architecture, in the console's vocabulary (`arm64` / `x64`).
    ///
    /// Every desktop artifact is per-architecture, so without this the console can
    /// only offer the release page. Absent on a shell too old to report it, which
    /// degrades the offer rather than breaking it.
    /// </summary>
    public string? Arch { get; init; }

    public string? TrafficLightInset { get; init; }
}

/// <summary>The bridge's transport, so the app can route a command without a switch in the window.</summary>
public interface IShellCommandHost
{
    Task<object?> HandleAsync(string method, JsonElement parameters);
    void Navigate(string url);
}

public static class Bridge
{

    /**
     * The user script installed before the page's own scripts.
     *
     * `__kabmoCall` posts over `window.chrome.webview` and resolves from
     * `__kabmoReply`, so a command that spawns a server (up to 45s) is not
     * defeated by a short budget: the timeout only reports a shell that never
     * answered at all.
     */
    public static string BootstrapScript(ShellInfo info)
    {
        var json = JsonSerializer.Serialize(info, WireFormat.Options);
        return $$"""
        (() => {
          window.__kabmoDesktop = {{json}};
          const pending = new Map();
          let next = 1;
          window.__kabmoReply = (id, ok, payload) => {
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);
            clearTimeout(entry.timer);
            if (ok) entry.resolve(payload);
            else entry.reject(new Error(typeof payload === 'string' ? payload : 'The shell refused that command.'));
          };
          window.__kabmoCall = (method, params) => new Promise((resolve, reject) => {
            const id = next++;
            // A command that spawns a server waits for its health endpoint (up to
            // 45s), so the budget is generous: a timeout there would report a
            // running server as failed.
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(new Error(`The shell did not answer ${method} within 60s.`));
            }, 60000);
            pending.set(id, { resolve, reject, timer });
            window.chrome.webview.postMessage({ id, method, params: params || {} });
          });
        })();
        """;
    }

    /// <summary>Route one message from the page, and answer it.</summary>
    public static async void OnMessage(WebView2 webView, IShellCommandHost host, CoreWebView2WebMessageReceivedEventArgs args)
    {
        int id;
        string method;
        JsonElement parameters = default;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("id", out var idElement) || !idElement.TryGetInt32(out id)) return;
            id = idElement.GetInt32();
            method = root.TryGetProperty("method", out var methodElement) ? methodElement.GetString() ?? "" : "";
            if (root.TryGetProperty("params", out var paramsElement)) parameters = paramsElement.Clone();
        }
        catch (JsonException)
        {
            return;
        }

        try
        {
            var payload = await host.HandleAsync(method, parameters);
            await ReplyAsync(webView, id, true, payload);
        }
        catch (Exception error)
        {
            await ReplyAsync(webView, id, false, error.Message);
        }
    }

    /// <summary>
    /// One function for both outcomes, so a success and a failure cannot drift.
    ///
    /// The payload is serialized ONCE and interpolated — never built by string
    /// concatenation from raw values, which is how a server label containing a
    /// quote breaks the call.
    /// </summary>
    private static async Task ReplyAsync(WebView2 webView, int id, bool ok, object? payload)
    {
        var json = payload switch
        {
            null => "null",
            string text => JsonSerializer.Serialize(text),
            _ => JsonSerializer.Serialize(payload, WireFormat.Options),
        };
        var script = $"window.__kabmoReply({id}, {(ok ? "true" : "false")}, {json});";
        try
        {
            await webView.ExecuteScriptAsync(script);
        }
        catch
        {
            // The page navigated away between the command and its answer: there
            // is nobody left to receive it, and the caller is gone with it.
        }
    }
}
