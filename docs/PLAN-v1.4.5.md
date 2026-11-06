# v1.4.5 Studio 制作目标诊断计划

日期 2026-11-06。基线 `5fc6adf55fe0021bda108ecb48599cf3609b3653`。本轮优化 `creativeDiagnostics`。基线为每个制作目标扫描节点和台词目录，任务环检测也会按 ID 重扫任务列表。Studio 结构诊断和工程校验共用这套规则。[基线目标与任务检查](https://github.com/AureliusWu/VN-Engine-v2/blob/5fc6adf55fe0021bda108ecb48599cf3609b3653/src/creative/project.ts#L14-L40) [Studio 调用](https://github.com/AureliusWu/VN-Engine-v2/blob/5fc6adf55fe0021bda108ecb48599cf3609b3653/src/editor/model.ts#L124)

## 开源与社区证据

- ink 固定提交 `35c63e52f1d36060930dc7ed3cfba38ea224b528`，MIT。`FlowBase.cs` 以所在 flow 的字典索引子 flow，解析时按作用域和层级查找，另行检查 knot 和 stitch 的命名冲突。本轮借鉴作用域内索引。Studio 制作目标继续要求章节精确相等，缺省章节只匹配缺省章节。[索引构建](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/compiler/ParsedHierarchy/FlowBase.cs#L48-L66) [按层级查找](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/compiler/ParsedHierarchy/FlowBase.cs#L284-L320) [冲突检查](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/compiler/ParsedHierarchy/FlowBase.cs#L365-L369)
- Yarn Spinner 固定提交 `c5215f86dd5a6761aecbdc9f60f6a6108f91f919`，MIT。字符串表分别索引行 ID 和解析上下文，发现重复的显式行 ID 时，为当前和已有声明的解析位置分别建立诊断。本轮借鉴查找数据与诊断位置分离，制作目标仍报在引用字段，台词目标仍按章节、节点和行 ID 判断是否存在。[行 ID 与上下文](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/StringTableManager.cs#L93-L106) [重复诊断](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/Visitors/StringTableGeneratorVisitor.cs#L130-L144)
- Ren’Py 固定提交 `4025f3c2611e10021e620a9a7894053123fae556`。`script.py` 在登记 AST 节点前用 `namemap` 检查冲突，并在启用重复诊断时保留两处文件和行号。Studio 借鉴登记时保留冲突所需的信息，节点使用计数，出现两份时仍判歧义。[名称索引与重复诊断](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/renpy/script.py#L661-L704)
- Lemma Soft Forums 中，一位 Ren’Py 7.2 作者在眼前的脚本里只看到一个 `start`。帖子里的报错同时列出当前脚本和嵌套工程中的脚本，回复据此指出第二份定义。这个案例说明冲突诊断的定位信息能帮助作者区分同名实体。论坛原页返回 403，本次读取的是搜索索引中收录的原帖和回复。[独立论坛案例](https://lemmasoft.renai.us/forums/viewtopic.php?t=54776)

## 实施范围

1. 继续先处理 production schema，沿用当前 `creativeNodes` 和 `textCatalogue`。遇到第一个制作目标时，才为本次调用按章节、节点建立索引。分别保存节点命中数和对应行 ID 集合。嵌套键保留章节缺省值、精确字符串比较和含分隔符的 ID。
2. 每条目标保留原有的两项检查。节点命中数必须恰好为一，提供行 ID 时仍独立检查该行是否存在。同一目标可按原顺序同时产生节点和台词诊断，保留原有代码、消息、严重级别及引用字段路径。制作节拍、任务和其他引用按原次序检查。
3. 任务依赖 DFS 用 ID 查找首个定义，保持现有重复提示、缺失引用、遍历顺序和环诊断。索引的生命周期限定在一次校验调用。沿用作者工程、已有剧本、播放器和存档格式。上游资料仅供设计参考，工程实现为本仓库原创。

## 验收

- 对照完整诊断数组，覆盖重复节点歧义、跨章同名、缺省章节、含分隔符的 ID、同节点重复行仍可命中、缺节点与缺行并报、重复任务按首定义参与 DFS，以及缺失引用和环诊断。核对 schema 短路、无目标工程、输入未改写和 Studio 诊断入口。
- 同机同 Node、相同输入和预热规则，小工程、大工程、无目标工程各比较基线与新版固定三轮。逐轮核对诊断一致，保留全部原始样本及中位、最慢耗时，按实际采样区分制作诊断和 Studio 完整诊断。结论限于测得的 Node 校验路径。
- 本地运行制作与 EditorModel 回归、`npm run check`、完整编辑器和浏览器套件。按同一提交 SHA 核对 Linux Engine checks 与 Windows native host，分别记录核心测试、真实浏览器、Windows 原生 WebView2 文件读写及完整进程重启。样例技术检查与内容验收分别记录。
