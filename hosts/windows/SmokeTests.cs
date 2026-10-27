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
            await JS("""
              window.nativePresentationAuthor = 'pending';
              try {
                const section = () => [...document.querySelectorAll('#inspector > details')].find(node => node.querySelector('summary')?.textContent === '正式图层与时间线');
                const change = (name, value) => { const input = section().querySelector('[aria-label="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('change')); };
                const click = name => [...section().querySelectorAll('button')].find(button => button.textContent === name).click();
                section().open = true;
                change('图层 character-front', JSON.stringify({asset:'lin/neutral', kind:'portrait'}));
                click('启用时间线'); click('添加动画轨道');
                change('轨道 1 图层', 'character-front'); change('轨道 1 目标资源', 'lin/neutral');
                change('轨道 1 终点 X', '70'); change('轨道 1 终点 缩放', '1.1');
                window.nativePresentationAuthor = 'ready';
              } catch (error) { window.nativePresentationAuthor = 'failed: ' + error.message; }
              """);
            if (await JS("window.nativePresentationAuthor === 'ready'") != "true") throw new InvalidDataException("Native timeline authoring: " + await JS("window.nativePresentationAuthor"));
            await Wait("document.querySelector('#preview').contentDocument?.querySelector('.vn-character-front')?.naturalWidth > 0 && document.querySelector('#preview').contentDocument.querySelector('.vn-character-front').style.transform.includes('70px')");
            checks.Add("Native Studio authors a formal layer and timeline through visual controls and renders its final pose in WebView2");
            await JS("document.querySelector('[data-tab=collections]').click(); [...document.querySelectorAll('#collection-list button')].find(button=>button.textContent==='添加CG').click()");
            await Wait("Number(document.body.dataset.previewRevision)>0 && !!document.querySelector('#preview').contentDocument?.querySelector('[data-control=gallery]')");
            await JS("[...document.querySelectorAll('#collection-list button')].find(button=>button.textContent==='使用当前预览作为回看起点').click()");
            await Wait("document.querySelector('#collection-list [aria-label=\"CG 1 回看数据\"]')?.value.includes('storyVersion')");
            checks.Add("Native Studio configures a CG collection and captures a real driver replay save from WebView2 preview");
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
            using (var document = JsonDocument.Parse(HostFiles.ReadJson(export))) if (document.RootElement.GetProperty("type").GetString() != "narrative" || document.RootElement.TryGetProperty("format", out _) || !document.RootElement.GetProperty("collections").GetProperty("cgs")[0].TryGetProperty("replay", out _)) throw new InvalidDataException("运行数据导出不是含回看起点的原始引擎工程");
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
                      assets:[{id:'memory', kind:'cg', src:'assets/letter.svg'}, {id:'brand', kind:'ui', src:'assets/letter.svg'}, {id:'hero', kind:'portrait', src:'assets/student.svg'}, {id:'clip', kind:'video', src:'assets/test-video.webm'}],
                      stage:{lines:{one:{layers:{'character-front':{asset:'hero', kind:'portrait'}}, timeline:{durationMs:1000,
                        animations:[{id:'move', layer:'character-front', target:'hero', to:{x:55, opacity:1}, durationMs:1000}]},
                        keyVisual:{asset:'brand', scope:'banner', sceneType:'story', durationMs:30000},
                        video:{asset:'clip', muted:true, fallback:{asset:'memory', kind:'cg'}}}}},
                      scenes:[{id:'start', lines:[{id:'one', speaker:'Narrator', text:'replay start'}, {id:'two', speaker:'Narrator', text:'replay end'}], cg:'memory', cgFrom:1, ending:'complete'}]};
                    const scratch = createProject(project, baseURL), replay = scratch.session.save(); scratch.session.dispose();
                    project.collections = {cgs:[{id:'memory', title:'Hidden title', replay}], endings:[{id:'complete', title:'Ending', replay}]};
                    const instance = mountGame(root, project, {baseURL, audio:false});
                    const query = selector => root.querySelector(selector), clickText = text => [...query('.vn-modal').querySelectorAll('button')].find(b => b.textContent === text)?.click();
                    query('[data-control=settings]').click();
                    for (const [label, value] of [['总音量','.5'],['背景音乐音量','.2'],['音效音量','.7'],['视频音量','.6'],['阅读字号','1.6']]) {
                      const input=query('[aria-label="'+label+'"]'); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
                    }
                    const high=[...query('.vn-modal').querySelectorAll('label')].find(node=>node.textContent==='高对比模式').querySelector('input'); high.checked=true;high.dispatchEvent(new Event('change',{bubbles:true}));
                    clickText('关闭');
                    if(query('.vn-engine').dataset.contrast!=='high' || instance.session.getView().settings.fontScale!==1.6) throw Error('Native reading accessibility settings did not apply');
                    if (query('.vn-video').volume !== .3 || instance.session.getView().settings.bgmVolume !== .2 || instance.session.getView().settings.seVolume !== .7) throw Error('Native sound channels did not compose independently');
                    if (JSON.parse(localStorage.getItem('vn-engine:'+game+':settings')).masterVolume !== .5) throw Error('Native sound settings were not persisted');
                    const deadline = Date.now() + 7000;
                    while (query('.vn-video').currentTime < .05 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
                    if (query('.vn-video').currentTime < .05) {
                      const v = query('.vn-video');
                      throw Error('Native video did not play: ' + JSON.stringify({hidden:v.hidden, error:v.error?.code, ready:v.readyState, network:v.networkState,
                        src:v.currentSrc, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, fallback:query('.vn-video-fallback').dataset.asset, status:query('.vn-status').textContent}));
                    }
                    if (query('.vn-key-visual').hidden || query('.vn-key-visual').dataset.scope !== 'banner') throw Error('Native Key Visual banner did not start');
                    query('[data-control=gallery]').click();
                    if (query('.vn-modal img') || query('.vn-modal').textContent.includes('Hidden title')) throw Error('Locked CG was exposed');
                    clickText('关闭'); instance.session.configure({reducedMotion:true});
                    if (!query('.vn-key-visual').hidden || query('.vn-key-visual img').hasAttribute('src')) throw Error('Native Key Visual did not clean up under reduced motion');
                    if (!query('[data-layer="character-front"]').style.transform.includes('55px')) throw Error('Reduced motion did not settle the native timeline');
                    if (query('.vn-video-fallback').dataset.asset !== 'memory') throw Error('Native video fallback was not selected');
                    instance.session.next();
                    if (!query('[data-layer="character-front"]').style.transform.includes('55px')) throw Error('Final timeline state did not persist');
                    const rollbackMeta = localStorage.getItem(instance.meta.key), rollbackAuto = localStorage.getItem(instance.persistence.contract.keyFor('auto'));
                    query('[data-control=rollback]').click();
                    if (!query('.vn-text').textContent.includes('replay start') || !query('[data-layer="character-front"]').style.transform.includes('55px')) throw Error('Native rollback did not restore the previous presentation');
                    if (localStorage.getItem(instance.meta.key) !== rollbackMeta || localStorage.getItem(instance.persistence.contract.keyFor('auto')) !== rollbackAuto) throw Error('Native rollback changed persistence or Meta');
                    instance.session.next();
                    const state = JSON.stringify(instance.session.save().state), meta = localStorage.getItem(instance.meta.key), auto = localStorage.getItem(instance.persistence.contract.keyFor('auto'));
                    query('[data-control=gallery]').click(); clickText('查看 CG'); clickText('回看剧情');
                    if (!query('.vn-replay .vn-text')?.textContent.includes('replay start')) throw Error('Replay did not start');
                    if (query('.vn-replay .vn-engine').dataset.contrast!=='high' || query('.vn-replay .vn-engine').style.getPropertyValue('--vn-font-scale')!=='1.6') throw Error('Native replay did not inherit reading preferences');
                    query('.vn-replay [data-control=next]').click();
                    if (!query('.vn-replay .vn-text')?.textContent.includes('replay end')) throw Error('Replay did not advance');
                    clickText('返回图鉴');
                    if (JSON.stringify(instance.session.save().state) !== state || localStorage.getItem(instance.meta.key) !== meta || localStorage.getItem(instance.persistence.contract.keyFor('auto')) !== auto) throw Error('Replay changed normal state');
                    clickText('关闭'); instance.persistence.saveManual(1); instance.persistence.quickSave();
                    const archive=instance.backup.export(); instance.session.restart(); instance.persistence.saveManual(1);
                    const backupState=JSON.stringify(instance.session.save().state), backupMeta=localStorage.getItem(instance.meta.key), beforeSlot=localStorage.getItem(instance.persistence.contract.keyFor('manual-1'));
                    query('[data-control=settings]').click();
                    const file=query('[data-import=backup]'), transfer=new DataTransfer(); transfer.items.add(new File([archive],'backup.json',{type:'application/json'}));file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}));
                    const previewDeadline=Date.now()+5000;
                    while(![...query('.vn-modal').querySelectorAll('button')].some(button=>button.textContent==='确认恢复这些槽位')&&Date.now()<previewDeadline) await new Promise(resolve=>setTimeout(resolve,50));
                    if(localStorage.getItem(instance.persistence.contract.keyFor('manual-1'))!==beforeSlot) throw Error('Native backup preview modified a stored slot');
                    clickText('确认恢复这些槽位');
                    if(!query('.vn-status').textContent.includes('已恢复') || JSON.stringify(instance.session.save().state)!==backupState || localStorage.getItem(instance.meta.key)!==backupMeta) throw Error('Native backup restore changed the current route or Meta');
                    instance.persistence.loadManual(1); if(instance.session.getView().frame.lineId!=='two') throw Error('Native archived slot did not restore its saved route');
                    instance.dispose();
                    const puzzleProject = {schema:1, game:'native-mini-game-fixture', version:'v1', title:'Native puzzle', type:'narrative', settings:{textDelayMs:0}, assets:[],
                      stage:{lines:{puzzle:{miniGame:{id:'switches',kind:'switches',initial:[false,false],target:[true,true],maxMoves:3,results:{success:'yes',failure:'no',abort:'no',skip:'yes'}}}}},
                      scenes:[{id:'start',lines:[{id:'puzzle',speaker:'N',text:'Solve the puzzle'}],choices:[{id:'yes',text:'Success',next:'end'},{id:'no',text:'Failure',next:'end'}]},
                        {id:'end',lines:[{id:'done',speaker:'N',text:'Puzzle finished'}],ending:'done'}]};
                    const puzzle = mountGame(root, puzzleProject, {baseURL,audio:false});
                    query('[data-control=mini-game-start]').click(); query('[data-input="0"]').click(); const puzzleSave=puzzle.session.save();
                    query('[data-input="0"]').click(); puzzle.session.restore(puzzleSave);
                    if (query('[data-input="0"]').getAttribute('aria-pressed')!=='true') throw Error('Native mini-game did not restore its input journal');
                    query('[data-input="1"]').click(); query('[data-control=mini-game-continue]').click();
                    if (puzzle.session.save().state.decisions[0].choiceId!=='yes') throw Error('Native mini-game result did not enter the story route');
                    query('[data-control=rollback]').click(); if (puzzle.session.getView().miniGame?.result!=='success') throw Error('Native mini-game rollback lost its result');
                    puzzle.dispose(); root.remove(); window.nativeCollectionSmoke = 'passed';
                  }).catch(error => { window.nativeCollectionSmoke = 'failed: ' + error.message; });
                  """);
                await Wait("!!window.nativeCollectionSmoke && window.nativeCollectionSmoke !== 'pending'");
                var collectionResult = await JS("window.nativeCollectionSmoke");
                if (collectionResult != "\"passed\"") throw new InvalidDataException("Native collection/video check: " + collectionResult);
                await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia", "{\"features\":[]}");
                checks.Add("Native WebView2 validates sound/readability settings, multi-slot backup preview/restore, video, scoped Key Visual, isolated replay, state rollback and mini-game lifecycle");
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
