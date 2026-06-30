using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BlackHoleRest.WebView2;

public sealed class OverlayForm : Form
{
    private const int HotkeyIdTogglePassthrough = 0x4248;
    private const int WmHotkey = 0x0312;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint WdaExcludeFromCapture = 0x00000011;
    private const int GwlExstyle = -20;
    private const int WsExTransparent = 0x00000020;
    private const int WsExToolwindow = 0x00000080;

    private readonly WebView2 _webView = new();
    private bool _passthrough;

    public OverlayForm()
    {
        Text = "Black Hole Desktop Overlay - WebView2";
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        ShowInTaskbar = true;
        BackColor = System.Drawing.Color.Black;
        KeyPreview = true;

        _webView.Dock = DockStyle.Fill;
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeWebViewAsync();
        FormClosed += (_, _) => UnregisterHotKey(Handle, HotkeyIdTogglePassthrough);
        Shown += (_, _) =>
        {
            ApplyCaptureExclusionToWindowTree();
            RegisterHotKey(Handle, HotkeyIdTogglePassthrough, ModControl | ModAlt, (uint)Keys.B);
        };
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WsExToolwindow;
            return cp;
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmHotkey && m.WParam.ToInt32() == HotkeyIdTogglePassthrough)
        {
            SetPassthrough(!_passthrough);
            return;
        }

        base.WndProc(ref m);
    }

    private async System.Threading.Tasks.Task InitializeWebViewAsync()
    {
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BlackHoleRest",
            "WebView2");
        Directory.CreateDirectory(userDataFolder);

        var environment = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder,
            new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));

        await _webView.EnsureCoreWebView2Async(environment);
        _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _webView.CoreWebView2.PermissionRequested += OnPermissionRequested;
        _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

        var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        if (!File.Exists(Path.Combine(repoRoot, "desktop", "desktop.html")))
        {
            repoRoot = Directory.GetCurrentDirectory();
        }

        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "blackhole.local",
            repoRoot,
            CoreWebView2HostResourceAccessKind.Allow);

        _webView.Source = new Uri("https://blackhole.local/desktop/desktop.html?host=webview2&autostart=1");
        _webView.NavigationCompleted += (_, _) => ApplyCaptureExclusionToWindowTree();
    }

    private static void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs args)
    {
        var permissionName = args.PermissionKind.ToString();
        if (permissionName.Contains("Capture", StringComparison.OrdinalIgnoreCase) ||
            permissionName.Contains("Camera", StringComparison.OrdinalIgnoreCase) ||
            permissionName.Contains("Microphone", StringComparison.OrdinalIgnoreCase))
        {
            args.State = CoreWebView2PermissionState.Allow;
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            if (!document.RootElement.TryGetProperty("type", out var typeElement))
            {
                return;
            }

            var type = typeElement.GetString();
            if (type == "blackhole:set-passthrough")
            {
                var enabled = document.RootElement.TryGetProperty("enabled", out var enabledElement) &&
                              enabledElement.ValueKind == JsonValueKind.True;
                SetPassthrough(enabled);
            }
        }
        catch
        {
            // Ignore malformed renderer messages; the overlay should keep running.
        }
    }

    private void SetPassthrough(bool enabled)
    {
        _passthrough = enabled;
        SetWindowPassthrough(Handle, enabled);
        EnumChildWindows(Handle, (child, _) =>
        {
            SetWindowPassthrough(child, enabled);
            return true;
        }, IntPtr.Zero);
        _webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "blackhole:passthrough",
            enabled
        }));
    }

    private void ApplyCaptureExclusionToWindowTree()
    {
        SetWindowDisplayAffinity(Handle, WdaExcludeFromCapture);
        EnumChildWindows(Handle, (child, _) =>
        {
            SetWindowDisplayAffinity(child, WdaExcludeFromCapture);
            return true;
        }, IntPtr.Zero);
    }

    private static void SetWindowPassthrough(IntPtr hwnd, bool enabled)
    {
        var exStyle = GetWindowLong(hwnd, GwlExstyle);
        var next = enabled ? exStyle | WsExTransparent : exStyle & ~WsExTransparent;
        if (next != exStyle)
        {
            SetWindowLong(hwnd, GwlExstyle, next);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
}
