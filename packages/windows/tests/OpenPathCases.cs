/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The files the OS hands the shell, pinned without a window.
 *
 * Every case here fails SILENTLY in the app: a launch that is mis-parsed opens
 * nothing, and one that is parsed twice opens the same document in two tabs.
 * Neither throws, and neither logs.
 *
 * The rules are the macOS suite's (`packages/macos/Tests/OpenPathsTests.swift`),
 * restated — the two shells share no runtime, so the same table in both is what
 * keeps them from disagreeing about what a launch carried.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

static class OpenPathCases
{
    public static void Run(Action<string, bool> check, Action<string> group)
    {
        // A real file, so `LaunchPaths.From` can accept it.
        var dir = Path.Combine(Path.GetTempPath(), $"kabmo-openpaths-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var pdf = Path.Combine(dir, "report.pdf");
        var docx = Path.Combine(dir, "notes.docx");
        File.WriteAllText(pdf, "x");
        File.WriteAllText(docx, "x");
        const string Exe = @"C:\Program Files\Kabmo\Kabmo.exe";

        group("LaunchPaths — command line");

        check("the executable is not a path", LaunchPaths.From(new[] { Exe }).Count == 0);
        check("a document argument is a path",
            LaunchPaths.From(new[] { Exe, pdf }).SequenceEqual(new[] { pdf }));
        check("two documents both survive",
            LaunchPaths.From(new[] { Exe, pdf, docx }).SequenceEqual(new[] { pdf, docx }));
        // A quoted `%1` reaches the process with its quotes when the association
        // expands it unquoted-but-quoted — stripping them is what makes the file
        // findable at all.
        check("surrounding quotes are stripped",
            LaunchPaths.From(new[] { Exe, $"\"{pdf}\"" }).SequenceEqual(new[] { pdf }));
        check("a flag is skipped",
            LaunchPaths.From(new[] { Exe, "--new-window", pdf }).SequenceEqual(new[] { pdf }));
        check("a relative argument is not a path",
            LaunchPaths.From(new[] { Exe, "report.pdf" }).Count == 0);
        check("a missing file is dropped",
            LaunchPaths.From(new[] { Exe, Path.Combine(dir, "gone.pdf") }).Count == 0);
        check("a duplicate argument opens once",
            LaunchPaths.From(new[] { Exe, pdf, pdf }).SequenceEqual(new[] { pdf }));

        group("OpenPathQueue");

        var queue = new OpenPathQueue();
        check("a fresh queue is empty", queue.IsEmpty && queue.Count == 0);
        queue.Add(new[] { "/a.pdf", "/b.pdf" });
        check("add keeps the order", queue.Count == 2);
        queue.Add(new[] { "/a.pdf" });
        check("add de-duplicates", queue.Count == 2);
        check("take answers everything in order",
            queue.Take().SequenceEqual(new[] { "/a.pdf", "/b.pdf" }));
        // The rule that makes a reload safe: a taken batch is gone, so a second
        // navigation completion cannot reopen what the user closed.
        check("take empties the queue", queue.IsEmpty && queue.Take().Count == 0);
        queue.Add(new[] { "   ", "" });
        check("blank paths are dropped", queue.IsEmpty);

        group("OpenPathsScript");

        var plain = OpenPathsScript.For(new[] { "/a.pdf" });
        check("a plain path is a JSON array", plain.Contains("[\"/a.pdf\"]"));
        check("the call is guarded", plain.Contains("window.__kabmoOpenPaths ?"));
        // A Windows path ALWAYS carries a backslash, so hand-escaping would break
        // on every file rather than on an unlucky one.
        var windows = OpenPathsScript.For(new[] { @"C:\Users\x\a.pdf" });
        check("a backslash is escaped, not interpolated", windows.Contains(@"C:\\Users\\x\\a.pdf"));

        try
        {
            Directory.Delete(dir, recursive: true);
        }
        catch (IOException)
        {
            // A leaked temp directory is not this suite's failure.
        }
    }
}
