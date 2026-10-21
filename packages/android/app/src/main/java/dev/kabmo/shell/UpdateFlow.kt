package dev.kabmo.shell

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.ProgressBar

/**
 * The user-facing half of an in-app update: progress, refusals, and the one
 * settings screen that can unblock them.
 *
 * Separate from `ApkInstaller` because that object is the mechanism and this one
 * is the conversation — and because `MainActivity` is already the largest file
 * in the shell. The dialog is created once and reused: an update that fails and
 * is retried must not stack a second window over the first.
 */
object UpdateFlow {

    private var dialog: AlertDialog? = null

    /** The `Content-Disposition`/MIME an APK download carried, if any. */
    data class Download(val url: String, val fileName: String)

    /**
     * Run the whole flow for one download: permission, progress, install.
     *
     * Called from the WebView's download listener when the URL is an APK. A
     * refusal that has a fix (the install-unknown-apps toggle) opens that
     * setting rather than only naming it: the user has already said yes twice by
     * this point, and a dead-end message would be the third time.
     */
    fun start(activity: Activity, download: Download) {
        dismiss()

        if (!ApkInstaller.canInstall(activity)) {
            askForInstallPermission(activity)
            return
        }

        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            isIndeterminate = true
            setPadding(dp(activity, 24), dp(activity, 8), dp(activity, 24), 0)
        }

        dialog = AlertDialog.Builder(activity)
            .setTitle(R.string.update_downloading)
            .setView(bar)
            .setNegativeButton(android.R.string.cancel) { _, _ ->
                // Only the WAIT is cancelled. The session may already be
                // committed, in which case the system dialog is the user's to
                // dismiss — cancelling here must not pretend the install stopped.
                ApkInstaller.abandon()
                dialog = null
            }
            .setCancelable(true)
            .show()

        ApkInstaller.start(
            activity = activity,
            url = download.url,
            fileName = download.fileName,
            onProgress = { percent ->
                bar.isIndeterminate = false
                bar.progress = percent
            },
            onResult = { result -> report(activity, result) },
        )
    }

    private fun report(activity: Activity, result: ApkInstaller.Result) {
        // An install outlives the Activity it started from — Android may finish
        // it while the system dialog is up. Showing a dialog on a destroyed
        // Activity is a BadTokenException crash, and it would be a crash caused
        // by a SUCCESSFUL update.
        if (activity.isFinishing || activity.isDestroyed) {
            dismiss()
            return
        }

        when (result) {
            ApkInstaller.Result.AwaitingConfirmation -> {
                // The system dialog is now the surface. Closing ours first is what
                // makes it visible rather than behind a stale progress window.
                dismiss()
            }

            ApkInstaller.Result.Installed -> {
                dismiss()
                // The process is about to be replaced; saying so is the only
                // honest thing to draw, and it keeps the user from tapping the
                // console while its files are being swapped underneath.
                show(activity, activity.getString(R.string.update_installed))
            }

            is ApkInstaller.Result.Failed -> {
                dismiss()
                val message = activity.getString(messageFor(result.failure))
                val detail = result.detail?.takeIf { it.isNotBlank() }
                val body = if (detail != null) "$message\n\n$detail" else message
                show(activity, body, offerSettings = result.failure == ApkUpdate.Failure.BLOCKED)
            }
        }
    }

    /** The sentence for a failure. Every case is named — "something went wrong" is not an answer. */
    fun messageFor(failure: ApkUpdate.Failure): Int = when (failure) {
        ApkUpdate.Failure.DOWNLOAD -> R.string.update_err_download
        ApkUpdate.Failure.NOT_A_PACKAGE -> R.string.update_err_not_a_package
        ApkUpdate.Failure.WRONG_PACKAGE -> R.string.update_err_wrong_package
        ApkUpdate.Failure.NOT_AN_UPGRADE -> R.string.update_err_not_an_upgrade
        ApkUpdate.Failure.NOT_PERMITTED -> R.string.update_err_not_permitted
        ApkUpdate.Failure.SESSION -> R.string.update_err_session
        ApkUpdate.Failure.ABORTED -> R.string.update_err_aborted
        ApkUpdate.Failure.BLOCKED -> R.string.update_err_blocked
        ApkUpdate.Failure.CONFLICT -> R.string.update_err_conflict
        ApkUpdate.Failure.INCOMPATIBLE -> R.string.update_err_incompatible
        ApkUpdate.Failure.INVALID -> R.string.update_err_invalid
        ApkUpdate.Failure.STORAGE -> R.string.update_err_storage
        ApkUpdate.Failure.OTHER -> R.string.update_err_other
    }

    /**
     * Point the user at the per-app "install unknown apps" toggle.
     *
     * The system only exposes this from Settings, so the shell opens the app's
     * own page there — `ACTION_MANAGE_UNKNOWN_APP_SOURCES` with a package URI is
     * the documented route, and the general one is the fallback for a build that
     * refuses it.
     */
    private fun askForInstallPermission(activity: Activity) {
        AlertDialog.Builder(activity)
            .setTitle(R.string.update_permission_title)
            .setMessage(R.string.update_permission_body)
            .setPositiveButton(R.string.update_permission_open) { _, _ ->
                openUnknownSourcesSetting(activity)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun openUnknownSourcesSetting(activity: Activity) {
        val direct = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:${activity.packageName}"))
        try {
            activity.startActivity(direct)
            return
        } catch (_: ActivityNotFoundException) {
            // Older builds expose only the global list.
        }
        try {
            activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            // Nothing to open. The dialog's sentence already named the setting.
        }
    }

    private fun show(activity: Activity, message: String, offerSettings: Boolean = false) {
        val builder = AlertDialog.Builder(activity)
            .setMessage(message)
            .setPositiveButton(android.R.string.ok, null)
        if (offerSettings) {
            builder.setNeutralButton(R.string.update_permission_open) { _, _ ->
                openUnknownSourcesSetting(activity)
            }
        }
        builder.show()
    }

    /**
     * Drop the window and the waiting callback.
     *
     * Called from `MainActivity.onDestroy`: the static `dialog` and the
     * installer's callback both hold an Activity, and the shell is one Activity
     * that is recreated by a process restart.
     */
    fun dismissAll() {
        dismiss()
        ApkInstaller.abandon()
    }

    private fun dismiss() {
        dialog?.dismiss()
        dialog = null
    }

    private fun dp(activity: Activity, value: Int): Int =
        (value * activity.resources.displayMetrics.density).toInt()
}
