/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The launch surface, from the tap until the console paints.
 *
 * A page cannot report its own readiness — its bundle is what renders the app —
 * and a splash drawn BY the page would vanish exactly when the page fails to
 * load. So this is a sibling of the webview, owned by the shell.
 *
 * The same four things the Android, iOS and macOS shells draw, in the same order:
 * the README's wordmark, a progress bar, one sentence, and — on a failure — Retry.
 * Every state decision is `SplashState`'s and this class only draws it, because
 * the orderings that fail (a late estimate resurrecting a finished splash, an
 * error page's own completion) are not visible in a view.
 *
 * **The bar SWEEPS here rather than filling.** WebView2 exposes no progress
 * estimate at all — `NavigationStarting`, `ContentLoading`, `DOMContentLoaded` and
 * `NavigationCompleted` are the whole lifecycle, with nothing in between — so a
 * percentage would have to be invented, and a bar that fills on a timer is a bar
 * that lies about a slow server. The indeterminate bar is the same promise the
 * other shells make before their first estimate arrives.
 */

using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace KabmoDesktop.App;

public sealed class SplashView : Grid
{
    private readonly TextBlock _status;
    private readonly Button _retry;
    private readonly ProgressBar _bar;
    private readonly Viewbox _wordmark;

    /// <summary>The state last drawn, so a palette change can repaint the same one.</summary>
    private SplashState _state = SplashState.Done;

    /// <summary>The colours in force. Replaced by <see cref="ApplyPalette"/>.</summary>
    public ShellPalette Palette { get; private set; } = ShellPalette.Shipped;

    public SplashView()
    {

        // The wordmark is the ARTWORK, not the app's name in a TextBlock: it is the
        // same lockup README.md embeds (`public/kabmo-wordmark.svg`), rebuilt from
        // the SVG's own path data because WPF has no SVG renderer.
        _wordmark = new Viewbox
        {
            Width = 180,
            Height = 58,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = WordmarkArt.Build(),
            // A screen reader gets the name from the mark's own label.
            ToolTip = "Kabmo",
        };
        System.Windows.Automation.AutomationProperties.SetName(_wordmark, "Kabmo");

        _bar = new ProgressBar
        {
            Width = 180,
            Height = 4,
            Margin = new Thickness(0, 16, 0, 0),
            IsIndeterminate = true,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        _status = new TextBlock
        {
            Text = SplashState.Connecting.Sentence(),
            FontSize = 12,
            Margin = new Thickness(0, 10, 0, 0),
            MaxWidth = 460,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        _retry = new Button
        {
            Content = "Retry",
            Margin = new Thickness(0, 18, 0, 0),
            Padding = new Thickness(16, 6, 16, 6),
            HorizontalAlignment = HorizontalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        _retry.Click += (_, _) => Retry();

        var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(_wordmark);
        stack.Children.Add(_bar);
        stack.Children.Add(_status);
        stack.Children.Add(_retry);
        Children.Add(stack);

        ApplyPalette(ShellPalette.Shipped);
        Render(SplashState.Done);
    }

    /// <summary>
    /// Repaint every surface from <paramref name="palette"/>, keeping the state on
    /// screen.
    ///
    /// The single entry point for COLOUR, and it can run on a live splash: a theme
    /// changed in Settings is exactly the case where the stored palette is stale
    /// and the splash it describes is still on screen. The background used to be a
    /// literal `#FAF8F3` — the default LIGHT palette's paper — so a dark console
    /// opened on a paper-white rectangle.
    /// </summary>
    public void ApplyPalette(ShellPalette palette)
    {
        Palette = palette;
        Background = new SolidColorBrush(ColorOf(palette.Canvas));
        _bar.Foreground = new SolidColorBrush(ColorOf(palette.Ink));
        _bar.Background = new SolidColorBrush(ColorOf(palette.Hairline));
        Render(_state);
    }

    /// <summary>`#rrggbb` as a WPF colour.</summary>
    private static Color ColorOf(string hex)
    {
        var cleaned = hex.TrimStart('#');
        var value = uint.Parse(cleaned, System.Globalization.NumberStyles.HexNumber);
        return Color.FromRgb(
            (byte)((value >> 16) & 0xFF),
            (byte)((value >> 8) & 0xFF),
            (byte)(value & 0xFF));
    }

    /// <summary>The window owns the reload; a callback keeps this view free of it.</summary>
    public Action? OnRetry { get; set; }

    /// <summary>
    /// Draw a state. The single entry point, so no caller can leave the splash
    /// half-updated — the bar, the sentence and the actions always describe one
    /// <see cref="SplashState"/>.
    /// </summary>
    public void Render(SplashState state)
    {
        _state = state;
        Visibility = state.Visible ? Visibility.Visible : Visibility.Collapsed;
        Opacity = 1;
        if (!state.Visible) return;

        var failed = state.Phase == SplashState.SplashPhase.Failed;
        _retry.Visibility = failed ? Visibility.Visible : Visibility.Collapsed;

        // A failed load hides the bar: a frozen partial bar says "still working"
        // over a message that says the opposite.
        _bar.Visibility = failed ? Visibility.Collapsed : Visibility.Visible;
        _bar.IsIndeterminate = state.Indeterminate;
        if (!state.Indeterminate) _bar.Value = state.Percent;

        _status.Text = state.Sentence();
        _status.Foreground = new SolidColorBrush(ColorOf(failed ? Palette.Error : Palette.Muted));
    }

    /// <summary>
    /// The platform's own sentence, appended under ours on a failure.
    ///
    /// Our wording says what the user can DO; WebView2's error status names the
    /// address and the failure kind, which is the detail that makes a wrong port
    /// diagnosable.
    /// </summary>
    public void SetDetail(string text)
    {
        if (Visibility != Visibility.Visible) return;
        _status.Text = $"{_status.Text}\n{text}";
    }

    private void Retry()
    {
        Render(SplashState.Connecting);
        OnRetry?.Invoke();
    }
}

/// <summary>
/// The wordmark as WPF visuals, rebuilt from the SVG's own geometry.
///
/// Split out so the splash stays about its state machine: this is a translation of
/// `public/kabmo-wordmark.svg` — plate, three strokes, gradient word, single-ink
/// `o` — and the numbers all come from <see cref="Wordmark"/>, which
/// `scripts/shell-wordmark.mjs` generates from that file. The rules suite
/// re-derives them, so a copy that drifted fails a test instead of drawing a
/// different logo.
/// </summary>
internal static class WordmarkArt
{
    public static FrameworkElement Build()
    {
        // The artwork's own coordinate space, with the SVG's negative origin moved
        // into the box by one translate — the same shift the other shells apply.
        var art = new Canvas
        {
            RenderTransform = new TranslateTransform(0, Wordmark.Shift),
        };

        var plate = new Rectangle
        {
            Width = Wordmark.PlateSize,
            Height = Wordmark.PlateSize,
            RadiusX = Wordmark.PlateCornerRadius,
            RadiusY = Wordmark.PlateCornerRadius,
            Fill = Brush(Wordmark.PlateColor),
        };
        art.Children.Add(plate);

        // The three K strokes: stroked, never filled. A `Path` with a `Data` and no
        // `Fill` draws the outline; filling them would paint the K's triangle solid.
        var strokes = new[] { Wordmark.Stem, Wordmark.UpperArm, Wordmark.LowerArm };
        for (var index = 0; index < strokes.Length; index++)
        {
            art.Children.Add(new Path
            {
                Data = Geometry.Parse(strokes[index]),
                Stroke = Brush(Wordmark.StrokeColors[index]),
                StrokeThickness = Wordmark.StrokeWidth,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            });
        }

        // The `Kabm` glyphs, in the gradient the SVG declares over the same
        // user-space span. `MappingMode.Absolute` keeps the run in the artwork's
        // coordinates rather than the path's own bounding box.
        var gradient = new LinearGradientBrush
        {
            MappingMode = BrushMappingMode.Absolute,
            StartPoint = new Point(Wordmark.GradientX1, Wordmark.GradientY1),
            EndPoint = new Point(Wordmark.GradientX2, Wordmark.GradientY2),
        };
        gradient.GradientStops.Add(new GradientStop(ColorOf(Wordmark.GradientStart), 0));
        gradient.GradientStops.Add(new GradientStop(ColorOf(Wordmark.GradientEnd), 1));
        art.Children.Add(new Path { Data = Geometry.Parse(Wordmark.WordA), Fill = gradient });

        // The `o`, in the single `mo` ink.
        art.Children.Add(new Path { Data = Geometry.Parse(Wordmark.WordO), Fill = Brush(Wordmark.WordInk) });

        return new Canvas
        {
            Width = Wordmark.ViewBoxWidth,
            Height = Wordmark.ViewBoxHeight,
            Children = { art },
        };
    }

    private static SolidColorBrush Brush(string hex) => new(ColorOf(hex));

    /// <summary>`#rrggbb` as a WPF colour.</summary>
    private static Color ColorOf(string hex)
    {
        var cleaned = hex.TrimStart('#');
        var value = uint.Parse(cleaned, System.Globalization.NumberStyles.HexNumber);
        return Color.FromRgb(
            (byte)((value >> 16) & 0xFF),
            (byte)((value >> 8) & 0xFF),
            (byte)(value & 0xFF));
    }
}
