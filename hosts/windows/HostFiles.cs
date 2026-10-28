using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace VNEngine.Windows;

internal static partial class HostFiles
{
    internal const int MaxJson = 8_000_000;
    internal static string ProfileKey(string game) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(game))).ToLowerInvariant()[..24];
    internal static bool LocalPath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.StartsWith('/') || path.Contains('\\') || path.Any(c => c < 32 || ":%?#*\"<>|".Contains(c))) return false;
        return path.Split('/').All(p => p.Length > 0 && p is not "." and not ".." && !p.EndsWith('.') && !p.EndsWith(' ') && !DeviceName().IsMatch(p));
    }
    [GeneratedRegex(@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase)]
    private static partial Regex DeviceName();

    internal static string LocalFile(string root, string relative)
    {
        if (!LocalPath(relative)) throw new InvalidDataException("资源路径必须留在工程目录内");
        var basePath = Path.GetFullPath(root);
        if ((File.GetAttributes(basePath) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("工程根目录不能是链接");
        var current = basePath;
        foreach (var part in relative.Split('/'))
        {
            current = Path.Combine(current, part);
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("资源不能经过链接或联接点");
        }
        if (!Path.GetFullPath(current).StartsWith(basePath.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("资源离开工程目录");
        if (!File.Exists(current)) throw new FileNotFoundException("资源文件不存在", relative);
        return current;
    }
    internal static string ReadJson(string path)
    {
        if (new FileInfo(path).Length > MaxJson) throw new InvalidDataException("工程超过 8 MB");
        var content = File.ReadAllText(path, Encoding.UTF8);
        using var parsed = JsonDocument.Parse(content, new JsonDocumentOptions { MaxDepth = 64 });
        return content;
    }
    internal static JsonElement Project(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("format", out var format) && format.GetString() == "vn-engine-editor") return root.GetProperty("project");
        return root;
    }
    internal static void ValidateAuthorReview(string content)
    {
        if (Encoding.UTF8.GetByteCount(content) > MaxJson) throw new InvalidDataException("审阅超过 8 MB");
        using var parsed = JsonDocument.Parse(content, new JsonDocumentOptions { MaxDepth = 64 });
        var doc = parsed.RootElement;
        if (doc.ValueKind != JsonValueKind.Object || doc.GetProperty("contract").GetString() != "vn-author-review-v1" || doc.GetProperty("schema").GetInt32() != 1
            || string.IsNullOrWhiteSpace(doc.GetProperty("game").GetString()) || string.IsNullOrWhiteSpace(doc.GetProperty("storyVersion").GetString())
            || doc.GetProperty("items").ValueKind != JsonValueKind.Array || doc.GetProperty("items").GetArrayLength() > 500) throw new InvalidDataException("不是受支持的作者审阅文档");
        foreach (var item in doc.GetProperty("items").EnumerateArray())
            if (item.GetProperty("events").ValueKind != JsonValueKind.Array || item.GetProperty("events").GetArrayLength() is < 1 or > 64) throw new InvalidDataException("审阅操作记录无效");
    }
    internal static void WriteJson(string path, string content)
    {
        if (Encoding.UTF8.GetByteCount(content) > MaxJson) throw new InvalidDataException("工程超过 8 MB");
        using var parsed = JsonDocument.Parse(content, new JsonDocumentOptions { MaxDepth = 64 });
        var full = Path.GetFullPath(path);
        if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("不能覆盖链接文件");
        var temp = full + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, content, new UTF8Encoding(false)); File.Move(temp, full, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    internal static void SaveWithAssets(string path, string content, AssetWorkspace? source, bool requireFiles)
    {
        var destination = Path.GetFullPath(path);
        var root = Path.GetDirectoryName(destination)!;
        using var parsed = JsonDocument.Parse(content);
        var desired = new AssetWorkspace(root, content);
        var copies = new List<(string Source, string Destination)>();
        foreach (var name in desired.Files)
        {
            if (source == null || !source.Files.Contains(name)) { if (requireFiles) throw new InvalidDataException("请先绑定资源目录：" + name); continue; }
            string input;
            try { input = HostFiles.LocalFile(source.Root, name); } catch { if (requireFiles) throw; continue; }
            var output = Path.GetFullPath(Path.Combine(root, name));
            if (string.Equals(output, destination, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("工程文件名与资源冲突");
            if (string.Equals(input, output, StringComparison.OrdinalIgnoreCase)) continue;
            // Inspect existing path segments before creating anything, including junctions.
            var current = root;
            foreach (var part in name.Split('/').Prepend(""))
            {
                if (part.Length > 0) current = Path.Combine(current, part);
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("保存路径不能经过链接");
            }
            if (File.Exists(output))
            {
                using var original = File.OpenRead(input); using var existing = File.OpenRead(output);
                if (!SHA256.HashData(original).SequenceEqual(SHA256.HashData(existing))) throw new IOException("目标目录已有不同资源，未覆盖：" + name);
                continue;
            }
            copies.Add((input, output));
        }
        var written = new List<string>();
        try
        {
            foreach (var (input, output) in copies) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.Copy(input, output, false); written.Add(output); }
            WriteJson(destination, content);
        }
        catch { foreach (var file in written) try { File.Delete(file); } catch { } throw; }
    }
    internal static GameContent ValidateGame(string directory)
    {
        var root = Path.GetFullPath(directory);
        using var manifest = JsonDocument.Parse(ReadJson(LocalFile(root, "build-manifest.json")));
        var data = manifest.RootElement;
        if (data.GetProperty("schema").GetInt32() != 1) throw new InvalidDataException("未知的构建清单");
        var game = data.GetProperty("game").GetString();
        if (string.IsNullOrWhiteSpace(game)) throw new InvalidDataException("缺少作品身份");
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in data.GetProperty("files").EnumerateArray())
        {
            var name = entry.GetProperty("name").GetString() ?? "";
            if (!files.Add(name)) throw new InvalidDataException("构建清单路径重复");
            var path = LocalFile(root, name);
            if (new FileInfo(path).Length != entry.GetProperty("size").GetInt64()) throw new InvalidDataException("资源长度不匹配：" + name);
            using var stream = File.OpenRead(path);
            var digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (digest != entry.GetProperty("sha256").GetString()) throw new InvalidDataException("资源校验失败：" + name);
        }
        foreach (var required in new[] { "index.html", "app.mjs", "project.json", "lib/index.js" }) if (!files.Contains(required)) throw new InvalidDataException("构建缺少 " + required);
        using var project = JsonDocument.Parse(ReadJson(LocalFile(root, "project.json")));
        if (project.RootElement.GetProperty("game").GetString() != game) throw new InvalidDataException("作品身份不匹配");
        return new GameContent(root, game, project.RootElement.GetProperty("title").GetString() ?? game);
    }
    internal static bool StudioSource(string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.Host == "studio.vnengine.test" && uri.IsDefaultPort && uri.UserInfo == "" && uri.Query == "" && uri.Fragment == "" && (uri.AbsolutePath == "/editor/" || uri.AbsolutePath == "/editor/index.html");
}

internal sealed record GameContent(string Root, string Game, string Title);
internal sealed class AssetWorkspace
{
    internal string Root { get; }
    internal string Token { get; } = Guid.NewGuid().ToString("N");
    internal HashSet<string> Files { get; } = new(StringComparer.Ordinal);
    internal string BaseURL => "https://assets.vnengine.test/" + Token + "/";
    internal AssetWorkspace(string root, string content)
    {
        Root = Path.GetFullPath(root);
        using var data = JsonDocument.Parse(content);
        var project = HostFiles.Project(data.RootElement);
        foreach (var asset in project.GetProperty("assets").EnumerateArray())
        {
            Add(asset.GetProperty("src").GetString());
            if (asset.TryGetProperty("license", out var license)) Add(license.GetProperty("src").GetString());
        }
    }
    private void Add(string? path) { if (path != null && HostFiles.LocalPath(path)) Files.Add(path); }
    internal string Resolve(Uri uri)
    {
        var prefix = "/" + Token + "/";
        if (uri.Scheme != "https" || uri.Host != "assets.vnengine.test" || !uri.IsDefaultPort || uri.Query.Length > 0 || !uri.AbsolutePath.StartsWith(prefix, StringComparison.Ordinal)) throw new InvalidDataException("未知资源请求");
        var path = Uri.UnescapeDataString(uri.AbsolutePath[prefix.Length..]);
        if (!Files.Contains(path)) throw new InvalidDataException("文件没有在资源清单中声明");
        var full = HostFiles.LocalFile(Root, path);
        if (new FileInfo(full).Length > 128_000_000) throw new InvalidDataException("资源超过 128 MB");
        return full;
    }
    internal string[] Available() => Files.Where(name => { try { HostFiles.LocalFile(Root, name); return true; } catch { return false; } }).ToArray();
}
