package dev.kabmo.shell

/**
 * "Is a newer Kabmo app published?", as pure values.
 *
 * ## Why the console and not GitHub
 *
 * The shell COULD read GitHub's release API directly, and that is exactly the
 * mistake this exists to avoid. The API is unauthenticated at 60 requests an
 * hour **per source IP**, and a phone on mobile data shares that IP with an
 * entire carrier NAT — so a direct read from the device is the least reliable
 * place in the whole system to ask. The console's `/api/updates/android` already
 * answers the same question, already falls back to the public release pages when
 * the API is spent, and already caches the answer for five minutes.
 *
 * The shell therefore reads the server it is already pointed at, which it can
 * reach by definition (it is drawing the console).
 *
 * ## Why these rules are separate from the request
 *
 * Every one below fails SILENTLY on a real device — a comparison that treats
 * `0.6.0` as older than `0.5.9`, a failed probe read as "you are up to date", an
 * offered build Android then refuses with `INSTALL_FAILED_VERSION_DOWNGRADE` —
 * and a JVM test pins all of them without a phone. Nothing here touches the
 * Android framework, which is what makes that possible; the one HTTP call and
 * its JSON decoding live in `AppUpdateCheck`.
 */
object AppRelease {

  /** The published build, as the console reports it. */
  data class Release(val url: String, val latest: String, val releaseUrl: String?)

  /** What a check concluded. Every case is named; "something went wrong" is not an answer. */
  sealed interface Result {
    /** The console answered with a newer build. */
    data class Available(val release: Release, val installed: String) : Result

    /** The console answered, and this build is the published one (or newer). */
    data class Current(val latest: String, val installed: String) : Result

    /** The question could not be asked. */
    data class Failed(val detail: String?) : Result
  }

  /**
   * The conclusion for a parsed release and this build's version.
   *
   * A null release is a FAILED probe, never "current": the console answers
   * `{url: null, latest: null}` when it could not reach GitHub, and reading that
   * as "you are up to date" is precisely the silence this feature exists to end.
   */
  fun decide(release: Release?, installed: String): Result = when {
    release == null -> Result.Failed(null)
    isNewer(release.latest, installed) -> Result.Available(release, installed)
    else -> Result.Current(release.latest, installed)
  }

  /**
   * Whether `candidate` is a newer build than `installed`.
   *
   * Numeric segments, compared left to right with a missing segment counting as
   * zero, and any prerelease suffix ignored — the same comparison the console
   * makes (`src/shared/lib/updates/semver.ts`). The two MUST agree: a shell that
   * thinks `0.6.0` is current while the console offers `0.6.0` shows a button
   * that installs the build already running, and Android then refuses it after
   * the download.
   *
   * A segment that is not a number counts as 0, which is what makes `1.2.x`
   * compare below `1.2.1` instead of throwing.
   */
  fun isNewer(candidate: String, installed: String): Boolean {
    val left = segments(candidate)
    val right = segments(installed)
    for (index in 0 until maxOf(left.size, right.size)) {
      val a = left.getOrElse(index) { 0 }
      val b = right.getOrElse(index) { 0 }
      if (a != b) return a > b
    }
    return false
  }

  /** The numeric segments of a version, with a leading `v` and any suffix dropped. */
  fun segments(version: String): List<Int> {
    var trimmed = version.trim()
    if (trimmed.startsWith("v") || trimmed.startsWith("V")) trimmed = trimmed.substring(1)
    val core = trimmed.substringBefore('-')
    return core.split('.').map { it.trim().toIntOrNull() ?: 0 }
  }

  /** The console route this asks. */
  const val PATH = "/api/updates/android"

  /** The absolute URL for a saved server origin. */
  fun urlFor(baseUrl: String): String = baseUrl.trim().trimEnd('/') + PATH
}
