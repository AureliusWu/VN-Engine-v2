# v1.2.0 P1 验证记录

本轮只改引擎，实施资源计划 / 有预算的编码字节预取和受限文本作者前端。实施边界与 API 见 [P1 约定](P1_DEVELOPMENT.md)。不迁移四作，不改变 JSON IR、route replay、存档 envelope / payload 或游戏身份。未运行研究上游的脚本或构建产物，未复制其实现。

[机器记录](p1-validation.json)、[DSL 候选预览](previews/p1-dsl.png) 与 [来源过期的资源计划](previews/p1-resources.png) 分别保留可核对结果；截图来自自动化浏览器，不冒充人工实机操作。

## 逻辑与兼容证据

P1 focused Node 覆盖编译器 13 项、资源 16 项、Agent 4 项、集成 3 项，共 36 项：编译与手写 IR 精确等价，两条路线的 replay / 存读档与不可信变量拒绝，恢复回看改选，显式 ID / CJK / CRLF / 多行与转义，错误与预算，2500 选项 / 3500 路由，来源图的四类型与大工程惰性访问，stream cap、并发 / 预留 / active pin、abort 忽略者、迟到响应、失败后新意图重试、owner / Blob 释放及工程身份隔离。Agent 继续使用分页及 SHA 游标；300 项估算表不放大游标到无法继续读取。

CLI 实际编译 examples/dsl/branch.vn.txt；独立 source map 与 ScriptProgram 分开输出。集成测试验证目标存在时不覆盖、冲突不留半个新输出、无效文本不写文件、无工程路径的 Agent Node 编译不要求 project。编译器模块、原文和 source map 不进入独立玩家包。

`npm run check` 本机最终执行 323 项 Node：319 项通过，4 项既有符号链接夹具创建时遇 Windows EPERM，未进入相应断言。涉及 agent-imports、agent-node 两项和 package；未跳过或放宽检查、未改变系统权限。Python 6 项、schema 同步、194 项来源和四样例校验独立通过。完整核心通过以 Linux CI 的同提交结果为准，不把本机短路的 check 标为全量成功。

## 实际浏览器与构建

P1 runtime 专项直接控制本仓库的真实 DOM 播放器与网络请求，覆盖 6 个场景：默认关闭无 speculative fetch / 音频解锁；编码字节经 Blob 复用、不重复请求来源并保持 active pin；切分支取消慢响应；设置 / 打字通知不重试失败候选、新 visit 才重试；超下载预算不影响普通前台显示；隐藏暂停与 dispose 释放。原渲染器先 probe 再显示图片，no-store 时普通前台可能产生两次 image 请求，测试区分 fetch 与 image，不把该行为误报为预取重复。

P1 Studio 专项覆盖候选预览不改 JSON、source range 选中、单次撤销、其余字段完整保留、非法 / 身份不同文本拒绝，默认关闭和显式预算、实际预览计划 / 缓存、stale 来源禁定位、未应用候选 SHA 拒绝冒充当前工程与 390px 布局。独立 compiled JSON player 在子目录执行 good / neutral 两路线，SW 安装后断网新页重开成功，manifest / 网络均无文本编译器。

完整浏览器、完整 Studio、P0 三项专项及四样例路线 / 资源 / 包 QA 使用冻结构建顺序执行；结果文件留于 test-results/p1-full-browser-final.log、p1-full-editor-final.log、p1-qa-samples-final.log 及 p1-* / p0-* 目录。实际通过状态以这些记录与本轮 CI 为准，未执行的平台 / 主观听感不视为通过。

## 发现并修复

- 独立审阅用合法 4096 次前瞻、重复资源来源夹具发现逐项 JSON 序列化比较为二次复杂度，旧实现本机约 6.46 秒。改用内部 owner / origin Set 索引，保留输出顺序与格式，增加最大预算序列化工作量回归；同规模本机复测约 20—36 ms。该结果是具体夹具的实测，非正式性能百分比或整机内存承诺。
- 资源图从全工程规范化改为访问时读取节点 / 行，分支 fanout 到预算即停止，避免小预算复制无关大正文；缺少历史舞台的持久值继续标 unknown。
- Agent 大估算表使用 SHA 绑定分页身份，避免把整个提示表塞进游标；编译与资源查询始终只读，不产生修改 receipt。
- 实际交互复现预取预算未应用 / 暂时清空时，正文编辑触发自动预览抛错并卡在“正在刷新”。现只在显式配置时校验并冻结有效预算，自动预览沿用上次配置；无效输入留在面板供修复，不阻断正常作者操作。未应用 / 已应用两种情况均有浏览器回归。

## 实机控制与原生平台边界

本轮通过 computer-use 技能尝试实际 Windows 宿主。使用本仓库 P0 main `4620a7a` 的已通过 CI 的 1.1.0 portable host，加载本轮 1.2.0 Studio 包，使用独立临时 profile。Windows 正确列出 VN Engine Studio，但第一次捕获报 `FrameArrived timed out: timed out waiting on channel`；重新选择并激活同一目标后仍报 `window capture timed out: timed out waiting on channel`。遵循技能恢复规则停止应用输入，没有换用其他 UI 工具绕过。未取得界面操作结果，此项为 UNVERIFIED，不能记为实机通过。

Windows workflow 对本轮源码另行编译版本一致的 1.2.0 self-contained host，运行 P1 / P0、CLI、实际 WebView2 文件 IO、完整进程重启和 portable 产物身份检查。CI 原生执行与本机取帧失败、人工系统对话框和实体音频听感分开记录。本轮 PR 与最终 main 的 CI 状态在交付时核对，不在提交内预设成功。

## 来源与交付

新增原创模块标记 new，现有适配保留原来源哈希；Studio 字体从同 SHA 的 OFL SourceHanSansLite 重建子集并保持改名。临时 PR 分支只用于审查，交付后合并并清理，本地与远端只保留 main，不强推。v1.2.0 为代码版本，本轮不创建新 Release 或 tag。
