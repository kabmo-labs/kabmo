/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The JSON the shell sends to the page, and the JSON it keeps on disk.
 *
 * Stated ONCE because both ends read the same shapes and one of them is
 * JavaScript. Three decisions, and the first is the one that has already bitten
 * this port:
 *
 * 1. **Enums are STRINGS.** `ServerKind.Managed` serializes as `1` by default,
 *    and the client compares `entry.kind === 'managed'` — a numeric kind renders
 *    every row as a remote server, so the Stop button silently disappears from
 *    the servers this window started. `JsonStringEnumConverter` is what keeps the
 *    wire the same one the macOS shell writes (its `Codable` enums are strings).
 * 2. **camelCase**, which is what `src/client/lib/desktop/bridge.ts` declares and
 *    what Swift's `Codable` produced.
 * 3. **Nulls are OMITTED** rather than sent as `null`: the client's types mark
 *    them optional, and a `pid: null` on a stopped server would render as a pid
 *    of nothing rather than an absent one.
 */

using System.Text.Json;
using System.Text.Json.Serialization;

namespace KabmoDesktop;

public static class WireFormat
{
    public static JsonSerializerOptions Options { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
}
