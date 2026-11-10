package dev.kabmo.shell

import android.content.Context
import android.webkit.JavascriptInterface
import java.net.URLDecoder
import java.util.concurrent.Executor

/**
 * The transport between the console's page and this shell.
 *
 * Four commands, the same four the desktop shells answer without the ones a
 * phone cannot: `servers_state`, `servers_add`, `servers_remove`,
 * `servers_activate`. `servers_start` and `servers_stop` do NOT exist here —
 * there is no child process to own — and the console learns that from
 * `startable: false` in the state rather than from a user agent.
 *
 * ## Why `@JavascriptInterface` and not an injected script
 *
 * `WKWebView` can inject script before the page's own; `WebView` cannot, reliably
 * — `evaluateJavascript` needs a page to run in. So the page finds a HOST OBJECT
 * and adapts it into the `__kabmoCall` shape it already speaks
 * (`src/client/lib/shell/bridge.ts`), which is why this interface is a callback
 * and not a promise transport: one method, `post(method, id, params)`, answered
 * by evaluating `window.__kabmoReply(id, ok, payload)`.
 *
 * ## Why the params are FORM-ENCODED
 *
 * The page sends `k=v&k=v`. `org.json` is a stub in the JVM unit test suite, so a
 * JSON param string would be the one parser that cannot be tested; `URLDecoder`
 * is plain Java and runs under `bun test`-less JVM suites. The reply is JSON
 * TEXT, built by `ServerWire`, for the same reason.
 *
 * ## Threads
 *
 * `post` arrives on the WebView's JS thread. Probing stored servers is network
 * I/O with a 6-second timeout each, so the work is handed to its own worker and
 * the reply is posted back through `reply`, which the Activity routes to the
 * main thread. `WebView.evaluateJavascript` must run there.
 */
class ServerHost(
    private val context: Context,
    /** Answers `servers_state` and the mutations; never the JS thread. */
    private val work: Executor,
    /** Evaluate a script in the page; the Activity owns the WebView and its thread. */
    private val reply: (script: String) -> Unit,
    /** Load a server after it was activated. The Activity owns the cookie jar. */
    private val onActivate: (url: String) -> Unit,
    /** The platform half of the console's two notification commands. */
    private val notifier: ShellNotifier,
) {

    @JavascriptInterface
    fun post(method: String, id: String, params: String) {
        val numericId = id.toIntOrNull()
        // No id means no one is waiting for the answer — there is nothing to
        // reply to, and answering an invented id would resolve somebody else's
        // promise.
        if (numericId == null) return
        val fields = decode(params)
        work.execute {
            // Notifications are answered here rather than in the switch below:
            // they are a pure function of the notifier (see NotificationCommands),
            // and keeping them out of the server switch is what lets the wire be
            // tested without an Android Context.
            val notification = NotificationCommands.answer(method, fields, notifier)
            if (notification != null) {
                answer(numericId, ok = true, notification)
                return@execute
            }
            when (method) {
                "servers_state" -> answerState(numericId)
                "servers_add" -> add(numericId, fields)
                "servers_remove" -> remove(numericId, fields)
                "servers_activate" -> activate(numericId, fields)
                // A page asking for a command this shell does not have is NOT a
                // crash: it is a refusal the console shows, which is how a newer
                // console degrades on an older APK.
                else -> answer(
                    numericId,
                    ok = false,
                    quote("This shell does not support $method."),
                )
            }
        }
    }

    private fun answerState(id: Int) {
        val list = ServerConfig.servers(context)
        val entries = list.entries.map { stored ->
            val health = HealthProbe.checkNow(stored.url)
            ServerWire.Entry(
                label = stored.label,
                url = stored.url,
                running = health.ok,
                version = health.version,
                mode = health.mode,
                pid = health.pid,
                startedAt = health.startedAt,
            )
        }
        answer(id, ok = true, ServerWire.state(entries, list.activeUrl))
    }

    private fun add(id: Int, fields: Map<String, String>) {
        val raw = fields["url"].orEmpty()
        when (val normalized = UrlNormalizer.normalize(raw)) {
            is NormalizedUrl.Error ->
                answer(id, ok = false, quote(ServerMessages.messageFor(context, normalized.message)))
            is NormalizedUrl.Ok -> {
                val next = ServerConfig.servers(context)
                    .withRemembered(normalized.url, fields["label"])
                ServerConfig.writeServers(context, next)
                answerState(id)
            }
        }
    }

    private fun remove(id: Int, fields: Map<String, String>) {
        val url = fields["id"].orEmpty()
        ServerConfig.writeServers(context, ServerConfig.servers(context).without(url))
        answerState(id)
    }

    private fun activate(id: Int, fields: Map<String, String>) {
        val url = fields["id"].orEmpty()
        val next = ServerConfig.servers(context).withActive(url)
        if (next.activeUrl != url) {
            answer(id, ok = false, quote("That server is not in the list."))
            return
        }
        ServerConfig.writeServers(context, next)
        // The page goes away on navigation, so the state is answered FIRST —
        // otherwise the console's promise never settles and the panel spins.
        answerState(id)
        onActivate(url)
    }

    /** Send one reply, with the payload already a JSON value or quoted string. */
    private fun answer(id: Int, ok: Boolean, payload: String) {
        reply("window.__kabmoReply && window.__kabmoReply($id, $ok, $payload);")
    }

    private fun quote(value: String): String = ServerWire.quote(value)

    companion object {
        /** `label=NAS&url=http%3A%2F%2Fa%3A3000` → the map, empty values dropped. */
        fun decode(form: String): Map<String, String> {
            if (form.isBlank()) return emptyMap()
            val fields = LinkedHashMap<String, String>()
            for (pair in form.split('&')) {
                if (pair.isEmpty()) continue
                val split = pair.indexOf('=')
                val key = if (split < 0) pair else pair.substring(0, split)
                val value = if (split < 0) "" else pair.substring(split + 1)
                fields[URLDecoder.decode(key, "UTF-8")] = URLDecoder.decode(value, "UTF-8")
            }
            return fields
        }
    }
}
