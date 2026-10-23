package dev.kabmo.shell

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The native server-settings screen.
 *
 * Built from platform views rather than Compose or Material: the whole app is one
 * WebView plus this form, and pulling in a UI toolkit for two text fields and
 * three buttons would dwarf the shell it is drawing.
 *
 * The screen exists because the WebView fills the display — Kabmo's own Settings
 * modal is reachable, but only after the server is reachable, which is exactly
 * the case a wrong URL breaks. This screen is the way back, from the edge tab or
 * the launcher shortcut.
 */
class SettingsActivity : Activity() {

    private lateinit var urlField: EditText
    private lateinit var status: TextView
    private lateinit var testButton: Button
    private lateinit var saveButton: Button
    private lateinit var updateButton: Button
    private lateinit var updateStatus: TextView

    /** The slider's current value; written through on every user change. */
    private var zoomPercent = ServerConfig.ZOOM_DEFAULT

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // BEFORE the view tree: `zoomSection()` builds its slider from this
        // field, and reading it after the call left the thumb on the default
        // while the saved value was already 170 — measured on a real device.
        zoomPercent = ServerConfig.zoom(this)

        val scroll = ScrollView(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }
        scroll.addView(column)

        column.addView(title())
        column.addView(label(getString(R.string.url_label)))
        column.addView(urlInput())
        column.addView(hint(getString(R.string.url_help)))

        status = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#5A554A"))
            setPadding(0, dp(12), 0, 0)
        }
        column.addView(status)

        column.addView(cleartextNotice())

        // Zoom sits ABOVE the actions: it applies on the spot (no health check,
        // no reload), so it is not part of "connect to a server" and must not
        // read as a field the Connect button submits.
        column.addView(zoomSection())

        // The APP's own update, above the actions: it is not part of "connect to
        // a server", and it is the one answer this screen can give that the
        // console behind it cannot.
        column.addView(updateSection())

        column.addView(actions())

        column.addView(
            hint(getString(R.string.shortcut_hint)).apply {
                setPadding(0, dp(20), 0, 0)
            },
        )

        setContentView(scroll)

        val existing = ServerConfig.read(this)
        if (existing != null) {
            urlField.setText(existing)
            urlField.setSelection(existing.length)
        }

        testButton.setOnClickListener { runHealthCheck() }
        saveButton.setOnClickListener { save() }
    }

    private fun title(): TextView = TextView(this).apply {
        text = getString(R.string.settings_title)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        setTextColor(Color.parseColor("#141310"))
        setPadding(0, 0, 0, dp(20))
    }

    private fun label(text: String): TextView = TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setTextColor(Color.parseColor("#141310"))
        setPadding(0, 0, 0, dp(6))
    }

    private fun hint(text: String): TextView = TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        setTextColor(Color.parseColor("#7A7468"))
        setPadding(0, dp(6), 0, 0)
    }

    private fun urlInput(): EditText = EditText(this).apply {
        inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT
        hint = getString(R.string.url_hint)
        isSingleLine = true
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(Color.parseColor("#141310"))
        background = GradientDrawable().apply {
            cornerRadius = dp(8).toFloat()
            setColor(Color.parseColor("#FFFFFF"))
            setStroke(dp(1), Color.parseColor("#D9D4C7"))
        }
        setPadding(dp(12), dp(10), dp(12), dp(10))
        urlField = this
    }

    /**
     * Page zoom: a `SeekBar` with a live percentage and a reset.
     *
     * A slider rather than a text field because the value is a size the user is
     * judging by eye, not a number they know: the range from 50% to 200% can be
     * explored in one drag, and the percent is printed as the thumb moves so the
     * exact value is readable rather than guessed. It saves on EVERY change — no
     * Apply button — since the effect is visible in the console behind this
     * screen, and a value that needed confirming would be a value the user could
     * not preview.
     *
     * `SeekBar` is the platform widget (no Material, no AndroidX): it is a
     * `ProgressBar` with a thumb and a drag gesture, which is the whole job.
     */
    private fun zoomSection(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(20), 0, 0)

        val header = LinearLayout(this@SettingsActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val label = label(getString(R.string.zoom_label))
        label.setPadding(0, 0, 0, 0)
        header.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val value = TextView(this@SettingsActivity).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#141310"))
            text = getString(R.string.zoom_value, zoomPercent)
        }
        header.addView(value)
        addView(header)

        // The range the slider reports, so `onProgressChanged` can map a
        // position back to a percent without arithmetic scattered at two sites.
        val steps = (ServerConfig.ZOOM_MAX - ServerConfig.ZOOM_MIN) / ServerConfig.ZOOM_STEP
        val slider = android.widget.SeekBar(this@SettingsActivity).apply {
            max = steps
            progress = (zoomPercent - ServerConfig.ZOOM_MIN) / ServerConfig.ZOOM_STEP
            setPadding(0, dp(8), 0, 0)
        }
        slider.setOnSeekBarChangeListener(object : android.widget.SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: android.widget.SeekBar, progress: Int, fromUser: Boolean) {
                val percent = ServerConfig.ZOOM_MIN + progress * ServerConfig.ZOOM_STEP
                zoomPercent = percent
                value.text = getString(R.string.zoom_value, percent)
                if (fromUser) ServerConfig.writeZoom(this@SettingsActivity, percent)
            }

            override fun onStartTrackingTouch(bar: android.widget.SeekBar) = Unit
            override fun onStopTrackingTouch(bar: android.widget.SeekBar) = Unit
        })
        addView(slider, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        addView(hint(getString(R.string.zoom_help)))

        addView(
            button(getString(R.string.zoom_reset), filled = false) {
                zoomPercent = ServerConfig.ZOOM_DEFAULT
                ServerConfig.writeZoom(this@SettingsActivity, ServerConfig.ZOOM_DEFAULT)
                slider.progress = (ServerConfig.ZOOM_DEFAULT - ServerConfig.ZOOM_MIN) / ServerConfig.ZOOM_STEP
                value.text = getString(R.string.zoom_value, ServerConfig.ZOOM_DEFAULT)
            }.apply { setPadding(0, dp(10), 0, 0) },
        )
    }

    /**
     * The cleartext trade is stated on screen, not buried in a README: a user who
     * types an `http://` LAN address is sending their password in the open, and
     * loses voice dictation without being told why.
     */
    private fun cleartextNotice(): TextView = TextView(this).apply {
        text = getString(R.string.cleartext_warning)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        setTextColor(Color.parseColor("#8A5A00"))
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = GradientDrawable().apply {
            cornerRadius = dp(8).toFloat()
            setColor(Color.parseColor("#FFF4DC"))
            setStroke(dp(1), Color.parseColor("#E8D4A8"))
        }
    }

    private fun actions(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.START
        setPadding(0, dp(20), 0, 0)

        testButton = button(getString(R.string.test_button), filled = false)
        saveButton = button(getString(R.string.save_button), filled = true)
        addView(testButton)
        addView(saveButton)
        addView(button(getString(R.string.clear_cookies), filled = false) { clearCookies() })
    }

    /**
     * "Check for update" — the app's OWN version, not the server's.
     *
     * Two versions are on this screen and they are different products: the
     * console behind the WebView, and this APK. The health check above answers
     * for the server; this answers for the app, which is the one thing a user
     * cannot otherwise discover — the sidebar's offer only appears once the
     * console has loaded, which is exactly what a stale shell may fail to do.
     *
     * The check reads the CONSOLE's route rather than GitHub (see `AppRelease`):
     * the console already falls back to the public release pages when GitHub's
     * per-IP API quota is spent, which on mobile data it routinely is.
     *
     * It uses the address SAVED, falling back to the one typed in the field, so
     * a first-run user who has not connected yet can still ask.
     */
    private fun updateSection(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(24), 0, 0)

        addView(label(getString(R.string.update_section)))

        val installed = TextView(this@SettingsActivity).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#5A554A"))
            text = getString(R.string.update_installed_version, BuildConfig.VERSION_NAME)
            setPadding(0, dp(4), 0, 0)
        }
        addView(installed)

        updateStatus = TextView(this@SettingsActivity).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#5A554A"))
            setPadding(0, dp(8), 0, 0)
        }
        addView(updateStatus)

        val row = LinearLayout(this@SettingsActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START
            setPadding(0, dp(10), 0, 0)
        }
        updateButton = button(getString(R.string.update_check), filled = false) { checkForUpdate() }
        row.addView(updateButton)
        addView(row)
    }

    /**
     * Ask the console, and either report the answer or offer the install.
     *
     * A newer build is not installed from here directly: it becomes a button
     * that hands the artifact to the same `UpdateFlow` the sidebar uses, so the
     * permission prompt, the progress bar and every failure sentence are the one
     * implementation rather than a second copy on this screen.
     */
    private fun checkForUpdate() {
        val typed = UrlNormalizer.normalize(urlField.text.toString())
        val base = ServerConfig.read(this)
            ?: (typed as? NormalizedUrl.Ok)?.url
        if (base == null) {
            reportUpdate(getString(R.string.update_need_server), error = true)
            return
        }

        updateButton.isEnabled = false
        reportUpdate(getString(R.string.update_checking))

        AppUpdateCheck.check(base, BuildConfig.VERSION_NAME) { result ->
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                updateButton.isEnabled = true
                when (result) {
                    is AppRelease.Result.Available -> offerUpdate(result.release)

                    is AppRelease.Result.Current -> reportUpdate(
                        getString(R.string.update_current, result.installed),
                    )

                    is AppRelease.Result.Failed -> reportUpdate(
                        getString(R.string.update_check_failed),
                        error = true,
                    )
                }
            }
        }
    }

    /** Turn the check's answer into an install button, in the same row. */
    private fun offerUpdate(release: AppRelease.Release) {
        reportUpdate(getString(R.string.update_available, release.latest, BuildConfig.VERSION_NAME))

        updateButton.text = getString(R.string.update_install, release.latest)
        updateButton.isEnabled = true
        updateButton.setOnClickListener {
            UpdateFlow.start(this, UpdateFlow.Download(release.url, ApkUpdate.fileNameFrom(null, release.url)))
        }
    }

    private fun reportUpdate(text: String, error: Boolean = false) {
        updateStatus.setTextColor(Color.parseColor(if (error) "#B3261E" else "#5A554A"))
        updateStatus.text = text
    }

    private fun button(text: String, filled: Boolean, onClick: (() -> Unit)? = null): Button =
        Button(this).apply {
            this.text = text
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor(if (filled) "#FAF8F3" else "#141310"))
            background = GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor(if (filled) "#141310" else "#FFFFFF"))
                setStroke(dp(1), Color.parseColor("#D9D4C7"))
            }
            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            params.rightMargin = dp(8)
            layoutParams = params
            if (onClick != null) setOnClickListener { onClick() }
        }

    private fun runHealthCheck() {
        val normalized = UrlNormalizer.normalize(urlField.text.toString())
        if (normalized is NormalizedUrl.Error) {
            showError(messageFor(normalized.message))
            return
        }
        val base = (normalized as NormalizedUrl.Ok).url

        setBusy(true)
        status.text = getString(R.string.testing)
        status.setTextColor(Color.parseColor("#5A554A"))

        HealthProbe.check(base) { result ->
            runOnUiThread {
                setBusy(false)
                if (result.ok) {
                    status.setTextColor(Color.parseColor("#0B5D3B"))
                    status.text = when {
                        result.mock -> getString(
                            R.string.ok_connected_mock,
                            result.version ?: "?",
                            result.port,
                        )
                        result.authEnabled -> getString(
                            R.string.ok_connected_auth,
                            result.version ?: "?",
                            result.port,
                        )
                        else -> getString(
                            R.string.ok_connected,
                            result.version ?: "?",
                            result.port,
                        )
                    }
                } else {
                    showError(messageFor(result.message))
                }
            }
        }
    }

    /**
     * Save is gated on a passing health check.
     *
     * Saving an unreachable URL leaves the user staring at a blank shell with no
     * explanation, and the next launch has no way to tell a wrong address from a
     * stopped server. The check is cheap (one dependency-free route) and the
     * screen already has to run it to show a version.
     *
     * **The cookies are cleared only when the ORIGIN changes.** A cookie is
     * scoped to a host and port, so the same address keeps its session — and
     * this screen is also where the zoom slider lives, so pressing Connect after
     * adjusting the zoom used to sign the user out of the server they were
     * already on. The address is what makes a stale cookie wrong; nothing else
     * on this screen does.
     */
    private fun save() {
        val normalized = UrlNormalizer.normalize(urlField.text.toString())
        if (normalized is NormalizedUrl.Error) {
            showError(messageFor(normalized.message))
            return
        }
        val base = (normalized as NormalizedUrl.Ok).url
        val previous = ServerConfig.read(this)

        setBusy(true)
        status.text = getString(R.string.testing)
        status.setTextColor(Color.parseColor("#5A554A"))

        HealthProbe.check(base) { result ->
            runOnUiThread {
                setBusy(false)
                if (!result.ok) {
                    showError(messageFor(result.message))
                    return@runOnUiThread
                }
                ServerConfig.write(this, base)
                if (!UrlNormalizer.sameOrigin(previous, base)) {
                    CookieManager.getInstance().removeAllCookies(null)
                    CookieManager.getInstance().flush()
                }
                startActivity(Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                })
                finish()
            }
        }
    }

    private fun clearCookies() {
        AlertDialog.Builder(this)
            .setTitle(R.string.clear_cookies)
            .setMessage("Sign out of this server on this device?")
            .setPositiveButton(android.R.string.ok) { _, _ ->
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                status.setTextColor(Color.parseColor("#5A554A"))
                status.text = "Cookies cleared."
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun setBusy(busy: Boolean) {
        testButton.isEnabled = !busy
        saveButton.isEnabled = !busy
    }

    private fun showError(message: String) {
        status.setTextColor(Color.parseColor("#B3261E"))
        status.text = message
    }

    private fun messageFor(code: String): String = when (code) {
        "empty" -> getString(R.string.err_empty)
        "scheme" -> getString(R.string.err_scheme)
        "path" -> getString(R.string.err_path)
        "shape" -> getString(R.string.err_shape)
        "not-kabmo" -> getString(R.string.err_not_kabmo)
        else -> getString(R.string.err_unreachable)
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()
}
