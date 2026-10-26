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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * The launch overlay: what the shell draws from the tap until the console paints.
 *
 * Without it the app showed a flat rectangle for the whole cold start — the
 * WebView's background colour, with nothing to say whether it was loading,
 * waiting on a server that is down, or already dead. That is the same blank
 * frame the theme's `windowBackground` exists to make seamless, and on a slow
 * LAN or a cold server it is several seconds of it.
 *
 * ## The colours come from the ACTIVE theme
 *
 * Every surface here is painted from a [ShellPalette] — the console's own, read
 * back from the page and stored for the next launch. The overlay shipped with
 * `#FAF8F3`/`#141310` hardcoded, which is the default LIGHT palette's paper:
 * on a dark install that is a paper-white rectangle for the whole cold start,
 * then a jump to a near-black console. [applyPalette] is therefore the entry
 * point that matters, and it can run on a live overlay — the first launch after
 * a theme change has no stored palette, so the console's answer arrives while
 * the overlay it describes is still on screen.
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

    private val wordmark: ImageView
    private val bar: ProgressBar
    private val status: TextView
    private val actions: LinearLayout
    private val retryButton: Button
    private val settingsButton: Button

    /** The colours in force. Replaced by [applyPalette]. */
    private var palette: ShellPalette = ShellPalette.DEFAULT

    /** The state last drawn, so a palette change can repaint the same one. */
    private var state: LoadingState = LoadingState.done()

    /** Called when the user asks to try the address again. */
    var onRetry: (() -> Unit)? = null

    /** Called when the user gives up and wants the server settings screen. */
    var onOpenSettings: (() -> Unit)? = null

    init {
        isClickable = true // swallows taps meant for the half-painted page

        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(32), 0, dp(32), 0)
        }

        // The wordmark is the ARTWORK, not the app's name in a text view: it is
        // the same lockup README.md embeds (`public/kabmo-wordmark.svg`),
        // carried here as a VectorDrawable because a launch overlay is native
        // views and has no renderer for SVG. `app_name` stays the accessibility
        // name — the drawable's job is to be the mark, not to replace the word
        // for a screen reader.
        wordmark = ImageView(context).apply {
            setImageResource(R.drawable.kabmo_wordmark)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = context.getString(R.string.app_name)
        }

        bar = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            isIndeterminate = true
        }

        status = TextView(context).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
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

        // 180dp wide is the drawable's own intrinsic width, so the lockup lands
        // at 57.83dp tall (486.38 x 156.25 viewport). Fixed rather than
        // `WRAP_CONTENT` so the column's height does not depend on how a given
        // platform measures a vector's intrinsic bounds.
        column.addView(
            wordmark,
            LinearLayout.LayoutParams(dp(180), dp(58)),
        )
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

        applyPalette(ShellPalette.DEFAULT)
        render(LoadingState.done())
    }

    /**
     * Repaint in `next`, keeping whatever state is on screen.
     *
     * The one entry point for colour, and it re-renders rather than only setting
     * fields: the failure sentence's colour depends on the state AND the
     * palette, so a palette applied between two renders has to redo both.
     */
    fun applyPalette(next: ShellPalette) {
        palette = next
        setBackgroundColor(Color.parseColor(next.canvas))
        val ink = ColorStateList.valueOf(Color.parseColor(next.ink))
        bar.progressTintList = ink
        bar.indeterminateTintList = ink
        for (button in listOf(retryButton, settingsButton)) {
            val filled = button === retryButton
            button.setTextColor(Color.parseColor(if (filled) next.canvas else next.ink))
            button.background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor(if (filled) next.ink else next.paper))
                setStroke(dp(1), Color.parseColor(next.hairline))
            }
        }
        render(state)
    }

    /**
     * Draw a state. The single entry point, so no caller can leave the overlay
     * half-updated — the bar, the sentence and the actions always describe one
     * `LoadingState`.
     */
    fun render(state: LoadingState) {
        this.state = state
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
            Color.parseColor(if (failed) palette.error else palette.muted),
        )
    }

    private fun failureMessage(failure: LoadingState.Failure): Int = when (failure) {
        LoadingState.Failure.HOST_LOOKUP -> R.string.load_err_host
        LoadingState.Failure.CONNECT -> R.string.load_err_connect
        LoadingState.Failure.TIMEOUT -> R.string.load_err_timeout
        LoadingState.Failure.SSL -> R.string.load_err_ssl
        LoadingState.Failure.OTHER -> R.string.load_err_other
    }

    /** An outlined button; [applyPalette] supplies both its colours. */
    private fun button(text: String, filled: Boolean): Button = Button(context).apply {
        this.text = text
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
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
