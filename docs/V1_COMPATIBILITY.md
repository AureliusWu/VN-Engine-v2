# 1.x 兼容约定

1.0.0 沿用 0.8.2 的自研执行链与合法工程、存档、作者协议。公开入口以 package.json 的 exports 为准；深层 dist 路径和私有实现不属于稳定入口。

| 入口 | 用途 | 1.x 约束 |
| --- | --- | --- |
| 包根入口 | createProject / mountGame、运行会话、玩法、资源和存储等公开导出 | 保留已有入口与生命周期；纯模块导入不创建 DOM、存储或音频设备 |
| ./editor | EditorModel、工程读取与作者命令 | 工程与运行数据分别导出，校验失败不得静默丢失原文，撤销及引用身份保留 |
| ./agent | 纯数据 SDK 与开发协议 | 不在导入时执行设备或网络 IO；保留既有稳定 ID / 冲突及校验语义 |
| ./agent/node | 显式文件 / 构建宿主 | 只有显式调用执行文件 IO；构建仍检查路径、源、证据与实际产物 |
| ./pwa、./validation | 离线构建及结构校验 | 保留现有公开调用方式，图校验不替代玩法执行或内容终审 |

1.x 对合法既有输入保持兼容；新增可选字段应提供默认行为。破坏合法公开调用、数据格式或存储身份的变更需要单独迁移说明与主版本规划。拒绝损坏、越界、过期或错位数据属于校验修正，不承诺继续接受此类输入。

## 数据身份

| 格式 | v1.0.0 的处理 |
| --- | --- |
| EngineProject schema 1、Studio vn-engine-editor schema 1 | 保持格式；既有未知扩展字段按原模型规则保留 |
| SaveEnvelope schema 2 / save_version 2 | 保留原 key 与 namespace；manual-N / quick / auto 的 envelope.slot 必须与读取 key 一致 |
| 旧存档迁移 | 仅执行调用方明确配置的逐级 migration 和 legacyGameVersions；不自动更改故事版本 |
| vn-agent-v1、vn-creative-v1、独立 review / acceptance | 保留现有协议和源 / 文件绑定；作者资料不进入玩家作品数据 |
| 四作原生存档 | 不由引擎 1.0.0 自动转换或覆盖；原协议与迁移约束见 MIGRATION.md |
| 已有独立构建包 | 包内携带自己的运行时，升级仓库不会重写旧包；使用新引擎从源工程重新构建并通过当前 QA 后，才作为 1.0.0 构建交付 |

ENGINE_VERSION 是工具与运行时版本；project.version / gameVersion 是作品故事版本。升级引擎不能自动改故事版本、台词 / 证据 ID、存档 namespace 或正式游戏运行链。

## 验证平台与交付边界

- CI 使用 Node 22、Python 3.12、TypeScript 仓库锁定版本；本机使用 Node 24 与已安装 Edge，结果分开记录。
- 浏览器宿主按实际 Chromium 自动化验证；Windows win-x64 使用 .NET 10 自包含宿主、实际 WebView2、文件 IO 和完整进程重启。
- 子目录部署与断网新页通过生成包验证；390px 视口是布局模拟，不等于实体手机验收。未验证平台不列作本次已验证平台。
- 仓库仍为 private npm package 配置；本次不发布公共 npm、GitHub Release / tag 或签名安装器。CI artifact 有权限与保留期限，不能代替永久发行渠道。
- 技术检查通过不会将样例 DRAFT 素材或正式内容 BLOCKED 自动改为通过；主观听感与作品内容审核另行执行。
