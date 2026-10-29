# 0.8.0 alpha · R4 版本说明准备稿

R4 引擎工程交付已完成。正式代码验证提交为 `b10feaeba17d605935c3721431b816c68c8880c4`；后续收尾提交只更新文档。GitHub Release / tag 与 npm 包尚未发布。

## 变化

- 文案、剧情、美术与听感终审采用 AI 模拟审阅；实际技术与平台测试单列。新增 vn-ai-acceptance-v1、独立实际输入 / 源绑定、SDK / CLI bundle / import / inspect、历史、冲突与进程恢复。
- Studio 和 Windows 支持独立审核文件及证据读取；内容变更使审核失效，关闭面板取消迟到读取，独立 Studio 子目录离线新页可实际预览。
- 关闭五类已复现缺陷：过期 QA、Neutral 继承遗漏、成品清单漏项、启动 / PWA / 离线依赖误放行，以及目录别名误拒绝。见 [问题关闭表](R4_BUGS.md)。
- npm / 锁文件 / 引擎 / Windows 与构建 manifest 统一为 0.8.0；项目、编辑器、存档 schema 1 与 vn-agent-v1 兼容。四作 / RESET 未迁移。

## 验证与下载

221 项 Node、6 项 Python、176 项来源、完整浏览器 / Studio、Windows 31 项专项和原生进程重启通过。四样例 10 用例、11 结局、73 次存读档及文件 / 解码 / 成品检查通过。

| 测试产物 | 入口 |
| --- | --- |
| Windows 便携包（内含 VNEngine-Studio-0.8.0-win-x64.zip） | [CI artifact](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40797015450/artifacts/12863879074) |
| 四份独立作品样例 | [CI artifact](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40797015632/artifacts/12864805062) |
| 四样例 QA 与构建身份 | [CI artifact](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40797015632/artifacts/12864312246) |
| AI 审阅实际输入 / 截图 | [CI artifact](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40797015632/artifacts/12863634977) |

外层 artifact ZIP 的 SHA256、来源提交与其他证据入口见 [机器记录](r4-validation.json)；外层哈希不能当作包内 Windows ZIP 的哈希。Actions artifact 需要 GitHub 权限且有保留期限，测试包不等于 GitHub Release。

## 实际范围

AI 接口和拒绝缺模态已通过测试；实际书店样例已审读正文 / 两个结局、两张原图和桌面 / 390px 结束画面。完整画面审核、主观听感与实体设备仍 UNVERIFIED，素材保持 DRAFT，样例正式总门禁继续 BLOCKED。原因是当前对应内容 / 设备证据不足，不再要求文案、美术或听感的真人签字。

R4 到此停止，不自动开启下一轮。详细证据见 [0.8.0 验证](VALIDATION-v0.8.0.md)。
