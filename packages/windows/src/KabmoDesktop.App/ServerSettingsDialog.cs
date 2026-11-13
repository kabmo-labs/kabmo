/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The splash's "Server settings" dialog: an address field, the servers this shell
 * already knows, and Connect.
 *
 * A modal dialog over the window rather than a second app window, because the
 * failure splash is MODAL in intent — the console has not loaded, so there is
 * nothing behind it to interact with. WPF gives a dialog the platform's own focus,
 * Enter and Escape handling; nothing here reimplements that.
 *
 * The RULES are `ServerSettingsForm`'s (prefill, rows, validation) and this file
 * only draws them. **Connect returns the RAW field text**: the refusal a wrong
 * address earns comes from the store's own `ServerAddress.Normalise` and the
 * probe, and validating here as well would be a second copy — the caller then
 * re-presents this dialog with the sentence instead.
 */

using System.Windows;
using System.Windows.Controls;

namespace KabmoDesktop.App;

internal sealed class ServerSettingsDialog : Window
{
    private readonly TextBox _address;
    private readonly ComboBox _picker;
    private readonly ServerSettingsForm _form;

    /// <summary>What the field holds when Connect was pressed.</summary>
    public string TypedAddress => _address.Text.Trim();

    public ServerSettingsDialog(ServerSettingsForm form, string? error, ShellPalette palette, Window owner)
    {
        _form = form;

        Title = "Server settings";
        Owner = owner;
        WindowStartupLocation = System.Windows.WindowStartupLocation.CenterOwner;
        SizeToContent = System.Windows.SizeToContent.WidthAndHeight;
        ResizeMode = System.Windows.ResizeMode.NoResize;
        ShowInTaskbar = false;
        Background = ShellButton.Brush(palette.Canvas);

        var column = new StackPanel { Margin = new Thickness(20) };

        column.Children.Add(new TextBlock
        {
            Text = error
                ?? "Enter the address of the Kabmo server this window loads. " +
                   "Use the root address, with no path.",
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = 380,
            Margin = new Thickness(0, 0, 0, 12),
            Foreground = ShellButton.Brush(error is null ? palette.Muted : palette.Error),
        });

        // The field on TOP: it is the value Connect submits, and it is what a user
        // who knows the address needs first. The picker is the shortcut underneath.
        _address = new TextBox
        {
            Text = form.Address,
            FontSize = 13,
            Padding = new Thickness(8, 6, 8, 6),
            MinWidth = 380,
            Background = ShellButton.Brush(palette.Paper),
            Foreground = ShellButton.Brush(palette.Ink),
            BorderBrush = ShellButton.Brush(palette.Hairline),
            BorderThickness = new Thickness(1),
            CaretBrush = ShellButton.Brush(palette.Ink),
        };
        System.Windows.Automation.AutomationProperties.SetName(_address, "Server address");
        _address.Loaded += (_, _) => { _address.Focus(); _address.SelectAll(); };
        column.Children.Add(_address);

        _picker = new ComboBox
        {
            Margin = new Thickness(0, 8, 0, 0),
            MinWidth = 380,
            FontSize = 13,
            Background = ShellButton.Brush(palette.Paper),
            Foreground = ShellButton.Brush(palette.Ink),
            BorderBrush = ShellButton.Brush(palette.Hairline),
        };
        System.Windows.Automation.AutomationProperties.SetName(_picker, "Remembered servers");
        _picker.Items.Add("Remembered servers");
        foreach (var row in form.Rows) _picker.Items.Add(form.TitleOf(row));
        _picker.SelectedIndex = 0;
        _picker.SelectionChanged += (_, _) => Picked();
        column.Children.Add(_picker);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 16, 0, 0),
        };
        var cancel = ShellButton.Make("Cancel", filled: false, palette: palette);
        cancel.IsCancel = true;
        cancel.Margin = new Thickness(0, 0, 8, 0);
        actions.Children.Add(cancel);

        var connect = ShellButton.Make("Connect", filled: true, palette: palette);
        connect.IsDefault = true;
        connect.Click += (_, _) => DialogResult = true;
        actions.Children.Add(connect);
        column.Children.Add(actions);

        Content = column;
    }

    /// <summary>A picked row fills the field — the field stays the one submitted value.</summary>
    private void Picked()
    {
        var index = _picker.SelectedIndex - 1;
        if (index < 0 || index >= _form.Rows.Count) return;
        _address.Text = _form.Rows[index].Url;
    }
}
