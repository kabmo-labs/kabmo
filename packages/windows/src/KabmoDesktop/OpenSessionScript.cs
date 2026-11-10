/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The script a notification click runs in the page.
 *
 * Kept in the library, like `WireFormat`: the session id is opaque, and
 * interpolating it raw would let a quote turn into source. `JsonSerializer`
 * already owns the escaping the bridge uses, so this asks it rather than keeping
 * a second table.
 */

using System.Text.Json;

namespace KabmoDesktop;

public static class OpenSessionScript
{
    public static string For(string sessionId) =>
        $"window.__kabmoOpenSession && window.__kabmoOpenSession({JsonSerializer.Serialize(sessionId)})";
}
