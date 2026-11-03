package dev.kabmo.shell

/**
 * Where one navigation goes, as a pure rule.
 *
 * The same table every other shell carries (`packages/macos/Sources/KabmoDesktop/
 * NavigationPolicy.swift`, `packages/linux/src/navigation.rs`), restated here
 * because Android's callback is a different shape: `shouldOverrideUrlLoading`
 * returns a boolean and the shell also has an APK offer to finish itself.
 *
 * The case this exists for is the FIRST one — `subframe`. The console embeds the
 * user's own browser as an `<iframe>` (`components/workspace/user-browser-panel/`),
 * and Android documents this callback as "may be called for subframes". Answering
 * it the way a main-frame link is answered sent every page typed into that panel
 * to the system browser instead of the panel.
 *
 * A pure object rather than inline `if`s in the client, for the usual reason: the
 * decision fails silently in the app — nothing throws, a page just appears
 * somewhere else — so it is pinned by `NavigationPolicyTest`.
 */
object NavigationPolicy {

    enum class Action {
        /** Load it here. */
        ALLOW,

        /** Hand it to the system: no page behind it, or it belongs on the web. */
        EXTERNAL,

        /** The console's own update offer: the shell installs it. */
        APK_DOWNLOAD,
    }

    /**
     * The action for a navigation.
     *
     * @param isForMainFrame the document itself, or an embedded frame.
     * @param isInternal whether the URL shares the shell's server origin.
     * @param isApkDownload whether the console's update control pointed at an APK.
     */
    fun decide(
        isForMainFrame: Boolean,
        isInternal: Boolean,
        isApkDownload: Boolean,
        scheme: String?,
    ): Action {
        // A frame is never a place to leave from: whatever an embedded page does
        // is that page's own content.
        if (!isForMainFrame) return Action.ALLOW

        // A scheme with no page behind it — `mailto:`, `tel:`, an app link — is
        // the OS's.
        val normalized = scheme?.lowercase()
        if (normalized != "http" && normalized != "https") return Action.EXTERNAL

        if (isInternal) return Action.ALLOW

        // Checked before the external answer because the offer is finished HERE:
        // sending it to a browser makes the user find the file in Downloads.
        if (isApkDownload) return Action.APK_DOWNLOAD

        return Action.EXTERNAL
    }
}
