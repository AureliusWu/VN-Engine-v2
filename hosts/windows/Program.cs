using System.Text.Json;

namespace VNEngine.Windows;

internal sealed record HostOptions(string Site, string? GameDirectory, string? Profile, bool Smoke, bool VerifyPersistence, string Report)
{
    internal static HostOptions Parse(string[] args)
    {
        string? Value(string key) { var index = Array.IndexOf(args, key); if (index < 0) return null; if (index + 1 >= args.Length || args[index + 1].StartsWith("--")) throw new ArgumentException("缺少参数：" + key); return Path.GetFullPath(args[index + 1]); }
        return new(Value("--site") ?? Path.Combine(AppContext.BaseDirectory, "site"), Value("--game"), Value("--user-data-dir"), args.Contains("--smoke-test"), args.Contains("--verify-persistence"), Value("--report") ?? Path.Combine(AppContext.BaseDirectory, "windows-smoke.json"));
    }
}
internal static class Program
{
    internal static int Result;
    [STAThread]
    private static int Main(string[] args)
    {
        HostOptions? options = null;
        try
        {
            if (args.Contains("--self-test")) return HostTests.Run(HostOptions.Parse(args).Report);
            options = HostOptions.Parse(args);
            ApplicationConfiguration.Initialize();
            Application.Run(new HostWindow(options));
            return Result;
        }
        catch (Exception error)
        {
            if (options?.Smoke == true) { Directory.CreateDirectory(Path.GetDirectoryName(options.Report)!); File.WriteAllText(options.Report, JsonSerializer.Serialize(new { result = "failed", error = error.ToString() })); }
            else MessageBox.Show("VN Engine 未能启动：\n" + error.Message + "\n\n请确认已安装 Microsoft Edge WebView2 Runtime，且 site 目录与程序放在一起。", "VN Engine", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
