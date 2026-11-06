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
            const string recoveryProject = """{"schema":1,"type":"narrative","game":"fixture","version":"1","title":"中文恢复","assets":[],"scenes":[{"id":"start","lines":[{"speaker":"作者","text":"正文"}],"ending":"done"}]}""";
            using var recoveryProjectJson = JsonDocument.Parse(recoveryProject);
            var positions = new Dictionary<string, object>();
            var recoveryDocument = new { format = "vn-engine-editor", schema = 1, project = recoveryProjectJson.RootElement, positions };
            var recovery = JsonSerializer.Serialize(new { format = "vn-engine-recovery", schema = 1, document = recoveryDocument, source = "{未应用" });
            var originalRecovery = JsonSerializer.Serialize(new { format = "vn-engine-recovery", schema = 1, sourceText = "\r\n" + recoveryProject + "\r\n", positions });
            string RecoveryWithRawFormat(string value) => JsonSerializer.Serialize(new { format = "vn-engine-recovery", schema = 1,
                sourceText = recoveryProject.Insert(1, "\"format\":" + value + ","), positions });
            foreach (var value in new[] { "null", "\"\"", "false", "0", "-0" }) HostFiles.ValidateRecovery(RecoveryWithRawFormat(value));
            foreach (var value in new[] { "\"vn-engine-editor\"", "\"other\"", "\"0\"", "true", "1", "[]", "{}" })
                Reject(() => HostFiles.ValidateRecovery(RecoveryWithRawFormat(value)));
            var recoveryPath = Path.Combine(root, "workspace.vnrecover");
            HostFiles.WriteRecovery(recoveryPath, recovery);
            Check(HostFiles.ReadRecovery(recoveryPath) == recovery, "编辑器工程恢复内容未保留");
            HostFiles.WriteRecovery(recoveryPath, originalRecovery);
            Check(HostFiles.ReadRecovery(recoveryPath) == originalRecovery, "原始工程恢复内容未保留");
            var recoveryBefore = File.ReadAllBytes(recoveryPath);
            Reject(() => HostFiles.WriteRecovery(recoveryPath, recoveryProject));
            Reject(() => HostFiles.WriteRecovery(recoveryPath, recovery.Insert(1, "\"baseURL\":\"https://assets.vnengine.test/private/\",")));
            Reject(() => HostFiles.WriteRecovery(recoveryPath, recovery.Insert(1, "\"schema\":1,")));
            Reject(() => HostFiles.WriteRecovery(recoveryPath, JsonSerializer.Serialize(new { format = "vn-engine-recovery", schema = 1, document = recoveryDocument, sourceText = recoveryProject, positions })));
            Check(File.ReadAllBytes(recoveryPath).SequenceEqual(recoveryBefore), "拒绝无效恢复内容后文件已改变");
            Reject(() => HostFiles.WriteRecovery(jsonPath, recovery));
            Check(File.ReadAllBytes(jsonPath).SequenceEqual(before), "恢复文件覆盖了普通工程");
            var unrelatedRecovery = Path.Combine(root, "unrelated.vnrecover");
            File.WriteAllText(unrelatedRecovery, "unrelated bytes");
            Reject(() => HostFiles.WriteRecovery(unrelatedRecovery, recovery));
            Check(File.ReadAllText(unrelatedRecovery) == "unrelated bytes", "恢复文件覆盖了异类内容");
            var directoryRecovery = Path.Combine(root, "directory.vnrecover"); Directory.CreateDirectory(directoryRecovery);
            Reject(() => HostFiles.ReadRecovery(directoryRecovery));
            Reject(() => HostFiles.WriteRecovery(directoryRecovery, recovery));
            var exactLimit = recovery.PadRight(HostFiles.MaxRecovery);
            HostFiles.ValidateRecovery(exactLimit);
            Reject(() => HostFiles.ValidateRecovery(exactLimit + "界"));
            var oversizedRecovery = Path.Combine(root, "oversized.vnrecover");
            using (var stream = File.Create(oversizedRecovery)) stream.SetLength(HostFiles.MaxRecovery + 1);
            Reject(() => HostFiles.ReadRecovery(oversizedRecovery));
            checks.Add("Native recovery accepts either project representation, enforces the UTF-8 limit and rejects ambiguous, bound or unrelated files before writing");
            const string savedDsl = "vn-script 1\r\n# 已保存来源\r\n";
            const string pendingDsl = "vn-script 1\n# 待应用草稿";
            string RecoveryWithRawDsl(object? value) => JsonSerializer.Serialize(new { format = "vn-engine-recovery", schema = 1,
                sourceText = recoveryProject, positions, textScriptSource = value, textScriptDraft = pendingDsl });
            string RecoveryWithDocumentDsl(object? value) => JsonSerializer.Serialize(new { format = "vn-engine-recovery", schema = 1,
                document = new { recoveryDocument.format, recoveryDocument.schema, recoveryDocument.project, recoveryDocument.positions, textScriptSource = value }, textScriptDraft = pendingDsl });
            foreach (var withDsl in new[] { RecoveryWithRawDsl(savedDsl), RecoveryWithDocumentDsl(savedDsl) })
            {
                HostFiles.WriteRecovery(recoveryPath, withDsl);
                Check(HostFiles.ReadRecovery(recoveryPath) == withDsl, "恢复文件更改了已保存 DSL 或待保存草稿");
            }
            foreach (var invalid in new object?[] { null, 4, new object(), new string('x', 1_000_001) })
            {
                Reject(() => HostFiles.ValidateRecovery(RecoveryWithRawDsl(invalid)));
                Reject(() => HostFiles.ValidateRecovery(RecoveryWithDocumentDsl(invalid)));
            }
            HostFiles.ValidateRecovery(RecoveryWithRawDsl(new string('x', 1_000_000)));
            Reject(() => HostFiles.ValidateRecovery(recovery.Insert(1, "\"textScriptSource\":\"outside-document\",")));
            checks.Add("Native recovery keeps saved DSL and pending text separate in both project representations and rejects invalid or ambiguous source fields");
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
