package dev.kabmo.shell

import android.content.Context

/**
 * The one sentence the shell shows for a refused address.
 *
 * Two surfaces need it — the native settings screen and the console's server
 * panel, which sends the sentence to the page — and it used to live as a private
 * method on the settings Activity. A second copy there would be a second
 * wording for the same refusal, which is exactly how a user sees one screen say
 * "not a host and port" and the other say something else.
 *
 * The codes themselves belong to `UrlNormalizer` (and `HealthProbe` for
 * `not-kabmo`), so this is only the mapping.
 */
object ServerMessages {
    fun messageFor(context: Context, code: String): String = when (code) {
        "empty" -> context.getString(R.string.err_empty)
        "scheme" -> context.getString(R.string.err_scheme)
        "path" -> context.getString(R.string.err_path)
        "shape" -> context.getString(R.string.err_shape)
        "not-kabmo" -> context.getString(R.string.err_not_kabmo)
        else -> context.getString(R.string.err_unreachable)
    }
}