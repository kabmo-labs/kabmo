/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell's one drawn button, and the metrics every native action shares.
 *
 * **The template is the point.** A WPF `Button` with only `Background`,
 * `Foreground` and `BorderBrush` set still draws Aero2's own template on Windows
 * 10/11: a 2px square border with system hover/pressed fills, and it ignores
 * `CornerRadius` entirely — so the splash's Retry was a grey system button on the
 * console's paper ground and no palette ink could reach it. The plate here is a
 * `Border` with the palette's own colours, and the triggers only change its
 * opacity, which is the same interaction the Android and iOS overlays get from
 * their filled/outlined drawables.
 *
 * The sizes are the mobile overlays' own, in device-independent units: 13pt label,
 * 8pt corner, 16 x 6 padding, 30pt minimum height.
 */

using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Button = System.Windows.Controls.Button;
using Color = System.Windows.Media.Color;

namespace KabmoDesktop.App;

internal static class ShellButton
{
    public const double FontSize = 13;
    public const double CornerRadius = 8;
    public const double MinimumHeight = 30;
    public static readonly Thickness Padding = new(16, 6, 16, 6);

    /// <summary>A filled primary when <paramref name="filled"/>, else an outlined secondary.</summary>
    public static Button Make(string text, bool filled, ShellPalette palette)
    {
        var button = new Button { Template = PlateTemplate() };
        Apply(button, text, filled, palette);
        return button;
    }

    /// <summary>Repaint an existing button, which is what a palette change needs.</summary>
    public static void Apply(Button button, string text, bool filled, ShellPalette palette)
    {
        button.Content = text;
        button.FontSize = FontSize;
        button.Padding = Padding;
        button.MinHeight = MinimumHeight;
        button.BorderThickness = new Thickness(1);
        button.Foreground = Brush(filled ? palette.Canvas : palette.Ink);
        button.Background = Brush(filled ? palette.Ink : palette.Paper);
        button.BorderBrush = Brush(palette.Hairline);
        button.Cursor = System.Windows.Input.Cursors.Hand;
    }

    /// <summary>`#rrggbb` as a WPF colour.</summary>
    internal static Color Colour(string hex)
    {
        var cleaned = hex.TrimStart('#');
        var value = uint.Parse(cleaned, System.Globalization.NumberStyles.HexNumber);
        return Color.FromRgb(
            (byte)((value >> 16) & 0xFF),
            (byte)((value >> 8) & 0xFF),
            (byte)(value & 0xFF));
    }

    internal static SolidColorBrush Brush(string hex) => new(Colour(hex));

    private static ControlTemplate PlateTemplate()
    {
        var plate = new FrameworkElementFactory(typeof(Border), "plate");
        plate.SetValue(Border.CornerRadiusProperty, new CornerRadius(CornerRadius));
        plate.SetBinding(Border.BackgroundProperty, Binding("Background"));
        plate.SetBinding(Border.BorderBrushProperty, Binding("BorderBrush"));
        plate.SetBinding(Border.BorderThicknessProperty, Binding("BorderThickness"));

        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        plate.AppendChild(content);

        var template = new ControlTemplate(typeof(Button)) { VisualTree = plate };

        var hover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        hover.Setters.Add(new Setter(UIElement.OpacityProperty, 0.9, "plate"));
        template.Triggers.Add(hover);

        var pressed = new Trigger { Property = Button.IsPressedProperty, Value = true };
        pressed.Setters.Add(new Setter(UIElement.OpacityProperty, 0.8, "plate"));
        template.Triggers.Add(pressed);

        return template;
    }

    /// <summary>A template binding to the button's own property of the same name.</summary>
    private static System.Windows.Data.Binding Binding(string property) => new(property)
    {
        RelativeSource = new System.Windows.Data.RelativeSource(
            System.Windows.Data.RelativeSourceMode.TemplatedParent),
    };
}
