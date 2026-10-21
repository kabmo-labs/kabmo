package dev.kabmo.shell

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * The launch overlay: what the shell draws from the tap until the console paints.
 *
 * Without it the app showed a flat paper rectangle for the whole cold start —
 * the WebView's background colour, with nothing to say whether it was loading,
 * waiting on a server that is down, or already dead. That is the same blank
 * frame the theme's `windowBackground` exists to make seamless, and on a slow
 * LAN or a cold server it is several seconds of it.
 *
 * Built from platform views, like the settings screen: the whole app is one
 * WebView, and a toolkit for three widgets would dwarf the shell.
 *
 * The overlay is a SIBLING of the WebView in a `FrameLayout`, never a view
 * inside the page. The page cannot be relied on to report its own readiness
 * (its bundle is what renders the app), and an overlay drawn by the page would
 * disappear exactly when the page fails to load.
 */
class LoadingOverlay(context: Context) : FrameLayout(context) {

    private val wordmark: TextView
    private val bar: ProgressBar
    private val status: TextView
    private val actions: LinearLayout
    private val retryButton: Button
    private val settingsButton: Button

    /** Called when the user asks to try the address again. */
    var onRetry: (() -> Unit)? = null

    /** Called when the user gives up and wants the server settings screen. */
    var onOpenSettings: (() -> Unit)? = null

    init {
        setBackgroundColor(Color.parseColor("#FAF8F3"))
        isClickable = true // swallows taps meant for the half-painted page

        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(32), 0, dp(32), 0)
        }

        wordmark = TextView(context).apply {
            text = context.getString(R.string.app_name)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTextColor(Color.parseColor("#141310"))
            gravity = Gravity.CENTER
        }

        bar = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            isIndeterminate = true
            progressTintList = ColorStateList.valueOf(Color.parseColor("#141310"))
            indeterminateTintList = ColorStateList.valueOf(Color.parseColor("#141310"))
        }

        status = TextView(context).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#5A554A"))
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }

        retryButton = button(context.getString(R.string.load_retry), filled = true)
        settingsButton = button(context.getString(R.string.load_settings), filled = false)
        retryButton.setOnClickListener { onRetry?.invoke() }
        settingsButton.setOnClickListener { onOpenSettings?.invoke() }

        actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
            addView(retryButton)
            addView(settingsButton)
            visibility = View.GONE
        }

        column.addView(wordmark)
        column.addView(
            bar,
            LinearLayout.LayoutParams(dp(180), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(16)
            },
        )
        column.addView(status)
        column.addView(actions)

        addView(
            column,
            LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER),
        )

        render(LoadingState.done())
    }

    /**
     * Draw a state. The single entry point, so no caller can leave the overlay
     * half-updated — the bar, the sentence and the actions always describe one
     * `LoadingState`.
     */
    fun render(state: LoadingState) {
        visibility = if (state.visible) View.VISIBLE else View.GONE
        if (!state.visible) return

        val failed = state.phase == LoadingState.Phase.FAILED
        actions.visibility = if (failed) View.VISIBLE else View.GONE

        // A determinate bar at 0 is the "stuck" look this overlay exists to
        // remove, so the connecting phase keeps it sweeping until a real
        // percentage arrives — and a FAILED load hides it entirely, because a
        // frozen partial bar says "still working" over a message that says the
        // opposite.
        bar.visibility = if (failed) View.GONE else View.VISIBLE
        bar.isIndeterminate = state.indeterminate
        if (!state.indeterminate) bar.progress = state.percent

        status.text = when (state.phase) {
            LoadingState.Phase.CONNECTING -> context.getString(R.string.load_connecting)
            LoadingState.Phase.LOADING -> context.getString(R.string.load_progress, state.percent)
            LoadingState.Phase.FAILED -> context.getString(
                failureMessage(state.failure ?: LoadingState.Failure.OTHER),
            )
            LoadingState.Phase.DONE -> ""
        }
        status.setTextColor(
            Color.parseColor(if (failed) "#B3261E" else "#5A554A"),
        )
    }

    private fun failureMessage(failure: LoadingState.Failure): Int = when (failure) {
        LoadingState.Failure.HOST_LOOKUP -> R.string.load_err_host
        LoadingState.Failure.CONNECT -> R.string.load_err_connect
        LoadingState.Failure.TIMEOUT -> R.string.load_err_timeout
        LoadingState.Failure.SSL -> R.string.load_err_ssl
        LoadingState.Failure.OTHER -> R.string.load_err_other
    }

    private fun button(text: String, filled: Boolean): Button = Button(context).apply {
        this.text = text
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setTextColor(Color.parseColor(if (filled) "#FAF8F3" else "#141310"))
        background = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(8).toFloat()
            setColor(Color.parseColor(if (filled) "#141310" else "#FFFFFF"))
            setStroke(dp(1), Color.parseColor("#D9D4C7"))
        }
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { rightMargin = dp(8) }
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()
}
