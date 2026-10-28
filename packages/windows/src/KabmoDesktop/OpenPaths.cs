/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Files the operating system handed to Kabmo.
 *
 * A double-click in Explorer, "Open With → Kabmo" on a `.docx`, a multi-selection,
 * a drop of three PDFs on the Start-menu icon: every one arrives as a PATH on the
 * app's command line, and the page never sees it on its own.
 *
 * Why not `launchQueue`: WebView2 is Chromium, so the PWA File Handling path in
 * `src/client/lib/launch/file-handlers.ts` DOES exist there — but it is not what
 * Windows uses for this. A shell's own command line is the OS contract, and the
 * installer registers the association against the executable; a page-level launch
 * queue only fires for an installed PWA, which this is not.
 *
 * The rules live here rather than in `ShellHost` for the same reason the macOS
 * shell's do: a rule that can only be checked by opening a window is a rule that
 * is not checked, and the test runner has no display.
 */

using System.IO;
using System.Text.Json;

namespace KabmoDesktop;

/// <summary>Paths the OS handed over that the page has not taken yet.</summary>
public sealed class OpenPathQueue
{
    private readonly List<string> _pending = new();

    /// <summary>How many paths are waiting.</summary>
    public int Count => _pending.Count;

    /// <summary>Whether anything is waiting, so a flush can be skipped.</summary>
    public bool IsEmpty => _pending.Count == 0;

    /// <summary>
    /// Add paths, dropping duplicates and anything blank.
    ///
    /// A duplicate is real: a second activation for a file already queued is a
    /// file the user opened once, and two tabs for one document is the bug this
    /// prevents.
    /// </summary>
    public void Add(IEnumerable<string> paths)
    {
        foreach (var path in paths)
        {
            var trimmed = path.Trim();
            if (trimmed.Length == 0) continue;
            if (_pending.Contains(trimmed)) continue;
            _pending.Add(trimmed);
        }
    }

    /// <summary>
    /// Everything waiting, and empty the queue.
    ///
    /// Taking is what makes a delivery once-only: the page asks on every
    /// navigation completion, and a value left behind would be reopened on the
    /// next one — a reload would reopen the file the user closed.
    /// </summary>
    public List<string> Take()
    {
        var paths = new List<string>(_pending);
        _pending.Clear();
        return paths;
    }
}

/// <summary>The launch's file paths, extracted from the command line.</summary>
public static class LaunchPaths
{
    /// <summary>
    /// The file paths in <paramref name="arguments"/>.
    ///
    /// Four rules, each of which is how a launch is lost:
    ///
    /// <list type="bullet">
    /// <item>the executable itself is argument 0;</item>
    /// <item>a <c>-flag</c> is not a path, and neither is any other argument that
    /// names no existing file — a <c>/flag</c> falls out on that check alone,
    /// which is why the two spellings need no separate test;</item>
    /// <item>a quoted argument keeps its quotes when it comes from a raw command
    /// line, so they are stripped;</item>
    /// <item>a path that does not exist is dropped — the page would answer "that
    /// file no longer exists" for a document deleted between the click and the
    /// launch, and a silent drop is the honest outcome.</item>
    /// </list>
    /// </summary>
    public static List<string> From(string[] arguments)
    {
        var paths = new List<string>();
        foreach (var argument in arguments.Skip(1))
        {
            var candidate = Unquote(argument.Trim());
            if (candidate.Length == 0) continue;
            if (candidate.StartsWith("-", StringComparison.Ordinal)) continue;
            // The existence check is the whole filter for everything else: a
            // `/flag` names no file, and `C:/x` — which Windows accepts with a
            // forward slash — does.
            if (!File.Exists(candidate)) continue;
            if (paths.Contains(candidate)) continue;
            paths.Add(candidate);
        }
        return paths;
    }

    /// <summary>Strip one pair of surrounding double quotes, if present.</summary>
    private static string Unquote(string value) =>
        value.Length >= 2 && value[0] == '"' && value[^1] == '"'
            ? value[1..^1]
            : value;
}

/// <summary>The JavaScript that hands paths to the page.</summary>
public static class OpenPathsScript
{
    /// <summary>
    /// Built by the JSON serializer, never by concatenation: a path may contain a
    /// quote or a backslash, and a Windows path always contains a backslash — so
    /// hand-escaping here would break on every file.
    /// </summary>
    public static string For(IReadOnlyList<string> paths)
    {
        var json = JsonSerializer.Serialize(paths);
        return $"window.__kabmoOpenPaths ? window.__kabmoOpenPaths({json}) : null";
    }
}
