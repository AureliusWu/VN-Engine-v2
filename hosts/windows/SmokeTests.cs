using System.Text.Json;

namespace VNEngine.Windows;

internal static class SmokeTests
{
    private static bool running;
    internal static async Task Run(HostWindow window)
    {
        if (running) return; running = true;
        var checks = new List<string>();
        async Task<string> JS(string script) => await window.Browser.CoreWebView2.ExecuteScriptAsync(script);
        async Task Wait(string script)
        {
            var until = DateTime.UtcNow.AddSeconds(35);
            while (DateTime.UtcNow < until) { if (await JS(script) == "true") return; await Task.Delay(100); }
            throw new TimeoutException("原生浏览器检查超时：" + script);
        }
        if (!window.IsGame)
        {
            await Wait("document.body.dataset.editorReady === 'true' && !!document.querySelector('#preview').contentDocument?.querySelector('.vn-engine')");
            checks.Add("Native WinForms/WebView2 window starts the bundled editor and own runtime preview");
            if (window.Options.VerifyPersistence)
            {
                if (await JS("localStorage.getItem('vn-native-smoke:studio') === 'retained'") != "true") throw new InvalidDataException("编辑器本地配置未持久化");
                checks.Add("Editor profile survives a complete process restart");
            }
            else await JS("localStorage.setItem('vn-native-smoke:studio','retained')");
            await JS("document.querySelector('[data-command=open]').click()");
            await Wait("document.body.dataset.projectType === 'narrative' && document.querySelector('#preview').contentDocument?.querySelector('.vn-portrait')?.naturalWidth > 0");
            checks.Add("Trusted editor RPC opens JSON through native file IO and loads manifest-only local assets");
            await JS("(()=>{const input=document.querySelector('[aria-label=\"作品名称\"]'); input.value='Windows native smoke'; input.dispatchEvent(new Event('change'));})()");
            await Wait("document.body.dataset.dirty === 'true'");
            await JS("document.querySelector('[data-command=save]').click()");
            await Wait("document.body.dataset.dirty === 'false'");
            var saved = window.SmokeSavedFile ?? throw new IOException("没有保存原生工程");
            using (var document = JsonDocument.Parse(HostFiles.ReadJson(saved))) if (HostFiles.Project(document.RootElement).GetProperty("title").GetString() != "Windows native smoke") throw new InvalidDataException("工程写入结果不同");
            HostFiles.LocalFile(Path.GetDirectoryName(saved)!, "assets/student.svg");
            checks.Add("Native save writes the edited workspace atomically and copies referenced local assets");
            await JS("document.querySelector('[data-command=export]').click()");
            var export = Path.Combine(window.SmokeFolder, "project.json");
            var exportUntil = DateTime.UtcNow.AddSeconds(10); while (!File.Exists(export) && DateTime.UtcNow < exportUntil) await Task.Delay(100);
            using (var document = JsonDocument.Parse(HostFiles.ReadJson(export))) if (document.RootElement.GetProperty("type").GetString() != "narrative" || document.RootElement.TryGetProperty("format", out _)) throw new InvalidDataException("运行数据导出不是原始引擎工程");
            checks.Add("Native export produces engine project JSON without editor metadata");
            var previousRevision = await JS("Number(document.body.dataset.previewRevision)");
            await JS("document.querySelector('[data-command=open]').click()");
            await Wait("Number(document.body.dataset.previewRevision)>" + previousRevision + " && document.querySelector('#project-name').textContent === 'Windows native smoke' && document.querySelector('#preview').contentDocument?.querySelector('.vn-portrait')?.naturalWidth > 0");
            checks.Add("Saved workspace reopens from its new directory with its copied assets");
            await JS("window.nativeDenied=false; const onDenied=e=>{if(e.data?.id==='smoke-invalid'){window.nativeDenied=e.data.ok===false;chrome.webview.removeEventListener('message',onDenied)}};chrome.webview.addEventListener('message',onDenied);chrome.webview.postMessage({id:'smoke-invalid',command:'read-any-file',path:'C:/Windows/win.ini'})");
            await Wait("window.nativeDenied === true");
            checks.Add("The native bridge rejects undeclared commands");
        }
        else
        {
            await Wait("!!document.querySelector('.vn-engine') && document.querySelector('.vn-portrait')?.naturalWidth > 0");
            checks.Add("Standalone packaged game runs in a native window with local graphics");
            if (window.Browser.CoreWebView2.Settings.IsWebMessageEnabled) throw new InvalidOperationException("作品窗口暴露了桌面文件桥");
            checks.Add("Game windows disable the privileged editor bridge");
            if (!window.Options.VerifyPersistence)
            {
                await JS("document.querySelector('[data-control=next]').click()");
                await Wait("!!document.querySelector('[data-action=together]')");
                await JS("document.querySelector('[data-action=together]').click()");
                await Wait("document.querySelector('.vn-text').textContent.length > 5 && !document.querySelector('[data-action=together]')");
                await Task.Delay(250);
                await JS("document.querySelector('[data-control=save]').click();document.querySelector('[data-slot=\"1\"] button').click();localStorage.setItem('vn-native-smoke:expected',document.querySelector('.vn-text').textContent)");
                if (await JS("!!localStorage.getItem('vn-engine:" + window.GameKey + ":v2:save:manual-1')") != "true") throw new InvalidDataException("作品存档未写入原生配置目录");
                checks.Add("Real choices and engine saves execute in the Windows player");
                // CI's Windows runner may request reduced motion; emulate normal preference only for this playback test.
                await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia", "{\"features\":[{\"name\":\"prefers-reduced-motion\",\"value\":\"no-preference\"}]}");
                await JS("""
                  window.nativeCollectionSmoke = 'pending';
                  import('./lib/index.js').then(async ({createProject, mountGame}) => {
                    const root = document.createElement('div'); document.body.append(root);
                    const baseURL = new URL('./', location.href), game = 'native-collection-fixture';
                    for (const key of Object.keys(localStorage)) if (key.startsWith('vn-engine:' + game + ':')) localStorage.removeItem(key);
                    const project = {schema:1, game, version:'v1', title:'Native collections', type:'narrative', settings:{textDelayMs:0},
                      assets:[{id:'memory', kind:'cg', src:'assets/letter.svg'}, {id:'hero', kind:'portrait', src:'assets/student.svg'}, {id:'clip', kind:'video', src:'assets/test-video.webm'}],
                      stage:{lines:{one:{layers:{'character-front':{asset:'hero', kind:'portrait'}}, timeline:{durationMs:1000,
                        animations:[{id:'move', layer:'character-front', target:'hero', to:{x:55, opacity:1}, durationMs:1000}]},
                        video:{asset:'clip', muted:true, fallback:{asset:'memory', kind:'cg'}}}}},
                      scenes:[{id:'start', lines:[{id:'one', speaker:'Narrator', text:'replay start'}, {id:'two', speaker:'Narrator', text:'replay end'}], cg:'memory', cgFrom:1, ending:'complete'}]};
                    const scratch = createProject(project, baseURL), replay = scratch.session.save(); scratch.session.dispose();
                    project.collections = {cgs:[{id:'memory', title:'Hidden title', replay}], endings:[{id:'complete', title:'Ending', replay}]};
                    const instance = mountGame(root, project, {baseURL, audio:false});
                    const query = selector => root.querySelector(selector), clickText = text => [...query('.vn-modal').querySelectorAll('button')].find(b => b.textContent === text)?.click();
                    const deadline = Date.now() + 7000;
                    while (query('.vn-video').currentTime < .05 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
                    if (query('.vn-video').currentTime < .05) {
                      const v = query('.vn-video');
                      throw Error('Native video did not play: ' + JSON.stringify({hidden:v.hidden, error:v.error?.code, ready:v.readyState, network:v.networkState,
                        src:v.currentSrc, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, fallback:query('.vn-video-fallback').dataset.asset, status:query('.vn-status').textContent}));
                    }
                    query('[data-control=gallery]').click();
                    if (query('.vn-modal img') || query('.vn-modal').textContent.includes('Hidden title')) throw Error('Locked CG was exposed');
                    clickText('关闭'); instance.session.configure({reducedMotion:true});
                    if (!query('[data-layer="character-front"]').style.transform.includes('55px')) throw Error('Reduced motion did not settle the native timeline');
                    if (query('.vn-video-fallback').dataset.asset !== 'memory') throw Error('Native video fallback was not selected');
                    instance.session.next();
                    if (!query('[data-layer="character-front"]').style.transform.includes('55px')) throw Error('Final timeline state did not persist');
                    const state = JSON.stringify(instance.session.save().state), meta = localStorage.getItem(instance.meta.key), auto = localStorage.getItem(instance.persistence.contract.keyFor('auto'));
                    query('[data-control=gallery]').click(); clickText('查看 CG'); clickText('回看剧情');
                    if (!query('.vn-replay .vn-text')?.textContent.includes('replay start')) throw Error('Replay did not start');
                    query('.vn-replay [data-control=next]').click();
                    if (!query('.vn-replay .vn-text')?.textContent.includes('replay end')) throw Error('Replay did not advance');
                    clickText('返回图鉴');
                    if (JSON.stringify(instance.session.save().state) !== state || localStorage.getItem(instance.meta.key) !== meta || localStorage.getItem(instance.persistence.contract.keyFor('auto')) !== auto) throw Error('Replay changed normal state');
                    instance.dispose(); root.remove(); window.nativeCollectionSmoke = 'passed';
                  }).catch(error => { window.nativeCollectionSmoke = 'failed: ' + error.message; });
                  """);
                await Wait("!!window.nativeCollectionSmoke && window.nativeCollectionSmoke !== 'pending'");
                var collectionResult = await JS("window.nativeCollectionSmoke");
                if (collectionResult != "\"passed\"") throw new InvalidDataException("Native collection/video check: " + collectionResult);
                await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia", "{\"features\":[]}");
                checks.Add("Native WebView2 plays local video under emulated normal motion; explicit reduced motion falls back, preserving timeline, gallery and replay state");
            }
            else
            {
                await JS("document.querySelector('[data-control=load]').click();document.querySelector('[data-slot=\"1\"] button').click()");
                await Wait("document.querySelector('.vn-text').textContent === localStorage.getItem('vn-native-smoke:expected')");
                checks.Add("A full native process restart restores the previously chosen game route");
            }
        }
        var saveControl = window.IsGame ? "document.querySelector('[data-control=save]')" : "document.querySelector('#preview').contentDocument.querySelector('[data-control=save]')";
        window.WindowState = FormWindowState.Minimized; await Wait(saveControl + "?.disabled === true");
        window.WindowState = FormWindowState.Normal; await Wait(saveControl + "?.disabled === false");
        checks.Add("Minimising and restoring the native window pauses and resumes its actual engine session");
        var previous = window.FormBorderStyle; window.ToggleFullScreen();
        if (window.FormBorderStyle != FormBorderStyle.None) throw new InvalidOperationException("原生全屏失败");
        window.ToggleFullScreen(); if (window.FormBorderStyle != previous) throw new InvalidOperationException("原生窗口恢复失败");
        checks.Add("Native fullscreen restores the original window");
        if (window.BlockedRequests.Count != 0) throw new InvalidOperationException("页面尝试下载外部资源：" + string.Join(", ", window.BlockedRequests));
        checks.Add("Editor/player startup uses local resources without external network requests");
        var report = new { schema = 1, platform = Environment.OSVersion.ToString(), webView = window.Browser.CoreWebView2.Environment.BrowserVersionString, mode = window.IsGame ? "game" : "studio", restart = window.Options.VerifyPersistence, result = "passed", checks, notes = new[] { "CI presets file picker paths; actual native file IO and WebView2 RPC are exercised. Manual interaction with OS file/folder dialogs is not claimed." } };
        Directory.CreateDirectory(Path.GetDirectoryName(window.Options.Report)!);
        File.WriteAllText(window.Options.Report, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        await using (var image = File.Create(Path.ChangeExtension(window.Options.Report, ".png"))) await window.Browser.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, image);
        window.Finish();
    }
}
