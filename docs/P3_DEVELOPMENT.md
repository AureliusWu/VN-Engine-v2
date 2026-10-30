# P3 文本演出与资源诊断 · v1.3.0

本轮基于 [参考引擎对照](REFERENCE-MINING-v1.3.0.md) 实施 [计划](PLAN-v1.3.0.md)。演出编译到既有 ScriptProgram 的 block.cue / line.cue，核心执行、canonical replay、工程与存档格式不变。实现为原创代码，没有复制参考仓库实现或加入其运行依赖。

## 显式演出指令

```text
cue block start background classroom
cue block start music theme
cue line hello portrait student
cue line hello voice greeting
cue line hello sound bell
cue line hello pause 200
cue line hello effect fade 150
cue block ending music null
```

形式为 `cue block <blockId> <field> <value>` 或 `cue line <lineId> <field> <value>`，均允许前向引用，排版或声明顺序不会重编号。相同目标的同一字段只可声明一次，未知目标与字段会返回明确诊断。引号继续使用原 JSON 字符串规则；未加引号的 null 清除持续字段，加引号的 "null" 是资源 ID。

| 字段 | 允许值 | 既有 IR |
| --- | --- | --- |
| background / portrait / cg | 资源 ID 或 null | 同名 cue 字段 |
| music / ambience | audio 资源 ID 或 null | 同名 cue 字段 |
| sound / voice | audio 资源 ID，不接受 null | 当前访问的单次媒体绑定 |
| pause | 0–30000 整数，单位 ms | pauseMs |
| effect | fade / flash / shake，可再带 0–2000 整数 ms | effect.type / effect.durationMs；省略时沿用宿主默认 |

block 持续字段可作用于无对白的 routing block；sound / voice / pause / effect 要求目标有对白。block 一次性字段仅在该 block 首句可见，line cue 绑定明确台词。恢复、回看、回滚、暂停和跳过沿既有宿主政策运行，不因为多了一层文本前端补播历史音效。

新增 maxCues 预算默认及硬上限为 30000，可收紧，其他源长、token、字符串、结构与诊断上限继续适用。失败不返回半个 program。sourceMap 新增 kind=cue，path 精确到已有 cue 字段，仍为 ScriptProgram 相对路径、UTF-16 offset、一基行列、exclusive end。复杂 timeline、layers、video、小游戏等仍由既有 Studio / JSON 作者入口提供，本轮没有任意 JSON 指令或代码执行。

## 可选工程上下文

```ts
import { compileTextScript, checkTextScriptProject } from '@aureliuswu/vn-engine-v2/script-text';

const compiled = compileTextScript(source, { fileName: 'story.vn' });
const checked = checkTextScriptProject(compiled, {
  type: 'script', game: project.game, version: project.version,
  assets: project.assets.map(({ id, kind }) => ({ id, kind }))
});
```

检查只读取 type / game / version 及目录的 id / kind，不读取 src 或资源文件，不 fetch、不创建运行时。目录最多 10000 条，ID 非空且不超过 4096 UTF-16 单位，种类沿 AssetKind 七种值，重复 ID 拒绝。它只核对已编译脚本的七种视觉 / 音频引用，实际文件、许可、解码、艺术与设备验收继续走现有门禁。

缺失返回 DSL_ASSET_MISSING，类型不符返回 DSL_ASSET_KIND，身份不符返回 DSL_PROJECT_IDENTITY，目录非法返回 DSL_PROJECT_CONTEXT。诊断携带精确 DSL span、ScriptProgram 相对 path、稳定 blockId / lineId / assetId，以及候选 IR 的 SourceOrigin（path 带 program 前缀）。未应用候选不绑定到旧 JSON 的 source SHA，不冒充当前工程来源。

checkTextScriptProject 返回独立结果，不修改输入；语法失败保留语法诊断，不推断候选。上下文 options.maxDiagnostics 默认 100，仅可收紧到 1–100；合并诊断超出预算时明确报 DSL_DIAGNOSTIC_BUDGET，不能静默通过。projectContext.checked 表示已完成核查，成功仍以整个 result.ok 为准。

## CLI / Agent / Studio

- CLI：`node tools/compile-script.mjs examples/dsl/stage.vn.txt --out PROGRAM.json --map MAP.json --project examples/runtime/stage.json`。可省略 --project 保留独立编译；上下文读取限 8 MB 常规 JSON 文件，支持既有编辑器文档的 project。语法失败不读取上下文，检查失败不写输出；已有目标保留。
- Agent：`script.compile` 可提供 projectContext，内容为上述最小对象，assets 条目仅传 id / kind。省略上下文仍无需工程文件。返回只读分页，source / fileName / context 都参与游标绑定，目录 ID 或种类变化会使旧游标失效；不产生 candidate、receipt 或 journal。
- Studio：资源清单随编译和应用实时核对，清单或身份变化后重新检查；失败禁止应用，点击诊断选中当前 DSL 指令。候选预览不改 JSON，应用只替换 program，一次撤销恢复，其余身份 / 资源 / UI / 制作字段保留。目录绑定用于真实文件预览，与 id/kind 核对分开。

完整样例为 [stage.vn.txt](../examples/dsl/stage.vn.txt)，对应 [stage.json](../examples/runtime/stage.json)。Studio“独立引擎样例”可打开“文本演出（DSL）”；“载入语法示例”按当前清单提供合法的画面 / 音乐绑定，并示范停顿和效果。

玩家包继续只携带 JSON IR，排除 text.js、text/project.js、DSL 原文和 source map；Studio 包保留作者模块。验证范围见 [v1.3.0 验证](VALIDATION-v1.3.0.md)。
