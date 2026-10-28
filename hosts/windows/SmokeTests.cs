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
            var assemblyVersion = typeof(SmokeTests).Assembly.GetName().Version?.ToString(3) ?? throw new InvalidDataException("Missing assembly version");
            if (await JS("document.querySelector('#version').textContent === " + JsonSerializer.Serialize(assemblyVersion)) != "true") throw new InvalidDataException("Native executable and bundled engine versions differ");
            checks.Add("Native executable and bundled engine report the same version: " + assemblyVersion);
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
              window.nativeR2='pending';
              (async()=>{let game,root;try{
                const p=await(await fetch('/creative-game/project.json')).json();
                const {mountGame,ENGINE_VERSION}=await import('/creative-game/lib/index.js');
                if(ENGINE_VERSION!==document.querySelector('#version').textContent)throw Error('Creative runtime version mismatch');
                if(new Set(p.production.tasks.map(t=>t.kind)).size!==6||p.assets.some(a=>a.status!=='DRAFT'))throw Error('Creative production or draft status mismatch');
                const snapshot=()=>Object.entries(localStorage).filter(([k])=>k.includes(p.game));const before=JSON.stringify(snapshot());
                root=document.createElement('main');root.style='position:fixed;inset:0;z-index:99999;background:#111820;overflow:auto';document.body.append(root);
                game=mountGame(root,p,{baseURL:new URL('/creative-game/',location.href),storage:null,audio:false});
                await Promise.all([...root.querySelectorAll('img')].filter(i=>i.getAttribute('src')).map(i=>i.decode()));await document.fonts.ready;
                if(root.querySelector('.vn-engine').dataset.uiTheme!=='dusk'||getComputedStyle(root.querySelector('.vn-engine')).getPropertyValue('--vn-ui-accent')!=='#edc98f')throw Error('Creative theme mismatch');
                window.nativeR2Continue=()=>{try{const save=game.session.save();if(!game.session.next()||!game.session.act('stay')||game.session.getView().frame.ending!=='One more page')throw Error('Creative branch mismatch');game.session.restore(save);if(game.session.getView().frame.lineId!=='arrival-1'||JSON.stringify(snapshot())!==before)throw Error('Creative save or isolated storage mismatch');window.nativeR2='passed';}catch(e){window.nativeR2='failed: '+e.message;}finally{game.dispose();root.remove();}};
                window.nativeR2='ready';
              }catch(e){game?.dispose();root?.remove();window.nativeR2='failed: '+e.message;}})();
              """);
            await Wait("window.nativeR2 !== 'pending'");
            if(await JS("window.nativeR2 === 'ready'")!="true")throw new InvalidDataException("Native R2 preview: "+await JS("window.nativeR2"));
            var creativeImage = Path.Combine(Path.GetDirectoryName(window.Options.Report)!, "creative-" + Path.GetFileNameWithoutExtension(window.Options.Report) + ".png");
            Directory.CreateDirectory(Path.GetDirectoryName(creativeImage)!);
            await using (var image = File.Create(creativeImage)) await window.Browser.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, image);
            await JS("window.nativeR2Continue()");
            if(await JS("window.nativeR2 === 'passed'")!="true")throw new InvalidDataException("Native R2 flow: "+await JS("window.nativeR2"));
            checks.Add("R2 six-discipline CLI sample renders actual generated illustrations and dusk theme, executes its branch and save reconstruction, preserves DRAFT and player storage, on first launch and restart");
            await JS("""
              window.nativeR3Sample='pending';
              (async()=>{let game,root;try{
                const p=await(await fetch('/iteration-game/project.json')).json(),{mountGame,ENGINE_VERSION}=await import('/iteration-game/lib/index.js');
                if(ENGINE_VERSION!==document.querySelector('#version').textContent||p.game!=='vn-iteration-bookshop'||p.ui.preset!=='paper'||p.assets.some(a=>a.status!=='DRAFT'))throw Error('R3 identity/theme/draft mismatch');
                if(p.program.blocks[0].lines[0].text!=='You found the note. Shall we read it before I close?'||p.program.blocks[0].exit.choices.find(c=>c.id==='leave').next!=='end')throw Error('R3 latest source/branch missing');
                const asset=p.assets.find(a=>a.id==='memory'),bytes=await(await fetch('/iteration-game/'+asset.src)).arrayBuffer();
                const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==asset.sha256||new DataView(bytes).getUint32(24,true)!==44100||bytes.byteLength!==176444)throw Error('R3 replacement audio differs from manifest');
                const before=JSON.stringify(Object.entries(localStorage).filter(([k])=>k.includes(p.game)));root=document.createElement('main');root.style='position:fixed;inset:0;z-index:99999;background:#111820;overflow:auto';document.body.append(root);
                game=mountGame(root,p,{baseURL:new URL('/iteration-game/',location.href),storage:null,audio:false});await Promise.all([...root.querySelectorAll('img')].filter(i=>i.getAttribute('src')).map(i=>i.decode()));await document.fonts.ready;
                if(root.querySelector('.vn-engine').dataset.uiTheme!=='paper')throw Error('R3 latest theme not rendered');
                window.nativeR3SampleContinue=()=>{try{const saved=game.session.save();game.session.next();game.session.act('leave');if(game.session.getView().frame.ending!=='Tomorrow')throw Error('R3 revised branch failed');game.session.restore(saved);if(game.session.getView().frame.lineId!=='arrival-1'||before!==JSON.stringify(Object.entries(localStorage).filter(([k])=>k.includes(p.game))))throw Error('R3 restore/storage isolation failed');window.nativeR3Sample='passed';}catch(e){window.nativeR3Sample='failed: '+e.message;}finally{game.dispose();root.remove();}};
                window.nativeR3Sample='ready';
              }catch(e){game?.dispose();root?.remove();window.nativeR3Sample='failed: '+e.message;}})();
              """);
            await Wait("window.nativeR3Sample!=='pending'");
            if(await JS("window.nativeR3Sample==='ready'")!="true")throw new InvalidDataException("Native R3 revised sample: "+await JS("window.nativeR3Sample"));
            var iterationImage=Path.Combine(Path.GetDirectoryName(window.Options.Report)!, "iteration-"+Path.GetFileNameWithoutExtension(window.Options.Report)+".png");
            await using(var image=File.Create(iterationImage))await window.Browser.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png,image);
            await JS("window.nativeR3SampleContinue()");
            if(await JS("window.nativeR3Sample==='passed'")!="true")throw new InvalidDataException("Native R3 revised flow: "+await JS("window.nativeR3Sample"));
            checks.Add("R3 CLI-built second revision renders latest source/images/paper theme and verifies new 44100 Hz audio bytes, revised leave branch, save reconstruction and isolated player storage on first launch and restart");
            await JS("""
              document.querySelector('[data-tab=production]').click();
              window.nativeR3Change=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');if(!input)throw Error('Missing R3 field '+label);input.value=value;input.dispatchEvent(new Event('change'));};
              window.nativeR3Click=label=>{const button=[...document.querySelectorAll('#production-list button')].find(b=>b.textContent===label);if(!button||button.disabled)throw Error('Missing R3 control '+label);button.click();};
              nativeR3Change('作品前提','Native R3 review fixture');nativeR3Click('六类任务');nativeR3Click('添加剧情任务');
              nativeR3Change('任务简报 story-1','Review the opening on the native host');
              nativeR3Click('主题');nativeR3Change('主题预设','paper');document.querySelector('[data-command=undo]').click();document.querySelector('[data-command=redo]').click();document.querySelector('[data-command=undo]').click();
              nativeR3Click('问题与反馈');
              """);
            if (window.Options.VerifyPersistence)
            {
                await JS("nativeR3Click('打开审阅文档')");
                await Wait("document.querySelector('[data-feedback-id=\"native-r3\"] [data-freshness]')?.dataset.freshness === 'fresh'");
                if(await JS("document.querySelector('[data-feedback-id=\"native-r3\"]').textContent.includes('合成夹具')")!="true")throw new InvalidDataException("Native R3 review did not survive full process restart");
                checks.Add("R3 independent review.json reopens with its history and matching project/file identity after a complete process restart");
            }
            else
            {
                await JS("""
                  nativeR3Change('反馈 ID','native-r3');nativeR3Change('操作者（自报）','Synthetic native reviewer');
                  const target=[...document.querySelector('[aria-label="反馈目标"]').options].find(o=>JSON.parse(o.value).kind==='line').value;
                  nativeR3Change('反馈目标',target);nativeR3Change('反馈意见','合成夹具：核对原生开场；不是人工剧情终审');nativeR3Click('记录问题');
                  """);
                await Wait("document.querySelector('[data-feedback-id=\"native-r3\"] [data-freshness]')?.dataset.freshness === 'fresh'");
            }
            await JS("nativeR3Change('修复或重开说明 native-r3','Synthetic native repair statement');nativeR3Click('记录修复 native-r3')");
            await Wait("document.querySelector('[data-feedback-id=\"native-r3\"] [data-freshness]')?.textContent.includes('已修复待复验')");
            await JS("nativeR3Change('复验声明 native-r3','Synthetic fixture only, no human acceptance');nativeR3Click('确认复验 native-r3')");
            await Wait("document.querySelector('[data-feedback-id=\"native-r3\"] [data-freshness]')?.textContent.includes('已复验')");
            await JS("nativeR3Click('重开问题 native-r3')");
            await Wait("document.querySelector('[data-feedback-id=\"native-r3\"] [data-freshness]')?.textContent.includes('重开')");
            await JS("nativeR3Click('保存审阅文档')");
            var reviewFile = Path.Combine(window.SmokeFolder, "review.json");
            await Wait("document.querySelector('#status')?.textContent.includes('审阅文档已保存')");
            HostFiles.ValidateAuthorReview(HostFiles.ReadJson(reviewFile));
            await JS("nativeR3Click('打开审阅文档')");
            await Wait("document.querySelector('#status')?.textContent.includes('审阅文档已打开') && document.querySelector('[data-feedback-id=\"native-r3\"] [data-freshness]')?.dataset.freshness==='fresh'");
            var beforeReviewConflict = HostFiles.ReadJson(reviewFile); File.AppendAllText(reviewFile, "\n");
            await JS("nativeR3Click('保存审阅文档')");
            await Wait("document.querySelector('#status')?.textContent.includes('外部修改')");
            if (File.ReadAllText(reviewFile) != beforeReviewConflict + "\n") throw new IOException("Native review conflict overwrote external bytes");
            await JS("nativeR3Click('打开审阅文档')");
            await Wait("document.querySelector('#status')?.textContent.includes('审阅文档已打开')");
            await JS("nativeR3Click('保存审阅文档')");
            await Wait("document.querySelector('#status')?.textContent.includes('审阅文档已保存')");
            checks.Add("Native review save rejects external file changes without overwriting them, then reopens and saves the observed revision");
            var reviewImage = Path.Combine(Path.GetDirectoryName(window.Options.Report)!, "review-" + Path.GetFileNameWithoutExtension(window.Options.Report) + ".png");
            await using (var image = File.Create(reviewImage)) await window.Browser.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, image);
            await JS("nativeR3Click('定位问题 native-r3')");
            await Wait("document.querySelector('[data-tab=story]').getAttribute('aria-pressed')==='true' && document.activeElement?.getAttribute('aria-label')?.includes('ID')");
            checks.Add("R3 native production/task/theme controls share undo/redo; targeted feedback completes addressed/verified/reopened, atomic separate-file save, reopen and source/file freshness; reviewer statements are synthetic fixtures");
            await JS("document.querySelector('[data-tab=production]').click();nativeR3Click('素材与试听');nativeR3Change('素材种类','audio')");
            await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new { expression = "[...document.querySelectorAll('#production-list button')].find(b=>b.textContent.startsWith('试听 ')).click()", userGesture = true }));
            await Wait("document.querySelector('[data-audition]')?.currentTime > .03 && !document.querySelector('[data-audition]').paused");
            await JS("document.querySelector('[data-tab=story]').click()");
            await Wait("!document.querySelector('[data-audition]')");
            checks.Add("R3 native audition plays actual local audio and releases the media element when leaving the panel");
            var acceptanceFile = Path.Combine(window.SmokeFolder, "acceptance.json");
            if (!window.Options.VerifyPersistence)
            {
                File.WriteAllText(Path.Combine(window.SmokeFolder, "acceptance-input.txt"), "R4 bounded evidence");
                await JS("""
                  window.nativeR4File='pending';
                  (async()=>{try{const {nativeRequest}=await import('/editor/native.mjs');const {ENGINE_VERSION}=await import('/lib/index.js');
                    const h='a'.repeat(64),doc={contract:'vn-ai-acceptance-v1',schema:1,game:document.querySelector('[aria-label="作品 ID"]').value,storyVersion:document.querySelector('[aria-label="故事版本"]').value,engineVersion:ENGINE_VERSION,rubricVersion:'r4-1',binding:{sourceSha256:h,filesVerified:false,assets:[]},inputs:[{id:'project',kind:'project',src:'$source',sha256:h},{id:'bounded',kind:'image',src:'acceptance-input.txt',sha256:h}],reviews:[],fixture:true};
                    await nativeRequest('save-ai-acceptance',{content:JSON.stringify(doc)});window.nativeR4File='saved';
                  }catch(e){window.nativeR4File='failed: '+e.message;}})();
                  """);
                await Wait("window.nativeR4File!=='pending'");
                if(await JS("window.nativeR4File==='saved'")!="true")throw new InvalidDataException("Native R4 save failed: "+await JS("window.nativeR4File"));
            }
            HostFiles.ValidateAiAcceptance(HostFiles.ReadJson(acceptanceFile));
            await JS("""
              window.nativeR4File='pending';(async()=>{try{const {nativeRequest}=await import('/editor/native.mjs');const opened=await nativeRequest('open-ai-acceptance');const d=JSON.parse(opened.content);if(d.contract!=='vn-ai-acceptance-v1'||d.fixture!==true)throw Error('Acceptance identity missing');
                const input=await nativeRequest('read-ai-acceptance-input',{inputId:'bounded'});if(atob(input.base64)!=='R4 bounded evidence')throw Error('Evidence bytes differ');
                try{await nativeRequest('read-ai-acceptance-input',{inputId:'not-declared'});throw Error('Undeclared evidence allowed');}catch(e){if(e.message==='Undeclared evidence allowed')throw e;}
                window.nativeR4File='opened';window.nativeR4Content=opened.content;
              }catch(e){window.nativeR4File='failed: '+e.message;}})();
              """);
            await Wait("window.nativeR4File!=='pending'");
            if(await JS("window.nativeR4File==='opened'")!="true")throw new InvalidDataException("Native R4 reopen failed: "+await JS("window.nativeR4File"));
            var beforeAcceptanceConflict=File.ReadAllText(acceptanceFile);File.AppendAllText(acceptanceFile,"\n");
            await JS("window.nativeR4File='pending';import('/editor/native.mjs').then(m=>m.nativeRequest('save-ai-acceptance',{content:window.nativeR4Content})).then(()=>window.nativeR4File='unexpected save',e=>window.nativeR4File=e.message)");
            await Wait("window.nativeR4File!=='pending'");
            if(File.ReadAllText(acceptanceFile)!=beforeAcceptanceConflict+"\n"||await JS("window.nativeR4File.includes('外部修改')")!="true")throw new IOException("Native R4 conflict overwrote acceptance");
            await JS("document.querySelector('[data-tab=production]').click();nativeR3Click('验证状态');nativeR3Click('打开 AI 终审文档')");
            await Wait("document.querySelector('[data-ai-acceptance-report]')?.textContent.includes('AI 模拟终审：BLOCKED') && document.querySelector('#status')?.textContent.includes('AI 模拟终审核对完成')");
            checks.Add("R4 native AI acceptance separate save/open, declared bounded evidence, conflict preservation and unverified fixture refusal execute on first launch and full restart");
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
            await JS("document.querySelector('[data-tab=routes]').click();document.querySelector('[data-route-command=record]').click()");
            await Wait("document.body.dataset.routeRecording === 'true'");
            await JS("document.querySelector('#preview').contentDocument.querySelector('[data-control=next]').click()");
            await Wait("!!document.querySelector('#preview').contentDocument.querySelector('[data-action=together]')");
            await JS("document.querySelector('#preview').contentDocument.querySelector('[data-action=together]').click();document.querySelector('#preview').contentDocument.querySelector('[data-control=next]').click();document.querySelector('[data-route-command=capture]').click()");
            await Wait("!!document.querySelector('[aria-label=\"用例 1 ID\"]')");
            await JS("document.querySelector('[data-route-command=run]').click()");
            await Wait("['PASS','FAIL','UNVERIFIED'].includes(document.body.dataset.routeStatus)");
            if(await JS("document.body.dataset.routeStatus === 'PASS' && document.querySelector('[data-route-case=\"route-1\"]')?.dataset.result === 'PASS' && document.querySelectorAll('[data-route-case]').length === 4")!="true") throw new InvalidDataException("原生路线录制 / Worker 验证未通过样例和实际录制用例");
            checks.Add("Native Studio records actual preview actions and runs the captured case plus all declared sample ending routes in an isolated Worker");
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
            using (var document = JsonDocument.Parse(HostFiles.ReadJson(export))) if (document.RootElement.GetProperty("type").GetString() != "narrative" || document.RootElement.TryGetProperty("format", out _) || !document.RootElement.GetProperty("collections").GetProperty("cgs")[0].TryGetProperty("replay", out _) || document.RootElement.GetProperty("routeTests").GetProperty("cases").GetArrayLength()!=4) throw new InvalidDataException("运行数据导出不是含回看起点和路线用例的原始引擎工程");
            checks.Add("Native export produces engine project JSON without editor metadata");
            var previousRevision = await JS("Number(document.body.dataset.previewRevision)");
            await JS("document.querySelector('[data-command=open]').click()");
            await Wait("Number(document.body.dataset.previewRevision)>" + previousRevision + " && document.querySelector('#project-name').textContent === 'Windows native smoke' && document.querySelector('#preview').contentDocument?.querySelector('.vn-portrait')?.naturalWidth > 0");
            checks.Add("Saved workspace reopens from its new directory with its copied assets");
            await JS("""
              window.nativeLogicAuthor='pending';
              (async()=>{try {
                const {newProject}=await import('/lib/editor/index.js');
                const load=p=>{document.querySelector('[data-tab=source]').click();document.querySelector('#source').value=JSON.stringify(p);document.querySelector('[data-command=apply-source]').click();document.querySelector('[data-tab=story]').click();};
                const change=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');if(!input)throw Error('Missing field '+label);input.value=value;input.dispatchEvent(new Event('change'));};
                const click=label=>{const button=[...document.querySelectorAll('#inspector button')].find(b=>b.textContent===label);if(!button||button.disabled)throw Error('Unavailable control '+label);button.click();};
                const p=newProject('script');p.settings={textDelayMs:0};p.program.variables.found={initial:false};
                p.program.blocks[0].exit.choices[0].next='gate';
                p.program.blocks[1].lines[0].text='原生条件命中';
                p.program.blocks.push({id:'bad',lines:[{id:'bad-1',speaker:'作者',text:'原生条件未满足'}],exit:{type:'end',ending:'bad'}});
                p.program.blocks.push({id:'gate',lines:[],exit:{type:'branch',routes:[{next:'bad'}]}});
                load(p);document.querySelector('[aria-label="编辑节点 gate"]').click();click('添加条件路由');
                change('路由 1 目标','end');change('路由 1 条件 1 运算','gte');change('路由 1 条件 1 值','1');
                click('路由 1 添加条件');change('路由 1 条件 2 变量','found');change('路由 1 条件 2 值','false');
                if(document.querySelector('[aria-label="路由 1 条件 2 运算"]').options.length!==1)throw Error('Boolean operator mismatch');
                if(document.querySelector('[data-command=export]').disabled)throw Error(document.querySelector('#diagnostics').textContent);
                document.querySelector('[data-command=preview]').click();window.nativeLogicAuthor='script-ready';
              }catch(e){window.nativeLogicAuthor='failed: '+e.message;}})();
              """);
            await Wait("window.nativeLogicAuthor !== 'pending'");
            if(await JS("window.nativeLogicAuthor === 'script-ready'")!="true")throw new InvalidDataException("Native condition authoring: "+await JS("window.nativeLogicAuthor"));
            await Wait("!!document.querySelector('#preview').contentDocument?.querySelector('[data-action=yes]')");
            await JS("document.querySelector('#preview').contentDocument.querySelector('[data-action=yes]').click()");
            await Wait("document.querySelector('#preview').contentDocument?.querySelector('.vn-text')?.textContent === '原生条件命中'");
            checks.Add("Native Studio authors numeric and boolean conditions through actual controls and the shared runtime selects the expected branch");
            await JS("""
              window.nativeEvidenceAuthor='pending';
              (async()=>{try {
                const {newProject}=await import('/lib/editor/index.js');const {runRouteSuite}=await import('/lib/index.js');
                const p=newProject('investigation');p.settings={textDelayMs:0};p.routeTests={schema:1,cases:[{id:'native-evidence',steps:['read','back','reason'].map(id=>({type:'action',id})),expect:{lineId:'chapter-1/end',ending:'chapter-1:complete',evidence:['note']}}]};
                document.querySelector('[data-tab=source]').click();document.querySelector('#source').value=JSON.stringify(p);document.querySelector('[data-command=apply-source]').click();document.querySelector('[data-tab=story]').click();
                const section=[...document.querySelectorAll('#inspector>details')].find(d=>d.querySelector('summary')?.textContent==='本章证据目录');section.open=true;
                const input=document.querySelector('[aria-label="证据 note ID"]');input.value='clue';input.dispatchEvent(new Event('change'));
                if(document.querySelector('[aria-label="动作 1 持有时隐藏"]').value!=='clue'||!document.querySelector('[aria-label="动作 2 所需证据 clue"]').checked)throw Error('Evidence references not rewritten');
                if(![...document.querySelectorAll('#inspector button')].find(b=>b.textContent==='删除证据 clue')?.disabled)throw Error('Referenced evidence can be deleted');
                document.querySelector('[data-tab=source]').click();const edited=JSON.parse(document.querySelector('#source').value);
                if(runRouteSuite(edited).status!=='PASS'||edited.routeTests.cases[0].expect.evidence[0]!=='clue')throw Error('Renamed evidence route did not pass');
                document.querySelector('[data-tab=story]').click();document.querySelector('[data-command=preview]').click();window.nativeEvidenceAuthor='ready';
              }catch(e){window.nativeEvidenceAuthor='failed: '+e.message;}})();
              """);
            await Wait("window.nativeEvidenceAuthor !== 'pending'");
            if(await JS("window.nativeEvidenceAuthor === 'ready'")!="true")throw new InvalidDataException("Native evidence authoring: "+await JS("window.nativeEvidenceAuthor"));
            await Wait("!!document.querySelector('#preview').contentDocument?.querySelector('[data-action=read]')");
            await JS("document.querySelector('#preview').contentDocument.querySelector('[data-action=read]').click();document.querySelector('#preview').contentDocument.querySelector('[data-action=back]').click();document.querySelector('#preview').contentDocument.querySelector('[data-action=reason]').click()");
            await Wait("document.querySelector('#preview').contentDocument?.querySelector('.vn-text')?.textContent === '记录已核对。'");
            checks.Add("Native evidence controls atomically rename real constraints and route assertions, protect deletion and complete the investigation in WebView2");
            await JS("""
              window.nativeWorkbench='pending';
              (async()=>{try{
                const {newProject}=await import('/lib/editor/index.js');const {runRouteSuite}=await import('/lib/index.js');
                const load=p=>{document.querySelector('[data-tab=source]').click();document.querySelector('#source').value=JSON.stringify(p);document.querySelector('[data-command=apply-source]').click();document.querySelector('[data-tab=story]').click();};
                const change=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');if(!input)throw Error('Missing field '+label);input.value=value;input.dispatchEvent(new Event('change'));};
                const click=label=>{const button=[...document.querySelectorAll('#structure-list button,#inspector button')].find(b=>b.textContent===label);if(!button||button.disabled)throw Error('Unavailable '+label);button.click();};
                const p=newProject('script');p.settings={textDelayMs:0};p.routeTests={schema:1,cases:[{id:'native-workbench',steps:[{type:'action',id:'yes'}],expect:{ending:'完成',variables:{trust:3,flag:true}}}]};
                load(p);document.querySelector('[data-tab=structure]').click();change('变量 trust ID','affinity');click('添加布尔变量');change('变量 variable-1 ID','flag');
                if(![...document.querySelectorAll('#structure-list button')].find(b=>b.textContent==='删除变量 affinity').disabled)throw Error('Referenced variable deletion unprotected');
                document.querySelector('[data-tab=story]').click();change('选择 1 效果 1 运算','set');change('选择 1 效果 1 值','3');click('选择 1 添加效果');change('选择 1 效果 2 变量','flag');change('选择 1 效果 2 值','true');
                click('选择 1 添加效果');change('选择 1 效果 3 值','2');click('选择 1 效果 3 上移');click('选择 1 效果 2 上移');
                document.querySelector('[data-tab=source]').click();const edited=JSON.parse(document.querySelector('#source').value);if(runRouteSuite(edited).status!=='PASS')throw Error('Typed effects route failed');
                document.querySelector('[data-tab=story]').click();document.querySelector('[data-command=preview]').click();window.nativeWorkbench='variables-ready';
              }catch(e){window.nativeWorkbench='failed: '+e.message;}})();
              """);
            await Wait("window.nativeWorkbench !== 'pending'");
            if(await JS("window.nativeWorkbench === 'variables-ready'")!="true")throw new InvalidDataException("Native variable workbench: "+await JS("window.nativeWorkbench"));
            await Wait("!!document.querySelector('#preview').contentDocument?.querySelector('[data-action=yes]')");
            await JS("document.querySelector('#preview').contentDocument.querySelector('[data-action=yes]').click()");
            await Wait("document.querySelector('#preview').contentDocument?.querySelector('.vn-text')?.textContent === '这里等待你的故事。'");
            checks.Add("Native workbench renames a variable, creates a boolean, authors and reorders typed effects and executes the asserted real route");
            await JS("""
              window.nativeChapterWorkbench='pending';
              (async()=>{try{
                const {newProject}=await import('/lib/editor/index.js');const {runRouteSuite}=await import('/lib/index.js');const p=newProject('investigation');p.settings={textDelayMs:0};
                const steps=['read','back','reason'].map(id=>({type:'action',id}));p.routeTests={schema:1,cases:[{id:'one',steps,expect:{ending:'chapter-1:complete'}},{id:'two',steps:[...steps,{type:'action',id:'@chapter:chapter-2'},{type:'next'}],expect:{ending:'chapter-2:complete',lineId:'chapter-2/end'}}]};
                document.querySelector('[data-tab=source]').click();document.querySelector('#source').value=JSON.stringify(p);document.querySelector('[data-command=apply-source]').click();document.querySelector('[data-tab=structure]').click();
                const click=label=>{const button=[...document.querySelectorAll('#structure-list button')].find(b=>b.textContent===label);if(!button||button.disabled)throw Error('Unavailable '+label);button.click();};
                const change=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');input.value=value;input.dispatchEvent(new Event('change'));};
                click('添加章节');change('章节 chapter-2 ID','final');change('章节 final 标题','原生终章');click('章节 final 上移');document.querySelector('[data-command=undo]').click();
                if(![...document.querySelectorAll('#structure-list button')].find(b=>b.textContent==='删除章节 final').disabled)throw Error('Referenced chapter deletion unprotected');
                document.querySelector('[data-tab=source]').click();const edited=JSON.parse(document.querySelector('#source').value);if(runRouteSuite(edited).status!=='PASS'||edited.routeTests.cases[1].steps[3].id!=='@chapter:final')throw Error('Cross-chapter references or route regression failed');
                document.querySelector('[data-tab=story]').click();document.querySelector('[data-command=preview]').click();window.nativeChapterWorkbench='ready';
              }catch(e){window.nativeChapterWorkbench='failed: '+e.message;}})();
              """);
            await Wait("window.nativeChapterWorkbench !== 'pending'");
            if(await JS("window.nativeChapterWorkbench === 'ready'")!="true")throw new InvalidDataException("Native chapter workbench: "+await JS("window.nativeChapterWorkbench"));
            await Wait("!!document.querySelector('#preview').contentDocument?.querySelector('[data-action=read]')");
            await JS("const root=document.querySelector('#preview').contentDocument;for(const id of ['read','back','reason','@chapter:final'])root.querySelector('[data-action=\"'+id+'\"]').click();root.querySelector('[data-control=next]').click()");
            await Wait("document.querySelector('#preview').contentDocument?.querySelector('.vn-text')?.textContent === '本章结束。'");
            checks.Add("Native chapter workbench adds and renames a chapter, preserves route references, undoes reordering and completes actual cross-chapter play");
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
                  import('./lib/index.js').then(async ({createProject, mountGame, runRouteSuite}) => {
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
                    puzzle.dispose();
                    const resumeProject={schema:1,game:'native-continue-fixture',version:'v1',title:'Native continue',type:'narrative',assets:[],settings:{textDelayMs:0},
                      scenes:[{id:'start',lines:[{id:'one',speaker:'N',text:'First'},{id:'two',speaker:'N',text:'Saved'}],ending:'done'}]};
                    let resumed=mountGame(root,resumeProject,{baseURL,audio:false});resumed.session.next();
                    const previousAuto=localStorage.getItem(resumed.persistence.contract.keyFor('auto'));resumed.dispose();
                    resumed=mountGame(root,resumeProject,{baseURL,audio:false});
                    if(localStorage.getItem(resumed.persistence.contract.keyFor('auto'))!==previousAuto) throw Error('Native remount overwrote previous Auto');
                    query('[data-control=continue]').click();if(resumed.session.getView().frame.lineId!=='two') throw Error('Native Continue did not restore previous Auto');
                    resumed.dispose();resumeProject.titleScreen=true;resumed=mountGame(root,resumeProject,{baseURL,audio:false});
                    if(query('.vn-engine').dataset.title!=='true'||!resumed.session.getView().paused) throw Error('Native title did not pause reading');
                    query('[data-control=title-settings]').click();query('.vn-engine').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
                    if(!query('[data-control=title-new]')) throw Error('Native settings did not return to title');
                    query('[data-control=title-continue]').click();if(resumed.session.getView().frame.lineId!=='two') throw Error('Native title Continue lost prior progress');
                    query('[data-control=title]').click();clickText('取消');if(query('.vn-engine').dataset.title!=='false') throw Error('Native return-title cancellation changed flow');
                    query('[data-control=title]').click();clickText('确认返回标题');query('[data-control=title-new]').click();clickText('取消');
                    if(!query('[data-control=title-resume]')) throw Error('Native cancelled new game did not retain the reading session');
                    query('[data-control=title-new]').click();clickText('确认开始新游戏');if(resumed.session.getView().frame.lineId!=='one') throw Error('Native new game did not reset the route');
                    resumed.readProgress.flush();const readKey=resumed.readProgress.key;
                    resumed.dispose();resumed=mountGame(root,resumeProject,{baseURL,audio:false});query('[data-control=title-new]').click();clickText('确认开始新游戏');
                    if(!resumed.session.setSkip(true)) throw Error('Native remount lost completed read markers');resumed.session.setSkip(false);resumed.readProgress.flush();
                    localStorage.setItem('vn-native-smoke:read-key',readKey);
                    const routeReport=runRouteSuite(resumeProject,{schema:1,cases:[{id:'native-route',steps:[{type:'next'}],expect:{ending:'done'}}]});
                    if(routeReport.status!=='PASS'||routeReport.restoreChecks!==2) throw Error('Native route matrix did not execute save/restore regression');
                    resumed.dispose();root.remove(); window.nativeCollectionSmoke = 'passed';
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
                if(await JS("JSON.parse(localStorage.getItem(localStorage.getItem('vn-native-smoke:read-key'))).records.length > 0")!="true") throw new InvalidDataException("原生进程重启未保留已读记录");
                checks.Add("Completed read markers survive a full native process restart");
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
