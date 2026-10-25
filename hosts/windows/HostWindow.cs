using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace VNEngine.Windows;

internal sealed class HostWindow : Form
{
    private readonly HostOptions options;
    private readonly GameContent? game;
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(16, 23, 31) };
    private readonly Dictionary<string, AssetWorkspace> workspaces = new();
    private readonly string profile;
    private readonly string host;
    private readonly string startURL;
    private bool allowClose, closePending, fullScreen, bridgeBusy;
    private Rectangle normalBounds;
    private FormWindowState normalState;
    internal string SmokeFolder { get; }
    internal string? SmokeSavedFile { get; private set; }
    internal WebView2 Browser => web;
    internal HostOptions Options => options;
    internal bool IsGame => game != null;
    internal string GameKey => game?.Game ?? "studio";
    internal List<string> BlockedRequests { get; } = [];

    internal HostWindow(HostOptions options)
    {
        this.options = options;
        game = options.GameDirectory == null ? null : HostFiles.ValidateGame(options.GameDirectory);
        host = game == null ? "studio.vnengine.test" : "game-" + HostFiles.ProfileKey(game.Game) + ".vnengine.test";
        startURL = "https://" + host + (game == null ? "/editor/index.html" : "/index.html");
        profile = options.Profile ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VNEngine", game == null ? "Studio" : "Games/" + HostFiles.ProfileKey(game.Game));
        SmokeFolder = Path.Combine(Path.GetDirectoryName(options.Report)!, "io-" + (game == null ? "studio" : HostFiles.ProfileKey(game.Game)));
        if (options.Smoke) Directory.CreateDirectory(SmokeFolder);
        Text = game == null ? "VN Engine Studio" : game.Title + " · VN Engine";
        ClientSize = new Size(1440, 960); MinimumSize = new Size(800, 600); StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        var menu = new MenuStrip();
        var file = new ToolStripMenuItem("文件");
        if (game == null)
        {
            file.DropDownItems.Add("打开工程", null, async (_, _) => await ClickCommand("open"));
            file.DropDownItems.Add("保存工程", null, async (_, _) => await ClickCommand("save"));
            file.DropDownItems.Add("导出运行数据", null, async (_, _) => await ClickCommand("export"));
            file.DropDownItems.Add(new ToolStripSeparator());
        }
        file.DropDownItems.Add("运行打包作品…", null, (_, _) => OpenGame());
        if (game != null) file.DropDownItems.Add("打开编辑器", null, (_, _) => new HostWindow(options with { GameDirectory = null, Profile = null, Smoke = false }).Show());
        file.DropDownItems.Add("退出", null, (_, _) => Close());
        var view = new ToolStripMenuItem("视图");
        var full = new ToolStripMenuItem("全屏 / 恢复", null, (_, _) => ToggleFullScreen()) { ShortcutKeys = Keys.F11 }; view.DropDownItems.Add(full);
        view.DropDownItems.Add("重置缩放", null, (_, _) => web.ZoomFactor = 1);
        menu.Items.Add(file); menu.Items.Add(view); Controls.Add(web); Controls.Add(menu); MainMenuStrip = menu;
        RestoreWindowBounds();
        Shown += async (_, _) => { try { await Initialize(); } catch (Exception error) { Fail(error); } };
        FormClosing += OnClosing;
        FormClosed += (_, _) => { SaveBounds(); web.Dispose(); };
        Resize += async (_, _) => await NotifyVisibility();
    }
    private async Task Initialize()
    {
        var site = Path.GetFullPath(game?.Root ?? options.Site);
        if (!Directory.Exists(site) || !File.Exists(Path.Combine(site, game == null ? "editor/index.html" : "index.html"))) throw new FileNotFoundException("找不到本地程序内容，请保留完整的解压目录");
        Directory.CreateDirectory(profile);
        var environment = await CoreWebView2Environment.CreateAsync(null, profile);
        await web.EnsureCoreWebView2Async(environment);
        var core = web.CoreWebView2;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = game == null;
        core.Settings.AreDefaultContextMenusEnabled = game == null;
        core.Settings.AreDevToolsEnabled = game == null && !options.Smoke;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.SetVirtualHostNameToFolderMapping(host, site, CoreWebView2HostResourceAccessKind.DenyCors);
        core.NavigationStarting += (_, e) => { if (!AllowedNavigation(e.Uri, false)) e.Cancel = true; };
        core.FrameNavigationStarting += (_, e) => { if (!AllowedNavigation(e.Uri, true)) e.Cancel = true; };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, e) =>
        {
            if (game == null || !e.DownloadOperation.Uri.StartsWith("blob:https://" + host + "/", StringComparison.Ordinal) || e.DownloadOperation.MimeType != "application/json") { e.Cancel = true; return; }
            using var picker = new SaveFileDialog { Filter = "存档备份 (*.json)|*.json", FileName = "save.json", AddExtension = true, OverwritePrompt = true };
            e.Handled = true; if (picker.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = picker.FileName; else e.Cancel = true;
        };
        core.ProcessFailed += (_, e) => Fail(new InvalidOperationException("呈现进程异常：" + e.ProcessFailedKind));
        if (game == null) core.WebMessageReceived += OnMessage;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnResource;
        if (options.Smoke && game != null) await core.AddScriptToExecuteOnDocumentCreatedAsync("localStorage.setItem(" + JsonSerializer.Serialize("vn-engine:" + game.Game + ":settings") + ",JSON.stringify({textDelayMs:0,voiceEnabled:false,music:false}))");
        web.CoreWebView2Controller.AcceleratorKeyPressed += (_, e) =>
        {
            if (e.VirtualKey == 122 && e.KeyEventKind == CoreWebView2KeyEventKind.KeyDown) { e.Handled = true; BeginInvoke((Action)ToggleFullScreen); }
        };
        if (options.Smoke) core.NavigationCompleted += async (_, e) =>
        {
            if (!e.IsSuccess || !core.Source.StartsWith("https://" + host + "/", StringComparison.Ordinal)) { Fail(new InvalidOperationException("原生页面导航失败：" + e.WebErrorStatus)); return; }
            try { await SmokeTests.Run(this); } catch (Exception error) { Fail(error); }
        };
        core.Navigate(startURL);
    }
    private bool AllowedNavigation(string source, bool frame)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != host || !uri.IsDefaultPort || uri.UserInfo.Length > 0) return false;
        return game != null || (frame ? uri.AbsolutePath == "/editor/preview.html" : HostFiles.StudioSource(source));
    }
    private void OnResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var uri = new Uri(e.Request.Uri);
            if (uri.Scheme is "data" or "blob" or "about") return;
            if (uri.Scheme == "https" && uri.Host == host && uri.IsDefaultPort) return;
            if (game == null && uri.Host == "assets.vnengine.test")
            {
                var token = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
                if (token == null || !workspaces.TryGetValue(token, out var workspace)) throw new InvalidDataException("资源工作区已失效，请重新打开或绑定工程");
                var path = workspace.Resolve(uri);
                var bytes = File.ReadAllBytes(path);
                e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK", "Content-Type: " + Mime(path) + "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: https://studio.vnengine.test\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; sandbox");
                return;
            }
            BlockedRequests.Add(e.Request.Uri); throw new InvalidDataException("桌面宿主只允许本地内容");
        }
        catch { e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(null, 403, "Forbidden", "Cache-Control: no-store"); }
    }
    private static string Mime(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".svg" => "image/svg+xml", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".gif" => "image/gif",
        ".wav" => "audio/wav", ".ogg" => "audio/ogg", ".mp3" => "audio/mpeg", ".m4a" => "audio/mp4", ".woff2" => "font/woff2", ".woff" => "font/woff", ".ttf" => "font/ttf", ".txt" => "text/plain; charset=utf-8", _ => "application/octet-stream"
    };
    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (game != null || !HostFiles.StudioSource(e.Source) || !HostFiles.StudioSource(web.CoreWebView2.Source)) return;
        string? id = null;
        try
        {
            if (e.WebMessageAsJson.Length > HostFiles.MaxJson * 3) throw new InvalidDataException("消息过大");
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var value = message.RootElement;
            id = value.GetProperty("id").GetString(); if (id == null || id.Length > 100 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-')) return;
            if (bridgeBusy) throw new InvalidOperationException("请完成当前文件操作");
            bridgeBusy = true;
            try
            {
                var command = value.GetProperty("command").GetString();
                object result = command switch
                {
                    "open-project" => OpenProject(),
                    "save-workspace" => SaveProject(value, false),
                    "export-project" => SaveProject(value, true),
                    "bind-assets" => BindAssets(value),
                    _ => throw new InvalidDataException("不支持的桌面命令")
                };
                Reply(new { id, ok = true, result });
            }
            finally { bridgeBusy = false; }
        }
        catch (Exception error) { if (id != null) Reply(new { id, ok = false, error = error.Message }); }
    }
    private void Reply(object message)
    {
        if (!IsDisposed && web.CoreWebView2 != null && HostFiles.StudioSource(web.CoreWebView2.Source)) web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }
    private AssetWorkspace AddWorkspace(string root, string content)
    {
        var workspace = new AssetWorkspace(root, content);
        if (workspaces.Count >= 8) workspaces.Remove(workspaces.Keys.First());
        workspaces[workspace.Token] = workspace; return workspace;
    }
    private object OpenProject()
    {
        string path;
        if (options.Smoke) path = SmokeSavedFile ?? Path.Combine(options.Site, "samples", "campus.json");
        else
        {
            using var picker = new OpenFileDialog { Filter = "VN Engine 工程 (*.vnproj;*.json)|*.vnproj;*.json", CheckFileExists = true, Multiselect = false };
            if (picker.ShowDialog(this) != DialogResult.OK) return new { cancelled = true }; path = picker.FileName;
        }
        var content = HostFiles.ReadJson(path);
        var workspace = AddWorkspace(Path.GetDirectoryName(path)!, content);
        return new { cancelled = false, content, baseURL = workspace.BaseURL, files = workspace.Available() };
    }
    private object SaveProject(JsonElement message, bool projectOnly)
    {
        var content = message.GetProperty("content").GetString() ?? throw new InvalidDataException("缺少工程内容");
        using var parsed = JsonDocument.Parse(content);
        if (projectOnly && parsed.RootElement.TryGetProperty("format", out _)) throw new InvalidDataException("导出运行数据应使用原始工程格式");
        var name = message.GetProperty("suggestedName").GetString() ?? "project";
        if (name.Length > 150 || Path.GetFileName(name) != name || name.Any(c => Path.GetInvalidFileNameChars().Contains(c))) name = "project" + (projectOnly ? ".json" : ".vnproj");
        string path;
        if (options.Smoke) path = Path.Combine(SmokeFolder, projectOnly ? "project.json" : "session.vnproj");
        else
        {
            using var picker = new SaveFileDialog { Filter = projectOnly ? "运行数据 (*.json)|*.json" : "编辑器工程 (*.vnproj)|*.vnproj", FileName = name, AddExtension = true, OverwritePrompt = true };
            if (picker.ShowDialog(this) != DialogResult.OK) return new { cancelled = true }; path = picker.FileName;
        }
        AssetWorkspace? source = null;
        if (message.TryGetProperty("baseURL", out var baseValue) && Uri.TryCreate(baseValue.GetString(), UriKind.Absolute, out var baseUri))
        {
            var token = baseUri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (baseUri.Host == "assets.vnengine.test" && token != null) workspaces.TryGetValue(token, out source);
            if (baseUri.AbsoluteUri == "https://studio.vnengine.test/samples/") source = new AssetWorkspace(Path.Combine(options.Site, "samples"), content);
        }
        HostFiles.SaveWithAssets(path, content, source, projectOnly); if (!projectOnly) SmokeSavedFile = path;
        return new { cancelled = false };
    }
    private object BindAssets(JsonElement message)
    {
        if (options.Smoke) throw new InvalidOperationException("原生资源目录对话框由人工选择");
        using var picker = new FolderBrowserDialog { Description = "选择工程资源根目录（包含清单中的 assets 等相对目录）", UseDescriptionForTitle = true };
        if (picker.ShowDialog(this) != DialogResult.OK) return new { cancelled = true };
        var workspace = AddWorkspace(picker.SelectedPath, message.GetProperty("content").GetString() ?? "");
        return new { cancelled = false, baseURL = workspace.BaseURL, files = workspace.Available() };
    }
    private async Task ClickCommand(string command)
    {
        if (web.CoreWebView2 == null || !HostFiles.StudioSource(web.CoreWebView2.Source)) return;
        try { await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-command=\"" + command + "\"]')?.click()"); }
        catch (Exception error) { MessageBox.Show(this, error.Message, "操作未完成"); }
    }
    private async Task NotifyVisibility()
    {
        if (web.CoreWebView2 == null || !AllowedNavigation(web.CoreWebView2.Source, false)) return;
        try { await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('vn-engine-host-visibility',{detail:{hidden:" + (WindowState == FormWindowState.Minimized ? "true" : "false") + "}}))"); } catch { }
    }
    private void OpenGame()
    {
        using var picker = new FolderBrowserDialog { Description = "选择引擎打包产物目录（包含 build-manifest.json）", UseDescriptionForTitle = true };
        if (picker.ShowDialog(this) != DialogResult.OK) return;
        try { new HostWindow(options with { GameDirectory = picker.SelectedPath, Profile = null, Smoke = false }).Show(); }
        catch (Exception error) { MessageBox.Show(this, error.Message, "作品未打开", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }
    internal void ToggleFullScreen()
    {
        if (!fullScreen) { normalBounds = Bounds; normalState = WindowState; WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None; Bounds = Screen.FromControl(this).Bounds; MainMenuStrip!.Visible = false; }
        else { FormBorderStyle = FormBorderStyle.Sizable; Bounds = normalBounds; WindowState = normalState; MainMenuStrip!.Visible = true; }
        fullScreen = !fullScreen;
    }
    private async void OnClosing(object? sender, FormClosingEventArgs e)
    {
        if (allowClose || options.Smoke || game != null || web.CoreWebView2 == null) return;
        e.Cancel = true; if (closePending) return; closePending = true;
        try
        {
            var dirty = await web.CoreWebView2.ExecuteScriptAsync("document.body.dataset.dirty === 'true'");
            if (dirty == "true" && MessageBox.Show(this, "工程尚未保存。仍要关闭吗？", "VN Engine Studio", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
            allowClose = true; Close();
        }
        catch { if (MessageBox.Show(this, "编辑器未响应。仍要关闭吗？", "VN Engine Studio", MessageBoxButtons.YesNo) == DialogResult.Yes) { allowClose = true; Close(); } }
        finally { closePending = false; }
    }
    private void RestoreWindowBounds()
    {
        if (options.Smoke) return;
        try
        {
            using var data = JsonDocument.Parse(File.ReadAllText(Path.Combine(profile, "window.json")));
            var p = data.RootElement; var bounds = new Rectangle(p.GetProperty("x").GetInt32(), p.GetProperty("y").GetInt32(), Math.Max(800, p.GetProperty("width").GetInt32()), Math.Max(600, p.GetProperty("height").GetInt32()));
            if (Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(bounds))) { StartPosition = FormStartPosition.Manual; Bounds = bounds; }
        }
        catch { /* Absent or stale window settings must not block launch. */ }
    }
    private void SaveBounds()
    {
        if (options.Smoke) return;
        try { var r = fullScreen ? normalBounds : WindowState == FormWindowState.Normal ? Bounds : base.RestoreBounds; HostFiles.WriteJson(Path.Combine(profile, "window.json"), JsonSerializer.Serialize(new { x = r.X, y = r.Y, width = r.Width, height = r.Height })); } catch { }
    }
    internal void Finish() { allowClose = true; Close(); }
    private void Fail(Exception error)
    {
        Program.Result = 1;
        if (options.Smoke)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(options.Report)!);
            File.WriteAllText(options.Report, JsonSerializer.Serialize(new { result = "failed", error = error.ToString(), blockedRequests = BlockedRequests }, new JsonSerializerOptions { WriteIndented = true }));
            Finish();
        }
        else { MessageBox.Show(this, error.Message + "\n\n本地作品与工程文件保持原样。", "VN Engine", MessageBoxButtons.OK, MessageBoxIcon.Error); Finish(); }
    }
}
