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
 * A failed load keeps the splash with the reason and a Retry, instead of leaving
 * a blank window with nothing on screen to explain it. The same shape the macOS
 * shell's `Splash.swift` has, for the same reason.
 */

using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace KabmoDesktop.App;

public sealed class SplashView : Grid
{
    private readonly TextBlock _wordmark;
    private readonly TextBlock _status;
    private readonly Button _retry;

    public SplashView()
    {
        Background = new SolidColorBrush(Color.FromRgb(0xFA, 0xF8, 0xF3));

        _wordmark = new TextBlock
        {
            Text = "Kabmo",
            FontSize = 26,
            FontWeight = FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Foreground = new SolidColorBrush(Color.FromRgb(0x14, 0x13, 0x10)),
        };
        _status = new TextBlock
        {
            Text = "Starting…",
            FontSize = 12,
            Margin = new Thickness(0, 12, 0, 0),
            MaxWidth = 460,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Foreground = new SolidColorBrush(Color.FromRgb(0x6B, 0x6B, 0x6B)),
        };
        _retry = new Button
        {
            Content = "Retry",
            Margin = new Thickness(0, 16, 0, 0),
            Padding = new Thickness(16, 6, 16, 6),
            HorizontalAlignment = HorizontalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        _retry.Click += (_, _) => Retry();

        var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(_wordmark);
        stack.Children.Add(_status);
        stack.Children.Add(_retry);
        Children.Add(stack);
    }

    /// <summary>The window owns the reload; a callback keeps this view free of it.</summary>
    public Action? OnRetry { get; set; }

    /// <summary>Keep the splash up and say why the page did not arrive.</summary>
    public void ShowFailure(string reason)
    {
        Opacity = 1;
        Visibility = Visibility.Visible;
        _status.Text = $"Could not load the console.\n{reason}";
        _status.Foreground = new SolidColorBrush(Color.FromRgb(0xB4, 0x2D, 0x1F));
        _retry.Visibility = Visibility.Visible;
    }

    private void Retry()
    {
        _status.Text = "Starting…";
        _status.Foreground = new SolidColorBrush(Color.FromRgb(0x6B, 0x6B, 0x6B));
        _retry.Visibility = Visibility.Collapsed;
        OnRetry?.Invoke();
    }
}
