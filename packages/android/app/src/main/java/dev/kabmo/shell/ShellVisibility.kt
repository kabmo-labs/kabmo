package dev.kabmo.shell

/**
 * Whether the console is in front of the user right now.
 *
 * The two halves of notification delivery must not both post. The page posts
 * from its realtime socket while it is visible; the watcher posts from the
 * server's stream while it is not. Without this flag both fire for the same
 * event — the same tag and id, so the shade shows one banner, but the second
 * `notify` is a second alert the platform may or may not suppress, and the
 * watcher's connection is work the page has already done.
 *
 * Set from `MainActivity.onStart`/`onStop`, which is the window in which the
 * page can actually receive a frame: a paused-but-visible activity (a dialog, a
 * system prompt) still has a live socket, so `onPause` would be too early.
 */
object ShellVisibility {

    @Volatile
    var isVisible: Boolean = false
}
