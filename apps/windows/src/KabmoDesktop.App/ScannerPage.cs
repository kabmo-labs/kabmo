/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scanner page, read from the assembly's embedded resource.
 *
 * Embedded rather than copied next to the executable: an installed build is a
 * single directory the user may move, and a page that goes missing turns the
 * scanner into a blank window with no explanation.
 */

using System.IO;
using System.Reflection;

namespace KabmoDesktop.App;

internal static class ScannerPage
{
    /// <summary>The page's HTML, or a sentence when the resource is missing.</summary>
    public static string Html
    {
        get
        {
            using var stream = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("qr-scanner.html");
            if (stream is null)
            {
                return "<!doctype html><meta charset=\"utf-8\">" +
                       "<body style=\"font:14px sans-serif;padding:24px\">" +
                       "The scanner page is missing from this build. Use the pairing link instead.</body>";
            }
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd();
        }
    }
}
