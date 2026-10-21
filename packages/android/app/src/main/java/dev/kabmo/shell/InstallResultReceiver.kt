package dev.kabmo.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * The installer's answer, after the session commits.
 *
 * Two jobs, and the first one is not optional: `STATUS_PENDING_USER_ACTION`
 * carries the system's confirmation Intent in `EXTRA_INTENT`, and NOT launching
 * it means the install waits forever on a dialog nobody ever sees. The receiver
 * is declared in the manifest because the install can outlive the Activity —
 * Android kills the process it is replacing, and a receiver registered only in
 * code would be gone by the time the answer arrives.
 */
class InstallResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ApkUpdate.ACTION_INSTALL_STATUS) return

        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            launchConfirmation(context, intent)
            return
        }

        ApkInstaller.deliver(status, message)
    }

    /**
     * Show the system's own "Install this app?" dialog.
     *
     * The Intent comes from the installer, not from us, so nothing here can
     * change what it asks. `NEW_TASK` is required: the receiver holds no
     * Activity, and a broadcast can arrive after the one that started the
     * session is gone.
     */
    private fun launchConfirmation(context: Context, intent: Intent) {
        val confirmation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
        } ?: return

        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(confirmation)
        } catch (_: Exception) {
            // Nothing can show it — the caller is told through the session, which
            // then reports its own failure rather than leaving a silent wait.
            ApkInstaller.deliver(PackageInstaller.STATUS_FAILURE_ABORTED, null)
        }
    }
}
