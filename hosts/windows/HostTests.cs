using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace VNEngine.Windows;

internal static class HostTests
{
    internal static int Run(string report)
    {
        var checks = new List<string>(); var root = Path.Combine(Path.GetTempPath(), "vn-host-test-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        void Reject(Action action) { try { action(); } catch { return; } throw new InvalidOperationException("未拒绝无效输入"); }
        try
        {
            foreach (var path in new[] { "../secret", "/absolute", "C:/private", "a\\file", "a/%2e%2e/b", "a/./b", "a//b", "a/../b", "a?x", "a#x", "NUL.txt", "a/COM1", "a. /file", "a./file" }) Check(!HostFiles.LocalPath(path), "未拒绝路径：" + path);
            Check(HostFiles.LocalPath("assets/中文 配图.svg"), "有效中文资源路径被拒绝"); checks.Add("Relative paths reject traversal, encodings, drive paths and Windows device aliases");
            foreach (var source in new[] { "https://studio.vnengine.test/editor/preview.html", "http://studio.vnengine.test/editor/", "https://evil.test/editor/", "https://studio.vnengine.test:444/editor/", "https://studio.vnengine.test/editor/?x=1", "https://evil@studio.vnengine.test/editor/" }) Check(!HostFiles.StudioSource(source), "未拒绝来源：" + source);
            Check(HostFiles.StudioSource("https://studio.vnengine.test/editor/index.html"), "合法编辑器来源被拒绝"); checks.Add("Only the exact trusted top-level editor document may use native commands");
            var jsonPath = Path.Combine(root, "workspace.vnproj"); HostFiles.WriteJson(jsonPath, "{\"title\":\"中文\"}"); var before = File.ReadAllBytes(jsonPath);
            Reject(() => HostFiles.WriteJson(jsonPath, "{broken")); Check(File.ReadAllBytes(jsonPath).SequenceEqual(before), "失败写入破坏了原文件");
            Check(!before.Take(3).SequenceEqual(new byte[] { 0xef, 0xbb, 0xbf }), "写入了 BOM"); checks.Add("Atomic UTF-8 JSON saves preserve existing bytes when parsing fails");
            HostFiles.ValidateAuthorReview("{\"contract\":\"vn-author-review-v1\",\"schema\":1,\"game\":\"fixture\",\"storyVersion\":\"1\",\"items\":[]}");
            Reject(() => HostFiles.ValidateAuthorReview("{\"schema\":1,\"game\":\"fixture\",\"assets\":[]}"));
            checks.Add("Independent native review files require the versioned author contract and cannot be confused with runtime projects");
            HostFiles.ValidateAiAcceptance("{\"contract\":\"vn-ai-acceptance-v1\",\"schema\":1,\"game\":\"fixture\",\"storyVersion\":\"1\",\"binding\":{},\"inputs\":[{\"src\":\"$source\"}],\"reviews\":[]}");
            Reject(() => HostFiles.ValidateAiAcceptance("{\"contract\":\"vn-author-review-v1\",\"schema\":1}"));
            checks.Add("AI acceptance has its own versioned native document kind and bounded evidence paths");
            var content = "{\"schema\":1,\"game\":\"fixture\",\"title\":\"Fixture\",\"assets\":[{\"id\":\"a\",\"kind\":\"background\",\"src\":\"assets/a.svg\"}]}";
            Directory.CreateDirectory(Path.Combine(root, "assets")); File.WriteAllText(Path.Combine(root, "assets/a.svg"), "<svg/>"); File.WriteAllText(Path.Combine(root, "private.txt"), "private");
            var workspace = new AssetWorkspace(root, content);
            Check(workspace.Resolve(new Uri(workspace.BaseURL + "assets/a.svg")) == Path.Combine(root, "assets", "a.svg"), "声明资源不可读");
            Reject(() => workspace.Resolve(new Uri(workspace.BaseURL + "private.txt"))); Reject(() => workspace.Resolve(new Uri("https://assets.vnengine.test/wrong/assets/a.svg"))); checks.Add("Asset IO is bound to an authorised root, token and declared manifest files");
            var copied = Path.Combine(root, "copied"); Directory.CreateDirectory(copied); HostFiles.SaveWithAssets(Path.Combine(copied, "project.json"), content, workspace, true);
            Check(File.ReadAllText(Path.Combine(copied, "assets/a.svg")) == "<svg/>", "另存资源失败");
            File.WriteAllText(Path.Combine(copied, "assets/a.svg"), "keep"); var savedBefore = File.ReadAllText(Path.Combine(copied, "project.json"));
            Reject(() => HostFiles.SaveWithAssets(Path.Combine(copied, "project.json"), content, workspace, true)); Check(File.ReadAllText(Path.Combine(copied, "assets/a.svg")) == "keep" && File.ReadAllText(Path.Combine(copied, "project.json")) == savedBefore, "资源冲突覆盖了已有文件"); checks.Add("Save-as copies referenced assets and refuses conflicting destination resources");
            File.Delete(Path.Combine(root, "assets/a.svg")); Check(workspace.Available().Length == 0, "缺失资源被报告为可用"); Reject(() => HostFiles.SaveWithAssets(Path.Combine(root, "missing.json"), content, workspace, true)); checks.Add("Missing resources block runtime export before writing JSON");
            var gameRoot = Path.Combine(root, "game"); Directory.CreateDirectory(Path.Combine(gameRoot, "lib"));
            var files = new Dictionary<string, string> { ["index.html"] = "<html></html>", ["app.mjs"] = "export {};", ["lib/index.js"] = "export {};", ["project.json"] = "{\"game\":\"fixture\",\"title\":\"Fixture\"}" };
            foreach (var (name, text) in files) File.WriteAllText(Path.Combine(gameRoot, name), text, new UTF8Encoding(false));
            var entries = files.Select(f => { var bytes = Encoding.UTF8.GetBytes(f.Value); return new { name = f.Key, size = bytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() }; });
            File.WriteAllText(Path.Combine(gameRoot, "build-manifest.json"), JsonSerializer.Serialize(new { schema = 1, game = "fixture", files = entries }));
            Check(HostFiles.ValidateGame(gameRoot).Game == "fixture", "有效构建被拒绝"); File.AppendAllText(Path.Combine(gameRoot, "app.mjs"), "tampered"); Reject(() => HostFiles.ValidateGame(gameRoot)); checks.Add("The native player verifies every build-manifest size/hash before launch");
            Check(HostFiles.ProfileKey("a") == HostFiles.ProfileKey("a") && HostFiles.ProfileKey("a") != HostFiles.ProfileKey("b"), "作品配置隔离失败"); checks.Add("Player save profiles are stable per game and isolated from each other");
            Directory.CreateDirectory(Path.GetDirectoryName(report)!); File.WriteAllText(report, JsonSerializer.Serialize(new { schema = 1, result = "passed", checks }, new JsonSerializerOptions { WriteIndented = true })); return 0;
        }
        catch (Exception error) { Directory.CreateDirectory(Path.GetDirectoryName(report)!); File.WriteAllText(report, JsonSerializer.Serialize(new { result = "failed", checks, error = error.ToString() }, new JsonSerializerOptions { WriteIndented = true })); return 1; }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
