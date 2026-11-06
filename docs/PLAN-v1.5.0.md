# v1.5.0 Studio 工程恢复与引擎发行计划

日期 2026-11-06。基线 `f5aadb149f8beb516a3205fb0778a47f0add5bf2`。真实 Chromium 中，原始运行数据文件为 662 字节，实际预览采集的 evidence SHA-256 与其一致。本地草稿重开后，工程数据相同，导出却变为 1313 字节的规范化 JSON。来源 SHA-256 从 `c0d5a3fd26a45de10e37ece27604c85785ec8c5358dca39ba3282bb66c532b04` 变为 `6274332072a184ace514c94baacec29efb749f90c76062c21e329b95b50618e3`，同一 evidence 从当前变成过期。复现使用真实预览、下载和本地草稿，记录在 `test-results/v150-draft-source-baseline-repro.json`。[基线工程来源与草稿](https://github.com/AureliusWu/VN-Engine-v2/blob/f5aadb149f8beb516a3205fb0778a47f0add5bf2/editor/app.mjs#L17-L25) [基线 Linux](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/42183088630) [基线 Windows](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/42183088662)

## 开源与社区证据

- Twine 固定提交 `2c3b80144ba6f1fe9d8a4e5e11a2349ba55fc310`。官方手册区分故事库 Archive 和发布文件，Archive 支持跨浏览器、跨电脑备份，发布文件可试玩和再次导入。导入实现对同文件名先检查冲突。Studio 借鉴显式的可携恢复入口和冲突前置检查，每份恢复文件只承载一个工程。[官方归档说明](https://github.com/klembot/twinejs/blob/2c3b80144ba6f1fe9d8a4e5e11a2349ba55fc310/docs/en/src/story-library/exporting.md#L3-L19) [导入实现](https://github.com/klembot/twinejs/blob/2c3b80144ba6f1fe9d8a4e5e11a2349ba55fc310/src/store/stories/action-creators/import-stories.ts#L13-L43)
- Inky 维护者汇总了文件内容清空后无法撤销的报告，仍缺稳定复现。独立互动小说论坛中，Twine 作者报告同一浏览器中旧故事消失，且无可找到的归档，具体成因未知。这些案例支持把可移交的恢复文件和浏览器本地草稿分开，并验证损坏文件不会替换当前工程。[Inky 维护者记录](https://github.com/inkle/inky/issues/38) [Twine 作者原帖](https://intfiction.org/t/trying-to-recover-a-lost-twine-2-browser-story-from-2025/82154)

## 工程恢复

1. 继续读取已有本地草稿槽，保留现有替换时的草稿所有权保护。旧槽缺少原始来源时，只能恢复其中已有数据。新的 `.vnrecover` 使用专用格式标记和 schema 1，单文件可显式保存与恢复，作者可独立持有多个工程的恢复文件。
2. 恢复文件只保存一种工程表示。来源仍对应原始运行数据文件时，保存精确 `sourceText` 与节点位置。其余工程保存标准 Studio document。保留待应用 JSON、DSL、字段编辑和作者审阅。便携恢复排除本机路径、资源绑定和玩家数据，恢复后按现有流程重新绑定资源。文件上限 16 MB。
3. 全量校验通过后才替换当前工程。坏文件、超限、未知格式和失效异步导入各有可观察结果。Windows 使用恢复专用受限命令，沿用可信 WebView2 文件桥和原子写入。浏览器、生成 Studio 和 Windows 原生测试分别覆盖恢复入口。
4. 以原始文件的非规范化格式复测 evidence。未修改运行数据时保留来源 SHA-256，实际修改后按新来源核对。验证待编辑内容、撤销边界和资源重绑。沿用 `.vnproj`、运行工程与玩家存档契约。四作保持各自运行链。

## 本地和同 SHA 门禁

- 用旧码运行真实 Chromium 复现，保存失败原始证据。同样输入在新版核对来源哈希、实际 evidence 采集与重导入，覆盖旧槽、两种工程表示、未提交字段、无效恢复和大小边界。执行源码与生成 Studio、完整 Node、浏览器和编辑器检查。核对发布包体及恢复路径耗时，记录性能测量边界。
- 推送后按精确 `main` SHA 核对 Engine checks 与 Windows native host。Windows 先通过恢复专用命令的实际文件读写、WebView2 和完整进程重启，再采用同一成功运行的便携成品。样例技术 QA 与作品内容门禁分别记录。`npm run gate:release` 检查作品候选和内容，GitHub 引擎发行独立核验。[作品候选门禁](https://github.com/AureliusWu/VN-Engine-v2/blob/f5aadb149f8beb516a3205fb0778a47f0add5bf2/tools/release-gate.mjs#L7-L26) [Windows 打包和原生门禁](https://github.com/AureliusWu/VN-Engine-v2/blob/f5aadb149f8beb516a3205fb0778a47f0add5bf2/.github/workflows/windows.yml#L92-L129)

## GitHub 正式发行

1. 延续 v1.0.0 的四份自定义资产形态，发布 `VNEngine-Studio-1.5.0-win-x64.zip`、`RELEASE_MANIFEST.json`、`RELEASE_NOTES.md`、`SHA256SUMS.txt`。Windows ZIP 取自同一提交成功运行的 `VNEngine-Studio-win-x64` 工件，核验 Actions 外层与发布内层各自的 SHA-256、包内容、版本和来源。完整解压保留相邻 `site`、`demo-game` 等目录，系统需要 Edge WebView2 Runtime。发行范围为自包含便携包。[v1.0.0 正式发行](https://github.com/AureliusWu/VN-Engine-v2/releases/tag/v1.0.0)
2. 校验发行提交、tag 和两个通过的 workflow run，先建立 GitHub draft。核对草稿四份附件、名称、大小、摘要和内容清单后，再发布为正式 latest。公开后从 Release 下载同一便携包和校验附件，重新核对字节、来源、版本与运行路径。保留上一正式版供回退。签名安装器、自动更新、npm 发布和人工平台验收分别留待相应验证。
