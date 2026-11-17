package dev.kabmo.shell

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
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
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

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

    /** The pasted pairing link; see `pairSection`. */
    private lateinit var pairField: EditText

    /** The background-delivery switch; see `backgroundSection`. */
    private lateinit var backgroundSwitch: Switch

    /** The scanner's request code. */
    private val REQUEST_SCAN = 0x4b45

    /** Asking for `POST_NOTIFICATIONS` on behalf of the background switch. */
    private val REQUEST_NOTIFICATIONS = 0x4b46

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
        column.addView(pairSection())
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

        // Background delivery sits with the other device-local switches, not
        // with "connect to a server": it is this shell's opt-in to an ongoing
        // notification, and the console's own switches cannot turn it on.
        column.addView(backgroundSection())

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
     * The opt-in for background delivery, and the row it costs.
     *
     * Android requires a foreground service to show an ongoing notification, so
     * the watcher that keeps banners arriving while Kabmo is closed cannot hide
     * its own row. It used to run whenever the console's notification switches
     * were on, which put a permanent "Agent notifications are on" notification
     * on every install; the switch is now the user's, it is off by default, and
     * the hint states the row as the price rather than discovering it later.
     *
     * `setBackgroundWanted` starts or stops the service itself, so the visible
     * result is immediate — and a switch that could not post (no permission)
     * flips back rather than reading "on" over a row that will never appear.
     */
    private fun backgroundSection(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(20), 0, 0)

        val header = LinearLayout(this@SettingsActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val label = label(getString(R.string.background_label))
        label.setPadding(0, 0, 0, 0)
        header.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        backgroundSwitch = Switch(this@SettingsActivity).apply {
            isChecked = AndroidWatch.backgroundWanted(this@SettingsActivity)
            setOnCheckedChangeListener { _, checked -> onBackgroundToggled(checked) }
        }
        header.addView(backgroundSwitch)
        addView(header)

        addView(hint(getString(R.string.background_help)))
    }

    /**
     * The switch's one effect, in the order the two gates are met.
     *
     * A switch that is on but silent is the failure this screen must not show,
     * so both reasons are reported: the OS grant is asked for (and its refusal
     * flips the switch back), and a console with no event switched on is named
     * rather than left as a row that never arrives.
     */
    private fun onBackgroundToggled(checked: Boolean) {
        AndroidWatch.setBackgroundWanted(this, checked)
        if (!checked) return
        if (askNotificationPermission()) return
        if (!AndroidWatch.armed(this)) {
            Toast.makeText(this, getString(R.string.background_needs_events), Toast.LENGTH_LONG).show()
        }
    }

    /**
     * The watch cannot post without `POST_NOTIFICATIONS`, and a switch that is
     * on while the system drops every banner is the failure this screen exists
     * to prevent. The request belongs on the switch that needs it; true means a
     * prompt is coming and `onRequestPermissionsResult` will report the answer.
     */
    private fun askNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        // Only the runtime permission is askable here. A per-app toggle that is
        // off is a settings screen, not a prompt — `notification_state` reports
        // it as denied and the console sends the user there.
        if (NotificationPoster.hasPostPermission(this)) return false
        requestPermissions(
            arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
            REQUEST_NOTIFICATIONS,
        )
        return true
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_NOTIFICATIONS) return
        if (NotificationPoster.isGranted(this)) {
            // A grant is the one moment the start can succeed, and nothing else
            // retries it until the next resume.
            AndroidWatch.rearm(this)
            if (!AndroidWatch.armed(this)) {
                Toast.makeText(this, getString(R.string.background_needs_events), Toast.LENGTH_LONG).show()
            }
            return
        }
        // A refusal is reported and the switch returns to off: an on switch with
        // no row and no banner is the silent failure this screen must not show.
        backgroundSwitch.isChecked = false
        Toast.makeText(this, getString(R.string.background_denied), Toast.LENGTH_LONG).show()
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
     * **No cookies are touched.** A cookie is scoped to its host, and the session
     * cookie is named per port (`omp_session_<port>`), so an address that changed
     * cannot receive the previous server's session and the previous server keeps
     * the login that going back should restore. Clearing the jar here signed the
     * user out of EVERY server in the list, which is the reported "the login is
     * gone after switching". This screen is also where the zoom slider lives, so
     * it used to sign the user out for adjusting the zoom; the explicit
     * "Clear cookies" button is the one gesture that ends a session.
     */
    /**
     * Pairing: paste the link the server's Connect page copied.
     *
     * This is the path that needs no password and no typed address. The link is
     * loaded in THIS app's WebView rather than handed to a browser, because the
     * cookie the server's `/pair` page receives lands in the jar of whichever
     * app opened it — pairing in Chrome would leave this shell still asking for
     * a password.
     *
     * The origin is stored here so the shell has an address even if the page
     * never finishes; the link itself travels as an extra and is loaded by
     * `MainActivity`.
     */
    private fun pairSection(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, 0, 0, dp(20))

        addView(label(getString(R.string.pair_label)))
        pairField = EditText(this@SettingsActivity).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT
            hint = getString(R.string.pair_hint)
            isSingleLine = true
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.parseColor("#141310"))
            background = GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#FFFFFF"))
                setStroke(dp(1), Color.parseColor("#D9D4C7"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        addView(pairField)
        addView(hint(getString(R.string.pair_help)))
        addView(
            LinearLayout(this@SettingsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(10), 0, 0)
                addView(button(getString(R.string.scan_button), filled = false) { scan() })
                addView(button(getString(R.string.pair_button), filled = true) { pair() })
            },
        )
    }

    /**
     * Open the shell's own scanner.
     *
     * The camera lives in `QrScannerActivity` rather than here because a preview
     * needs the whole screen and its own permission prompt; this screen is a form.
     * The decoded text comes back as a pairing link and lands in the field, so
     * there is ONE submit path — the same `pair()` the paste uses.
     */
    private fun scan() {
        startActivityForResult(Intent(this, QrScannerActivity::class.java), REQUEST_SCAN)
    }

    @Deprecated("Deprecated in the platform, still the only callback path below API 33")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_SCAN) return
        if (resultCode != RESULT_OK) {
            // The scanner draws its own refusal; nothing to add here.
            return
        }
        val link = data?.getStringExtra(QrScannerActivity.EXTRA_LINK)?.trim().orEmpty()
        if (link.isEmpty()) return
        pairField.setText(link)
        pair()
    }

    private fun pair() {
        val raw = pairField.text.toString().trim()
        val origin = PairingLink.originOf(raw)
        if (origin == null) {
            showError(getString(R.string.pair_not_a_link))
            return
        }
        ServerConfig.write(this, origin)
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(MainActivity.EXTRA_PAIR_LINK, raw)
            },
        )
        finish()
    }

    private fun save() {
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
                if (!result.ok) {
                    showError(messageFor(result.message))
                    return@runOnUiThread
                }
                ServerConfig.write(this, base)
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

    /**
     * The refusal's sentence. Shared with the console's server panel, which sends
     * the same words to the page — one mapping, so the two surfaces cannot word
     * the same refusal differently.
     */
    private fun messageFor(code: String): String = ServerMessages.messageFor(this, code)

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()
}
