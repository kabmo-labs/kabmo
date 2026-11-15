/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell's own QR scanner: a camera preview in a WebView2, decoded by the same
 * page Android hosts.
 *
 * **Why a web view here and native on Apple.** Windows has no QR decoder in the
 * framework: the options are a NuGet package (ZXing.Net) or a hand-written
 * decoder. The page already exists, its decoder is already tested, and WebView2 is
 * already a dependency of this app — so the cheapest correct answer is to host it.
 * Apple platforms get `AVCaptureMetadataOutput` because it is built in there.
 *
 * **The virtual host mapping is load-bearing.** `getUserMedia` needs a secure
 * context, and `NavigateToString` gives the document an opaque origin that is not
 * one — the page would report "this device does not offer a camera" on a machine
 * with a perfectly good webcam. Mapping a folder to `https://kabmo.local/` gives
 * the document that origin without a server behind it.
 *
 * The result is the decoded TEXT, not a parsed payload: the caller already has
 * `PairingLink.OriginOf`, and a second parser here would be a second place for the
 * link format to drift.
 */

using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace KabmoDesktop.App;

internal sealed class QrScannerWindow : Window
{
    private const string VirtualHost = "kabmo.local";

    private readonly WebView2 _view = new();
    private bool _finished;

    /// <summary>A code was read. Called once, on the UI thread.</summary>
    public Action<string>? OnCode { get; set; }

    public QrScannerWindow(Window owner)
    {
        Title = "Scan pairing code";
        Owner = owner;
        Width = 460;
        Height = 420;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Content = _view;

        Loaded += async (_, _) => await StartAsync();
        Closed += (_, _) => _view.Dispose();
    }

    private async Task StartAsync()
    {
        try
        {
            var userData = Path.Combine(Path.GetTempPath(), "kabmo-qr-webview");
            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await _view.EnsureCoreWebView2Async(environment);

            var core = _view.CoreWebView2;
            core.WebMessageReceived += OnMessage;

            // The page has to be a FILE for the virtual host to serve it, and the
            // app's own directory is not writable in an installed build.
            var folder = Path.Combine(Path.GetTempPath(), "kabmo-qr-page");
            Directory.CreateDirectory(folder);
            var page = Path.Combine(folder, "qr-scanner.html");
            File.WriteAllText(page, ScannerPage.Html);

            core.SetVirtualHostNameToFolderMapping(
                VirtualHost, folder, CoreWebView2HostResourceAccessKind.Allow);
            core.Navigate($"https://{VirtualHost}/qr-scanner.html");
        }
        catch (Exception error)
        {
            // A missing WebView2 runtime is the common case, and the sentence is
            // the only place the user learns it.
            MessageBox.Show(
                this,
                $"{error.Message}\n\nThe WebView2 runtime is required to scan a code. " +
                "Use the pairing link instead.",
                "Kabmo",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            Close();
        }
    }

    /// <summary>Pick an image and hand it to the page as a data URL.</summary>
    private void PickImage()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Choose a pairing code image",
            Filter = "Images|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif|All files|*.*",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog(this) != true) return;

        try
        {
            var bytes = File.ReadAllBytes(dialog.FileName);
            var mime = Path.GetExtension(dialog.FileName).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                ".gif" => "image/gif",
                _ => "image/jpeg",
            };
            var dataUrl = $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
            // The bytes never leave the app: the page decodes them in place.
            _ = _view.CoreWebView2?.ExecuteScriptAsync(
                $"window.__kabmoQrImage && window.__kabmoQrImage({JsonSerializer.Serialize(dataUrl)})");
        }
        catch (Exception error)
        {
            MessageBox.Show(this, error.Message, "Kabmo", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (_finished) return;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var type)) return;

            // The page asks the HOST for a picker: a WebView file chooser is a
            // second permission path for something the shell already has, and the
            // page never needs to see a file path.
            if (type.GetString() == "pick")
            {
                PickImage();
                return;
            }
            if (type.GetString() != "code") return;
            if (!root.TryGetProperty("text", out var text)) return;
            var value = text.GetString();
            if (string.IsNullOrWhiteSpace(value)) return;

            _finished = true;
            Close();
            OnCode?.Invoke(value);
        }
        catch (JsonException)
        {
            // A message this build does not understand is not a code.
        }
    }
}
