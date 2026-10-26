# GALGAME SPEC

**视觉小说 / Galgame 制作与验收规范**  
**Visual Novel / Galgame Production & Acceptance Specification**

- 版本：`v0.2`
- 状态：Draft
- 文件：`GALGAME_SPEC.md`
- 定位：项目级 Single Source of Truth
- 适用：Galgame / Visual Novel / ADV / 叙事型文字游戏 / 自研 VN Engine
- 规范关键词：`MUST / SHOULD / MAY`

### v0.2 更新摘要

- 明确 `TECH_READY != ART_READY`。
- 正式美术新增不可绕过的 Production Art Visual Gate。
- 角色立绘新增 Character Master、实际剧情截图、移动端 / 桌面端与 Provenance 硬验收。
- Key Visual 新增剧情舞台覆盖边界与生命周期要求。
- Placeholder / 程序化占位稿新增防误发布规则。
- 真实设备视觉事故必须回溯 Gate，并撤回错误的 `ART_READY`。

---

## 0. 为什么叫 SPEC，而不是“白皮书”

“白皮书（White Paper）”通常用于解释理念、背景、方法与行业观点。

本文件的核心用途是：

- 约束开发
- 定义完成标准
- 定义验收标准
- 定义资产规则
- 定义引擎能力
- 定义 QA
- 定义 Build / Release
- 作为项目长期事实源

因此更准确的名称是：

> **GALGAME SPEC — 视觉小说 / Galgame 制作与验收规范**

它可以包含白皮书性质的设计原则，但最终落点是“可执行、可检查、可验证”。

---

# 1. 文档目标

本规范用于建立一套可重复、可验证、可自动化的 Galgame / Visual Novel 制作标准。

本规范关注：

- 剧情
- 剧本
- 角色
- 美术
- 音频
- 演出
- UI / UX
- 分支系统
- 状态系统
- 存档系统
- 回看与收藏
- 引擎能力
- 资源管理
- 构建
- 发布
- 自动化
- QA
- 项目维护

本规范不包含：

- 伦理审查
- 内容审查
- 年龄分级
- 题材限制

本规范不规定作品必须采用某种叙事风格、美术风格或传统 Galgame 结构。

实验性视觉小说、线性短篇、多女主 Galgame、悬疑 ADV、恐怖视觉小说、含探索或小游戏的复合型作品均可采用。

核心原则：

> **作品声明自己支持什么，就必须真正完成自己声明支持的内容。**

---

# 2. 规范等级

## 2.1 MUST

必须满足。

违反 MUST 的项目不得标记为正式完成版本。

例如：

- 正式剧情不得存在无法到达的关键结局。
- 正式 Build 必须能够独立启动。
- 游戏不得引用不存在的资源。
- 存档升级不得静默损坏。

## 2.2 SHOULD

原则上应满足。

可以因为作品设计原因不实现，但必须有明确理由。

例如：

- SHOULD 提供 History。
- SHOULD 支持已读文本 Skip。
- SHOULD 保留高质量 Master Asset。

## 2.3 MAY

可选能力。

例如：

- CG Gallery
- Ending Collection
- 流程图
- 云存档
- 章节选择
- 成就系统
- 单角色音量控制

---

# 3. 项目完成定义

一个 Galgame 项目不得仅因为：

> “主线可以从头点到尾”

就被判定为完成。

项目完成至少包含六个维度：

```text
CONTENT
ENGINE
ASSET
UX
QA
RELEASE
```

完整定义：

```text
剧情完整
+
运行系统完整
+
资源完整
+
玩家操作闭环完整
+
测试通过
+
正式产物可发布
```

---

# 4. 项目阶段

统一使用：

```text
PROTOTYPE
ALPHA
BETA
RC
RELEASE
```

## 4.1 PROTOTYPE

用于验证：

- 核心玩法
- 叙事形式
- 引擎能力
- UI 原型
- 技术路线

允许：

- Placeholder
- 临时 UI
- 临时音乐
- 临时 Script

## 4.2 ALPHA

主体系统成立。

要求：

- 主剧情可运行
- 核心交互可用
- 主要角色已进入项目
- 基础 Save / Load 可用

允许：

- 部分资源缺失
- 部分演出未完成
- 剧情继续修改

## 4.3 BETA

内容基本锁定。

要求：

- 正式剧情已接入
- 所有声明 Route 可完成
- 所有声明 Ending 可触发
- 正式资源基本齐全
- 不存在重大功能缺失

## 4.4 RC

Release Candidate。

要求：

- Content Freeze
- Asset Freeze
- Feature Freeze
- 仅允许 Bug Fix
- 回归测试通过
- 正式 Build 通过

## 4.5 RELEASE

正式版本。

要求：

```text
RC PASS
+
正式构建
+
正式版本号
+
正式发布产物
+
Checksum
+
Release Notes
```

---

# 5. 推荐项目结构

```text
project/
├─ game/
│  ├─ scripts/
│  ├─ characters/
│  ├─ routes/
│  ├─ scenes/
│  ├─ systems/
│  └─ localization/
│
├─ assets/
│  ├─ characters/
│  ├─ cg/
│  ├─ backgrounds/
│  ├─ ui/
│  ├─ audio/
│  │  ├─ bgm/
│  │  ├─ se/
│  │  ├─ ambience/
│  │  └─ voice/
│  ├─ video/
│  └─ fonts/
│
├─ data/
│  ├─ characters/
│  ├─ routes/
│  ├─ endings/
│  ├─ gallery/
│  └─ config/
│
├─ docs/
├─ tests/
├─ tools/
├─ build/
└─ release/
```

实际目录结构 MAY 不同。

但 MUST 能清晰区分：

```text
Source
Runtime
Test
Build Artifact
Documentation
```

---

# 6. 剧情规范

## 6.1 主线完整性

作品 MUST 存在明确剧情结构。

传统结构至少可以描述：

```text
开场
→
发展
→
矛盾升级
→
高潮
→
结局
```

实验叙事 MAY 打破传统结构。

但不得以“开放式叙事”为理由掩盖：

- 缺失章节
- 未完成结局
- 无法解释的断线
- 被遗弃的 Route

---

# 7. Route 规范

存在多路线时，每条正式 Route MUST 定义：

```text
route_id
route_name
entry_condition
entry_scene
critical_flags
ending
unlock_condition
```

示例：

```yaml
route_id: lin_wan
route_name: 林晚线
entry_condition:
  affection_linwan: ">=5"
  chapter_3_choice: stay
ending:
  - LIN_NORMAL
  - LIN_TRUE
```

大型项目 SHOULD 避免完全依赖散落 Script 中的隐式条件维护 Route。

---

# 8. Flag 与变量

所有影响剧情结果的重要变量 MUST 有明确生命周期。

至少区分：

```text
LOCAL
SESSION
SAVE
PERSISTENT
```

## LOCAL

仅当前 Scene。

## SESSION

仅当前运行周期。

## SAVE

进入 Save State。

## PERSISTENT

跨 Save 存在。

典型 Persistent：

```text
ending_seen
cg_unlocked
true_route_unlocked
playthrough_count
```

不得把临时状态错误写入 Persistent。

---

# 9. Ending 规范

每个正式 Ending MUST：

- 有唯一 ID
- 有显示名称
- 有明确触发条件
- 能通过正常流程到达
- 能被 QA 稳定复现

推荐分类：

```text
BAD
NORMAL
GOOD
TRUE
SPECIAL
```

示例：

```json
{
  "id": "TRUE_END",
  "name": "回留",
  "type": "TRUE",
  "route": "meta",
  "persistent": true
}
```

禁止：

```text
代码中存在 Ending
但玩家无法正常到达
```

---

# 10. 剧本规范

正式 Script MUST 不包含：

- TODO
- FIXME
- 测试对白
- 临时角色名
- lorem ipsum
- 无意义占位文本
- 开发调试输出

除非处于开发 Build。

---

# 11. Character ID

每个角色 SHOULD 有稳定唯一 ID。

例如：

```text
lin_wan
zhou_xiaoman
xu_qi
```

显示名允许变化。

内部 ID SHOULD 保持稳定。

避免：

```text
林晚
linwan
LinWan
lin_wan
LW
```

同时表示同一角色。

---

# 12. 称呼一致性

复杂人物关系 SHOULD 建立称呼表。

示例：

| 角色 | 对象 | 默认称呼 |
|---|---|---|
| 林晚 | 主角 | 你 |
| 周小满 | 主角 | 学长 |
| 主角 | 林晚 | 林晚 |

剧情阶段改变称呼 MAY 存在。

但 SHOULD 由状态明确控制。

---

# 13. 文本规范

正式文本 SHOULD 统一：

- 中文标点
- 引号形式
- 省略号
- 破折号
- 数字格式
- 英文空格规则

推荐：

```text
……
——
“”
```

避免同一正文中混用：

```text
......
--
""
```

---

# 14. 对话长度

系统 MUST 正确处理：

- 短对白
- 长对白
- 多行旁白
- 英文
- 数字
- 特殊符号

不得因为单句过长导致：

- Overflow
- 遮挡 Name Box
- 遮挡 Choice
- 超出 Screen

文本 SHOULD 自动换行。

---

# 15. History / Backlog

游戏 SHOULD 提供 History。

至少记录：

```text
speaker
text
order
```

存在 Voice 时：

SHOULD 支持从 History Replay Voice。

---

# 16. 角色美术母版

主要角色 SHOULD 建立 Character Master。

用于约束：

- 身高比例
- 发型
- 发色
- 眼睛
- 肤色
- 身材
- 服装
- 饰品
- 色板
- 关键识别元素

AI 辅助制作项目 SHOULD 将 Character Master 视为强约束资产。

---

# 17. 角色差分

角色差分统一拆分：

```text
POSE
EXPRESSION
COSTUME
STATE
```

示例：

```text
linwan_school_normal_smile
linwan_school_normal_angry
linwan_school_crossarms_smile
```

禁止使用：

```text
最终版2
最终版2_new
最终版2_new_final
最终版2_new_final_fix
```

作为长期命名体系。

---

# 18. 美术一致性

同一作品正式素材 SHOULD 保持：

- 线稿逻辑一致
- 五官抽象程度一致
- 人体比例一致
- 阴影逻辑一致
- 色彩空间一致
- 光照逻辑合理
- 角色辨识度稳定

特殊演出 MAY 主动改变画风。

但变化 MUST 是设计行为，不是生产失控。

---

# 19. Character Master 最低内容

主要角色推荐至少维护：

```text
正面
侧面
背面
```

并 SHOULD 包含：

```text
基础表情集
基础服装
配色表
身高参照
关键饰品
```

---

# 20. CG 规范

每张正式 CG MUST 有唯一 ID。

例如：

```text
CG_CH01_RAIN_001
CG_LINWAN_TRUE_END
CG_FINAL_MORNING
```

CG SHOULD 区分：

```text
MASTER
RUNTIME
THUMBNAIL
```

---

# 21. Master / Runtime

正式高质量素材 SHOULD：

```text
MASTER
↓
转换
↓
RUNTIME
```

不得把低质量 Runtime 反向作为唯一 Master。

示例：

```text
4K PNG Master
↓
WebP Runtime
↓
Gallery Thumbnail
```

---

# 22. Background

背景 SHOULD 标记状态。

示例：

```text
school_classroom_day
school_classroom_evening
school_classroom_night
```

重要场景 SHOULD 明确区分：

- 时间
- 天气
- 特殊状态

---

# 23. UI Asset

UI SHOULD 独立于剧情美术。

至少可能包含：

```text
dialogue
namebox
choice
save
load
settings
history
gallery
title
pause
icons
```

UI 不应长期依赖整张场景截图拼接。

---

# 24. 音频分类

至少区分：

```text
BGM
SE
AMBIENCE
VOICE
```

环境雨声、风声等 SHOULD 作为 Ambience 处理，而不是全部塞进 BGM。

---

# 25. BGM

每首 BGM SHOULD 定义：

```text
bgm_id
title
file
loop
loop_start
loop_end
default_volume
```

循环 SHOULD 无明显：

- 爆音
- 断点
- 空白
- 突变

---

# 26. SE

SE 应按事件触发。

例如：

```text
door_open
phone_vibrate
rain_hit_window
footstep_school
```

高频同类 SE SHOULD 避免机械重复。

---

# 27. Voice

全配音作品 MUST 检查：

```text
文本存在但 Voice 缺失
Voice 存在但文本不存在
Voice 与角色不匹配
Voice 与台词版本不一致
```

角色音量 SHOULD 可独立于 BGM 调整。

---

# 28. 音量系统

至少 SHOULD 提供：

```text
Master
BGM
SE
Voice
```

复杂项目 MAY 增加：

```text
Ambience
UI
Video
```

设置 MUST 持久化。

---

# 29. 演出系统

VN Engine MUST 至少支持：

```text
对白
旁白
角色显示
角色隐藏
背景切换
BGM
SE
Choice
Scene Jump
变量
条件判断
```

完整引擎 SHOULD 支持：

```text
Fade
Dissolve
Move
Scale
Shake
Flash
Camera
Layer
Animation
Video
```

---

# 30. Layer

推荐逻辑层：

```text
BACKGROUND
CHARACTER_BACK
CHARACTER
CHARACTER_FRONT
CG
EFFECT
UI
SYSTEM
```

SHOULD 避免长期依赖散乱 z-index 数字维护复杂场景。

---

# 31. Choice

所有 Choice MUST：

- 可点击
- 桌面端 SHOULD 可键盘选择
- 不超出 Safe Area
- 不因文本过长崩坏

重要 Choice SHOULD 可记录。

---

# 32. Auto

游戏 SHOULD 支持 Auto。

Auto Speed SHOULD 可调。

存在 Voice 时 SHOULD：

```text
Voice 播放完成
+
Auto Delay
```

再进入下一句。

---

# 33. Skip

游戏 SHOULD 支持：

```text
Skip Read
```

MAY 提供：

```text
Skip All
```

两者必须清晰区分。

Choice 出现时 SHOULD 自动停止 Skip。

---

# 34. Rollback

支持 Rollback 的作品 SHOULD：

- 返回上一句
- 恢复场景状态
- 恢复相关变量
- 不破坏 Save State

作品设计明确禁止时 MAY 关闭。

---

# 35. Hide UI

游戏 SHOULD 支持隐藏文本框。

常见输入：

```text
H
右键
中键
```

具体映射不强制。

---

# 36. Save System

正式游戏 MUST 有可靠存档机制。

推荐支持：

```text
Manual Save
Auto Save
Quick Save
```

极短篇 MAY 简化。

---

# 37. Save Metadata

Save SHOULD 保存：

```text
save_version
timestamp
chapter
scene
playtime
screenshot
route
important_flags
```

UI 不必全部展示。

---

# 38. Save Version

Save MUST 包含版本信息。

示例：

```json
{
  "save_version": 4,
  "game_version": "1.2.0"
}
```

---

# 39. Save Migration

游戏升级 SHOULD 尽量兼容旧存档。

格式变化时 MUST：

- 实现 migration

或明确声明：

```text
Save Breaking Change
```

不得静默损坏存档。

---

# 40. Quick Save / Quick Load

支持 Quick Save 时：

SHOULD 至少存在一个独立 Quick Slot。

Quick Save 不应覆盖普通 Manual Save。

---

# 41. Auto Save

Auto Save SHOULD 在关键节点执行：

```text
章节开始
重要 Choice 后
章节结束
```

不 SHOULD 每句对白写盘。

---

# 42. Meta State

跨周目状态 SHOULD 与普通 Save 分离。

例如：

```text
ending_seen
cg_unlocked
true_route_unlocked
playthrough_count
```

---

# 43. CG Gallery

实现 Gallery 时：

每个 CG MUST 有：

```text
cg_id
asset
unlock_condition
```

锁定状态不得泄漏正式 CG 原图。

---

# 44. Ending Collection

实现结局收藏时：

SHOULD 显示：

```text
已解锁
未解锁
```

未解锁名称 MAY 隐藏。

---

# 45. Settings

基础设置 SHOULD 包含：

```text
文字速度
Auto 速度
Master Volume
BGM Volume
SE Volume
Voice Volume
窗口 / 全屏
```

桌面端 SHOULD 记住窗口设置。

---

# 46. 输入系统

桌面端 SHOULD 支持：

```text
Mouse
Keyboard
```

触屏端：

- 按钮必须可点击
- 不依赖 Hover
- 不使用纯右键操作

---

# 47. 分辨率

UI MUST 适配目标分辨率。

推荐设计基准：

```text
1920 × 1080
```

不得假设所有设备固定 16:9。

至少 SHOULD 检查：

```text
1920×1080
2560×1440
3840×2160
1366×768
```

移动端项目另外测试实际目标尺寸。

---

# 48. Safe Area

关键内容 MUST 保持在 Safe Area：

```text
Dialogue
Choice
Save
Settings
System Message
```

---

# 49. 字体

项目 MUST 明确字体来源。

正式构建不得依赖开发者电脑上的偶然本地字体。

字体 SHOULD：

```text
随游戏分发
或
使用平台保证存在的字体
```

---

# 50. Asset Manifest

项目 SHOULD 维护 Asset Manifest。

示例：

```json
{
  "id": "CG_FINAL_MORNING",
  "type": "cg",
  "master": "master/cg_final_morning.png",
  "runtime": "cg/cg_final_morning.webp",
  "sha256": "...",
  "status": "READY"
}
```

---

# 51. Asset Status

推荐：

```text
PLACEHOLDER
DRAFT
REVIEW
READY
DEPRECATED
```

正式 Release 不得错误引用 PLACEHOLDER。

---

# 52. Provenance

重要 Asset SHOULD 记录：

```text
asset_id
creator
source
creation_date
license
master
runtime
sha256
```

AI 辅助资产 MAY 增加：

```text
model
prompt
seed
reference
generation_tool
```

这里的 Provenance 用于：

- 工程追踪
- 版本追踪
- 可复现
- 回滚
- 资产来源管理

---

# 53. SHA256

正式 Master 与 Release Artifact SHOULD 生成 SHA256。

例如：

```text
RESET-v1.2.0-win-x64.zip
SHA256: ...
```

关键 Master Asset MAY 同样进行 SHA256 追踪。

---

# 54. Dead Asset

正式版本 SHOULD 检查：

```text
未使用 CG
未使用背景
未使用角色差分
未使用 BGM
未使用 Voice
```

Dead Asset MAY 留在 Source。

但 SHOULD 避免无意义进入 Runtime。

---

# 55. Missing Asset

Build 流程 SHOULD 自动检测：

```text
脚本引用文件不存在
Manifest 指向文件不存在
资源大小为 0
损坏图片
损坏音频
```

Missing Asset SHOULD 导致 CI Failure。

---

# 56. Dead Branch

剧情 QA MUST 检测：

```text
永远无法进入的 Scene
永远无法成立的 Choice
永远无法触发的 Ending
```

---

# 57. Script Validation

推荐自动检查：

```text
Duplicate Scene ID
Missing Jump Target
Missing Character
Missing Asset
Invalid Flag
Invalid Ending
```

---

# 58. Route Matrix

多分支游戏 MUST 有 Route Matrix。

示例：

| Route | Bad | Normal | Good | True |
|---|---:|---:|---:|---:|
| 林晚 | ✓ | ✓ | ✓ | ✓ |
| 周小满 | ✓ | ✓ | ✓ | — |
| 许栖 | ✓ | ✓ | ✓ | — |

正式发布前所有声明存在的路径 MUST PASS。

---

# 59. Save Regression

版本发布前 MUST 测试：

```text
New Game
Manual Save
Load
Quick Save
Quick Load
Auto Save
Restart
Save after Choice
Load before Choice
Ending Save
Persistent State
```

---

# 60. UI Regression

必须检查：

```text
Title
Dialogue
Choice
History
Save
Load
Settings
Gallery
Ending
Error Dialog
```

不得只测试主剧情窗口。

---

# 61. Audio Regression

检查：

```text
BGM Start
BGM Switch
BGM Loop
BGM Stop
SE
Voice
Voice Skip
Volume Persistence
Mute
```

---

# 62. Performance

Runtime SHOULD 避免：

```text
每 Scene 重复加载巨大资源
无界缓存
4K PNG 全量常驻
音频重复解码
无限增长 History
```

---

# 63. Runtime Asset Optimization

Runtime SHOULD 按平台优化。

示例：

```text
Master PNG
↓
Runtime WebP
```

音频：

```text
Master WAV
↓
Runtime OGG / Opus
```

具体格式由目标平台决定。

---

# 64. Web / PWA

Web 版本 SHOULD 检查：

```text
首次加载
缓存
刷新
资源路径
离线
版本升级
旧缓存清理
移动端
```

PWA MUST 特别验证 Service Worker 版本行为。

---

# 65. Desktop

桌面正式 Build MUST：

```text
能够独立启动
不依赖开发环境
不依赖 Node
不依赖 Python
不依赖源码目录
```

除非项目本身明确要求。

---

# 66. Windows Build

Windows 正式构建 SHOULD 测试：

```text
干净环境
非管理员账户
中文路径
英文路径
首次启动
重复启动
卸载 / 删除
```

---

# 67. Version

推荐 Semantic Versioning：

```text
MAJOR.MINOR.PATCH
```

例如：

```text
1.2.0
```

开发：

```text
1.2.0-dev
```

候选：

```text
1.2.0-rc.1
```

---

# 68. Build Identity

每个 Build SHOULD 能确定：

```text
Game Version
Commit SHA
Build Time
Engine Version
```

示例：

```text
Game: 1.2.0
Commit: da6ebd0
Engine: VN Engine v2.1
```

---

# 69. CI

项目 SHOULD 用 CI 自动完成：

```text
Install
Lint
Validate Script
Validate Assets
Test
Build
Package
Checksum
```

---

# 70. Release Artifact

正式 Release SHOULD 至少产出：

```text
游戏包
版本信息
SHA256
Release Notes
```

---

# 71. Release Freeze

进入 RC 后禁止：

```text
大规模重写剧情
大规模替换角色设计
引入新核心系统
重构 Save Format
```

如必须执行，应退出 RC。

---

# 72. Engine Compliance

自研 VN Engine 不得仅通过：

> “能显示文字”

判断成熟度。

推荐能力矩阵：

```text
Dialogue                 PASS
Narration                PASS
Character Sprite         PASS
Background               PASS
CG                       PASS
Choice                   PASS
Flag                     PASS
Save                     PASS
Load                     PASS
Quick Save               PASS
Auto Save                PASS
Rollback                 PASS
History                  PASS
Auto                     PASS
Skip Read                PASS
Persistent State         PASS
Gallery                  PASS
Ending Collection        PASS
Audio                    PASS
Video                    PASS
Animation                PASS
Web Build                PASS
Windows Build            PASS
```

---

# 73. Game Compliance

作品同样 SHOULD 建立 Compliance Matrix：

```text
Narrative
Script
Character
CG
Background
Audio
UI
Save
Route
Gallery
QA
Build
Release
```

示例：

```text
Narrative          18 / 18
Script             21 / 21
Character Art      46 / 48
CG                 17 / 20
Audio              31 / 31
Save System        12 / 12
QA                 35 / 40

TOTAL             180 / 190
```

---

# 74. Definition of Done

单项任务只有同时满足：

```text
实现
+
接入
+
运行
+
测试
+
记录
```

才可标记：

```text
DONE
```

以下均不是 DONE：

```text
资源已生成但未接入
代码已写但未测试
资源已进仓库但游戏未使用
脚本已写但没有完整 Playthrough
```

---

# 75. Art Definition of Done

正式美术流程：

```text
生成 / 绘制
↓
人工检查
↓
Master
↓
Runtime
↓
Manifest
↓
接入游戏
↓
实际场景验收
↓
SHA256
↓
Commit
```

全部完成：

```text
ART_READY
```

---

# 76. Story Definition of Done

剧情节点：

```text
Script Complete
↓
Logic Check
↓
Character Check
↓
Route Check
↓
In-Engine
↓
Playthrough
↓
Regression
```

之后：

```text
STORY_READY
```

---

# 77. Release Definition of Done

版本只有同时达到：

```text
CONTENT_READY
ART_READY
AUDIO_READY
ENGINE_READY
QA_PASS
BUILD_PASS
RELEASE_PASS
```

才能标记：

```text
RELEASED
```

---

# 78. 状态表达规范

禁止使用不可验证描述：

```text
基本完成
差不多了
大概没问题
应该可以
差一点
基本齐了
```

统一转换为可检查状态：

```text
47 / 51 PASS
```

或：

```text
BLOCKED:
CG_FINAL_MORNING
VOICE_CH04_018
SAVE_MIGRATION_03
```

---

# 79. Single Source of Truth

每种状态 SHOULD 有唯一事实源。

例如：

```text
VERSION
→ package.json

资产状态
→ asset-manifest.json

剧情 Route
→ routes.json

测试结果
→ QA_REPORT.md
```

项目不得长期存在多个互相冲突的“最终状态”。

---

# 80. 可复现性

正式 Release SHOULD 能由对应 Commit 重建。

目标：

```text
Git Commit
+
Locked Dependencies
+
Assets
+
Build Script
=
Release Artifact
```

---

# 81. QA 总纲

正式发布前至少完成：

## Narrative QA

- 主线完整
- Route 完整
- Ending 全部可达
- 无 Dead Branch
- 无明显逻辑冲突
- 角色行为前后一致
- 伏笔与关键设定无断裂

## Script QA

- 无错别字
- 无占位文本
- 无测试文本
- 无错误角色名
- 无格式错乱
- 无重复对白
- 无错误 Jump

## Art QA

- 角色一致
- 表情正确
- 服装正确
- 场景正确
- CG 构图正确
- Runtime 清晰度正确
- 无 Placeholder
- 无 Missing Asset

## Audio QA

- BGM 正确
- SE 正确
- Ambience 正确
- Voice 对齐
- Loop 正确
- Volume 正确

## System QA

- Save / Load
- Quick Save / Load
- Auto Save
- History
- Auto
- Skip
- Rollback
- Settings
- Persistent State
- Gallery
- Ending Collection

## Platform QA

- Web
- PWA
- Windows
- 目标移动端
- 分辨率
- 中文路径
- 离线运行
- Cache Upgrade

---

# 82. Asset Naming 建议

推荐统一：

```text
<type>_<character/location>_<state>_<index>
```

示例：

```text
char_linwan_school_smile_01
bg_school_classroom_day_01
cg_true_end_morning_01
bgm_memory_theme_01
se_door_open_01
voice_linwan_ch03_0042
```

长期禁止：

```text
final
final2
new
new2
改
改2
最终
最终最终
```

---

# 83. Asset ID 与文件名

Asset ID 与文件名 SHOULD 解耦。

例如：

```json
{
  "id": "CG_TRUE_END",
  "file": "cg_true_end_morning_01.webp"
}
```

这样允许未来替换文件而不破坏 Script。

---

# 84. Engine / Game 解耦

引擎 SHOULD 提供能力。

作品决定是否使用。

不得因为引擎支持：

```text
Gallery
Rollback
Combat
Mini Game
```

就强迫所有作品启用。

同样：

作品需要的核心能力如果引擎不支持，应明确：

```text
ENGINE_GAP
```

而不是在 Script 层堆临时 Hack。

---

# 85. Data Driven

复杂项目 SHOULD 将以下内容数据化：

```text
Character
Route
Ending
CG
Asset
Save Version
Config
Localization
```

避免所有逻辑硬编码进 UI 或单一 Script。

---

# 86. Debug 与 Release 隔离

开发 Build MAY 提供：

```text
Jump Scene
Set Flag
Unlock CG
Unlock Ending
Show Variables
Developer Console
```

Release Build SHOULD 默认关闭。

Debug 工具不得影响正式 Persistent State。

---

# 87. Error Handling

正式游戏 SHOULD 对以下错误给出可理解反馈：

```text
Save Load Failure
Missing Optional Asset
Version Mismatch
Corrupted Save
Unsupported Environment
```

不 SHOULD 直接只显示：

```text
undefined
null
stack trace
```

给普通玩家。

---

# 88. 日志

桌面端 SHOULD 保留有限运行日志。

至少帮助定位：

```text
Game Version
Engine Version
Scene
Fatal Error
Save Error
Asset Error
```

日志不应无限增长。

---

# 89. 游戏启动

正式游戏启动路径 SHOULD 明确：

```text
Executable
↓
Engine Runtime
↓
Game Data
↓
Title Screen
```

不得依赖开发服务器。

---

# 90. Title Screen

正式作品 Title Screen SHOULD 至少提供：

```text
New Game
Continue / Load
Settings
Exit
```

如果平台不适用 Exit，可省略。

MAY 提供：

```text
Gallery
Ending
Extra
Chapter Select
```

---

# 91. New Game

New Game MUST：

- 正确初始化 Session State
- 不错误清除 Persistent State
- 不继承上一次临时变量
- 能从规定开场进入

---

# 92. Continue

Continue MAY：

- 加载最近 Save
- 加载最近 Auto Save
- 显示 Load 页面

具体设计可自由决定。

但行为 SHOULD 一致且可预测。

---

# 93. Scene Identity

每个 Scene SHOULD 有稳定唯一 ID。

例如：

```text
ch01_school_gate
ch01_classroom_intro
ch01_rain_choice
```

避免只使用数组位置作为唯一身份。

---

# 94. Scene Jump

所有 Jump Target MUST 在 Build 前验证存在。

缺失 Jump Target：

```text
CI FAIL
```

---

# 95. Localization Ready

即使当前只有中文，文本系统 SHOULD 尽量避免：

- 文本直接写死在 UI Component
- 固定字宽假设
- 强依赖中文标点长度
- 图片内嵌大量可变文本

这样未来可扩展 Localization。

---

# 96. Accessibility 基础

项目 SHOULD 至少考虑：

- 字号可读
- 对比度
- 字幕
- 键盘操作
- 不完全依赖颜色表达状态
- 音量分轨

更高阶能力 MAY 包含：

- Self Voicing
- Screen Reader
- 字体切换
- 高对比模式

---

# 97. 动画规范

动画 SHOULD：

- 可中断
- 不阻塞核心 UI
- 不因低帧率破坏剧情状态
- Skip 时能正确收敛到最终状态

动画状态不得与逻辑状态脱节。

---

# 98. Video

使用视频时 SHOULD 定义：

```text
video_id
file
skippable
loop
fallback
```

视频播放失败 SHOULD 有可接受降级方案。

---

# 99. Mini Game / 非传统玩法

含小游戏、探索、战斗等复合玩法时：

MUST 明确：

```text
entry_condition
exit_condition
success_state
failure_state
save_behavior
skip_behavior
```

小游戏不得把主剧情状态变成不可追踪黑箱。

---

# 100. 战斗或数值系统

如果作品包含战斗：

数值系统 SHOULD 与剧情 Flag 解耦。

明确：

```text
Battle State
Narrative State
Persistent State
```

避免一个临时战斗变量直接污染全局剧情状态。

---

# 101. 章节系统

章节 SHOULD 有唯一：

```text
chapter_id
```

MAY 记录：

```text
title
start_scene
end_scene
unlock_condition
```

---

# 102. Chapter Select

如果实现 Chapter Select：

必须明确恢复哪些剧情状态。

不能仅 Jump 到 Scene 而忽略前置变量。

---

# 103. Replay

CG / Scene Replay MAY 使用独立 Replay Context。

Replay 不应污染：

```text
正常 Save
正常 Persistent State
Route Progress
```

除非设计明确要求。

---

# 104. Gallery Unlock

Gallery Unlock SHOULD 在明确节点执行。

例如：

```text
CG 实际首次展示完成后
```

而不是仅因为文件存在就自动解锁。

---

# 105. Voice ID

全配音项目 SHOULD 给 Voice 稳定 ID。

例如：

```text
voice_linwan_ch03_0042
```

Script Text 与 Voice 可通过 ID 校验。

---

# 106. Text / Voice Sync

Voice 更新时 SHOULD 检查：

```text
Script Revision
Voice Revision
```

防止旧 Voice 配新台词。

---

# 107. Audio Ducking

存在 Voice 时 MAY 对 BGM 做 Ducking。

必须确保：

- 不突变
- Voice 结束后恢复
- Skip 时恢复正确

---

# 108. Transition

转场 SHOULD 有统一行为。

避免同一种逻辑：

```text
场景切换
```

在不同 Script 中被手写成多套不一致实现。

---

# 109. System Message

系统消息 SHOULD 与剧情文本区分。

例如：

```text
保存成功
无法读取存档
已解锁 CG
```

不得伪装为角色对白。

---

# 110. Confirmation

危险操作 SHOULD 二次确认。

例如：

```text
覆盖存档
删除存档
返回标题
退出游戏
重置设置
```

---

# 111. Save Slot

Save Slot SHOULD 显示足以识别状态的信息：

```text
Screenshot
Timestamp
Chapter
Scene / Route
Playtime
```

不强制全部展示。

---

# 112. Save Corruption

检测到损坏存档时：

SHOULD：

- 隔离
- 提示
- 保留其他正常 Save
- 不让整个 Save System 崩溃

---

# 113. Persistent Reset

若提供：

```text
Reset Progress
```

必须明确会删除哪些：

```text
Ending
CG
Meta State
Settings
Save
```

避免误导。

---

# 114. Settings Migration

设置结构变化时 SHOULD 兼容旧 Settings。

不能因为新增一项配置导致所有设置重置。

---

# 115. Build Validation Gate

正式构建前 SHOULD 经过统一 Gate：

```text
SCRIPT_PASS
ASSET_PASS
TEST_PASS
BUILD_PASS
```

任一 FAIL：

```text
NO RELEASE
```

---

# 116. Release Checklist Gate

正式发布前 MUST 确认：

```text
Version Locked
Commit Locked
Build Artifact Locked
Checksum Generated
Regression Passed
Release Notes Ready
```

---

# 117. Commit Discipline

重要阶段 SHOULD 小步提交。

推荐：

```text
实现
→ 验证
→ Commit
→ Push
```

避免大量未提交工作长期留在临时工作区。

---

# 118. Asset Commit

大体积资产 SHOULD：

- 明确版本
- 记录来源
- 检查 Git 限制
- 避免重复无意义二进制历史

大型项目 MAY 使用 Git LFS 或其他资产方案。

---

# 119. Documentation

正式项目 SHOULD 至少存在：

```text
README
GALGAME_SPEC
CHANGELOG
RELEASE_NOTES
QA_REPORT
```

具体可合并。

---

# 120. CHANGELOG

版本变更 SHOULD 明确：

```text
Added
Changed
Fixed
Removed
```

不要只写：

```text
优化了一些体验
修复了一些问题
```

---

# 121. Blocker

无法继续的任务 SHOULD 明确标记：

```text
BLOCKED
```

并记录：

```text
原因
影响
解除条件
```

---

# 122. 不确定状态

禁止把未知状态直接标记 PASS。

应该使用：

```text
UNVERIFIED
```

---

# 123. 验收状态

推荐统一：

```text
PASS
FAIL
N/A
BLOCKED
UNVERIFIED
```

---

# 124. QA Evidence

关键 QA SHOULD 保留 Evidence。

例如：

```text
测试日志
截图
构建日志
自动化结果
Commit SHA
```

---

# 125. 自动化与人工验收分工

自动化适合：

- Missing Asset
- Dead Link
- Invalid ID
- Build
- Test
- Checksum
- Route Reachability
- 文件完整性

人工适合：

- 剧情质量
- 角色一致性
- CG 构图
- 演出节奏
- UI 体验
- 音频体验

原则：

> 自动化负责发现机械错误，人工负责判断体验质量。

---

# 126. 最终原则

本规范遵循：

## 1. 玩家看到的才算接入

资产存在于磁盘，不等于完成。

## 2. 能运行不等于完成

必须经过验收。

## 3. 剧情必须可以验证

重要 Route 不得靠“应该能到”。

## 4. 资产必须可追踪

正式 Asset 不得成为无来源、无版本孤儿文件。

## 5. Save 属于正式 API

升级不得随意破坏。

## 6. 引擎服务作品

不得为了引擎功能强迫所有作品采用同一种结构。

## 7. 自动化和人工验收并行

机械问题自动查，审美与叙事人工判。

## 8. Release 是状态，不是按钮

只有：

```text
CONTENT
ENGINE
ASSET
UX
QA
BUILD
RELEASE
```

全部闭环后，版本才真正完成。

---

# 127. 推荐总状态页

项目根目录 MAY 维护：

```text
PROJECT STATUS
```

例如：

```text
Version: 1.2.0-dev
Commit: da6ebd0

CONTENT        PASS
SCRIPT         PASS
CHARACTER ART  51 / 56
CG             12 / 17
AUDIO          PASS
ENGINE         PASS
SAVE           PASS
QA             35 / 40
WEB BUILD      PASS
WINDOWS BUILD  PASS
RELEASE        BLOCKED

BLOCKERS:
- CG_FINAL_MORNING
- CG_RAIN_1842
- SAVE_MIGRATION_04
```

---

# 128. 本文件的长期定位

`GALGAME_SPEC.md` 作为整个项目体系的统一规范。

未来新增规则优先追加至本文件，而不是无节制拆分多个互相冲突的规范。

只有在内容规模过大、工具需要机器读取、或独立模块需要单独维护时，才拆分：

```text
GALGAME_SPEC.md
├─ QA
├─ ASSET
├─ SCRIPT
├─ ENGINE
└─ RELEASE
```

但主文件始终作为索引和最高层事实源。

---

# 129. 总体 Definition

> 一部作品只有在剧情、资产、系统、玩家体验、测试、构建和发布全部形成闭环时，才被视为完成。

---

# 130. 技术质量与美术质量分离

正式资产验收 MUST 明确区分：

```text
TECH_READY
ART_READY
```

两者不得互相替代。

`TECH_READY` 仅表示资产在工程层面可被可靠使用，例如：

- 文件存在
- 文件可解码
- 尺寸满足约束
- Alpha / 色彩模式符合要求
- Runtime 路径正确
- Manifest 正确
- SHA256 正确
- Build / Package 成功

`ART_READY` 表示资产在实际作品中达到正式视觉标准。

因此：

```text
TECH_READY != ART_READY
```

禁止仅凭以下结果将正式美术标记为 `ART_READY`：

- 分辨率达到 4K
- SHA256 一致
- Alpha 正常
- 浏览器成功 Decode
- 自动化 Render Success
- 文件成功进入 Release 包

这些结果 MAY 作为 `TECH_READY` 的证据，但不能替代人工视觉验收。

---

# 131. Production Art Visual Gate

所有进入正式 Release 的主要角色立绘、CG、背景、重要 UI Key Visual，MUST 经过 Production Art Visual Gate。

至少包含：

```text
VISUAL_IDENTITY_PASS
COMPOSITION_PASS
STYLE_PASS
SCENE_INTEGRATION_PASS
MOBILE_PASS
DESKTOP_PASS
PROVENANCE_PASS
```

任一项为：

```text
FAIL
BLOCKED
UNVERIFIED
```

则该资产不得标记为：

```text
ART_READY
```

正式 Release Gate 中：

```text
ART_READY = FAIL
=> NO RELEASE
```

自动化检查不得将 `UNVERIFIED` 自动转换为 `PASS`。

---

# 132. 角色立绘正式验收 Gate

主要角色正式立绘 MUST 基于 Character Master 进行人工对照。

最低验收项：

```text
Character Master 对照              PASS
角色身份稳定                       PASS
五官抽象程度                       PASS
人体比例                           PASS
发型 / 发色                        PASS
服装 / 饰品                        PASS
线稿逻辑                           PASS
阴影逻辑                           PASS
角色辨识度                         PASS
与同作品正式角色画风一致           PASS
Neutral 实际剧情场景截图           PASS
Expression 差分一致                PASS
移动端实际构图                     PASS
桌面端实际构图                     PASS
无 Placeholder                     PASS
无程序生成占位稿冒充正式稿         PASS
Provenance 与真实来源一致           PASS
```

如果 Neutral Master 未通过，基于该 Neutral 制作的所有表情差分 SHOULD 视为继承失败，不得通过“差分本身正确”单独进入正式 Release。

程序化 SVG、模板化几何人物、占位头像等 MAY 用于 Prototype / Alpha。

除非作品视觉设计明确声明其为最终风格，否则不得在 BETA / RC / RELEASE 中冒充正式角色立绘。

---

# 133. 实际场景美术验收

人工美术验收 MUST 在实际运行场景中进行，不能只看单独资产文件。

至少检查：

- 角色与背景比例
- 角色是否遮挡对白 / Choice / 系统按钮
- 角色头顶 / 脚部是否异常裁切
- 角色是否因 viewport 导致过大或过小
- CG 是否被 UI 非预期覆盖
- Key Visual 是否遮挡可交互内容
- 背景重要信息是否被结构性 UI 长期遮挡
- 手机竖屏 / 窄屏构图是否仍成立
- 桌面 16:9 / 非 16:9 构图是否仍成立

正式验收 SHOULD 保留截图 Evidence。

推荐最少 Evidence：

```text
DESKTOP_1920x1080
DESKTOP_1366x768
MOBILE_TARGET_01
MOBILE_TARGET_02
```

目标平台不同，可替换为项目实际设备。

---

# 134. Key Visual 与剧情舞台边界

UI Key Visual、Title Visual、章节卡、收藏页 Header 等装饰性视觉 MUST 明确声明其使用范围。

装饰性 Key Visual MUST NOT 在普通可交互剧情 Scene 中长期：

- 全屏覆盖 Gameplay Stage
- 覆盖 Dialogue
- 覆盖 Choice
- 遮挡主要 Character Sprite
- 遮挡关键剧情信息
- 抢占主要交互层

只有 Scene 明确声明为以下类型时，MAY 使用全屏关键视觉：

```text
title
cg
transition
interstitial
special_presentation
```

若 Key Visual 仅用于品牌、章节、收藏、存档异常或其他 UI 装饰，应限制在对应 UI 容器或独立短时演出层。

所有装饰层 SHOULD 设置明确生命周期，不得依赖“进入某 Scene 后一直存在直到碰巧被清理”。

---

# 135. 移动端视觉硬门禁

声明支持移动端 / PWA 的作品，正式 Release 前 MUST 进行移动端视觉验收。

至少检查：

```text
Portrait Composition
Dialogue Safe Area
Choice Safe Area
Toolbar Overflow
Key Visual Overlay
CG Crop
Modal / Gallery
Save / Load
System Message
Viewport / Orientation
```

不得仅依赖桌面浏览器缩窄窗口代替所有移动端验收。

如果没有实体设备证据，应标记：

```text
MOBILE_PHYSICAL_DEVICE = UNVERIFIED
```

不得写成 PASS。

---

# 136. Provenance 真实性

Provenance MUST 描述资产真实生产链。

禁止将：

- 程序化 SVG 生成
- 模板拼接
- 手工矢量生成
- 第三方模型生成
- 其他工具生成

错误记录为另一种来源。

AI 辅助资产的 `generation_tool`、`model`、`prompt`、`reference` 等字段只有在真实发生时才可记录。

如果来源无法确认，应使用：

```text
source: UNVERIFIED
```

而不是推测。

发现 Provenance 与真实生产链不一致时：

```text
PROVENANCE_PASS = FAIL
ART_READY = FAIL
```

直到记录被纠正。

---

# 137. Placeholder / Procedural Art 防误发布

项目 SHOULD 为占位资产建立机器可检查标记。

推荐：

```text
asset_status: PLACEHOLDER
asset_status: DRAFT
asset_status: REVIEW
asset_status: READY
```

以下特征 SHOULD 触发额外人工复核：

- 文件名或 alt 含“占位”
- Source 来自 placeholder 目录
- Source 来自程序化角色生成器
- Asset 由 Prototype 阶段脚本批量生成
- 资产仅通过尺寸放大达到 Master 分辨率
- Provenance 与 Source 不一致

Release Gate MUST 失败于：

```text
PLACEHOLDER referenced by production runtime
```

---

# 138. Art QA Evidence

关键正式美术 SHOULD 为人工验收保留最小 Evidence。

每个主要角色 Neutral Master 推荐记录：

```text
asset_id
master_sha256
runtime_sha256
character_master_ref
reviewer
review_date
desktop_evidence
mobile_evidence
visual_identity
composition
style
scene_integration
provenance
status
```

推荐状态示例：

```text
asset_id: xuqi/neutral
TECH_READY: PASS
VISUAL_IDENTITY: FAIL
COMPOSITION: PASS
STYLE: FAIL
PROVENANCE: UNVERIFIED
ART_READY: FAIL
```

不得因为 `TECH_READY: PASS` 自动推导 `ART_READY: PASS`。

---

# 139. Release Art Gate

正式版本发布前，Art Gate MUST 输出可检查结果。

示例：

```text
CHARACTER_MASTER       6 / 6 PASS
CHARACTER_NEUTRAL      6 / 6 PASS
EXPRESSION_SETS       33 / 33 PASS
BACKGROUND            20 / 20 PASS
CG                      5 / 5 PASS
UI_KEY_VISUAL           5 / 5 PASS
MOBILE_VISUAL          PASS
DESKTOP_VISUAL         PASS
PROVENANCE             PASS
PLACEHOLDER_SCAN       PASS

ART_READY              PASS
```

若存在：

```text
CHARACTER_NEUTRAL      5 / 6 PASS
```

则应显示：

```text
ART_READY              FAIL
RELEASE                BLOCKED
```

不得用总分平均掩盖关键资产失败。

---

# 140. 视觉事故回归原则

当真实设备、玩家截图或人工复核发现已发布版本存在明显视觉事故时：

- 对应自动化 PASS 不得被视为足以证明视觉正确
- 应回溯验收 Gate 缺失项
- 应为该事故增加回归测试或人工 Gate
- 已错误标记的 `ART_READY` 应撤回
- 后续 Release 必须验证该类问题不会再次发生

典型视觉事故包括：

```text
Key Visual 全屏遮挡剧情
角色立绘比例严重异常
Placeholder 进入正式运行时
程序化占位稿冒充正式美术
移动端重要 UI 被遮挡
CG / 角色被错误裁切
Provenance 与真实来源不符
```

事故修复完成前，相关状态 SHOULD 标记：

```text
BLOCKED
```

而不是：

```text
基本完成
```


---

**GALGAME SPEC v0.2**

`Single Source of Truth`
