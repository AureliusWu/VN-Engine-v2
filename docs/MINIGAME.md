# 小游戏生命周期 v1

当前内置 `switches`（开关谜题）作为可实际运行的协议适配器。它不是通用战斗系统；其他玩法需要对应适配器。逻辑不依赖 DOM、浏览器存储或外部服务。

台词 / 场景 cue 声明：

```json
{
  "miniGame": {
    "id": "power-panel",
    "kind": "switches",
    "initial": [false, false, false],
    "target": [true, true, true],
    "maxMoves": 6,
    "results": {"success": "power-on", "failure": "power-failed", "abort": "leave", "skip": "power-on"}
  }
}
```

| 生命周期 | 规则 |
| --- | --- |
| entry | 绑定到带可用剧情操作的最后一句；文字显示和 authored hold 完成后才允许开始。不能放在全局 defaults。 |
| exit / result | 游戏得到结果后，由“继续剧情”执行对应的现有 driver action；该操作进入普通路线 / 调查日志。成功、失败和退出映射必填。 |
| save / restore | 手动 / Quick / Auto 保存当前输入记录，恢复重放有界输入；不信任导入的棋盘或成功标志。配置签名、台词身份或输入不匹配则拒绝，原进度保留。 |
| skip | 只有声明 `results.skip` 才提供跳过；未声明时禁止。 |
| abort | 明确映射到 `results.abort`，进入已退出结果，再返回剧情。销毁宿主直接释放会话，不自动选择剧情分支。 |
| pause | 隐藏、后台、面板和原生宿主暂停期间拒绝新输入。 |
| rollback | 检查点包含小游戏当前状态；从后续剧情回滚时可以恢复完成结果，随后再次确认进入剧情。Meta 解锁不回退。 |

开关数量 1–9，操作上限 1–100；每次输入切换一个开关。达到目标得到 success，达到上限仍未达到目标得到 failure。结果只通过已有剧情 action 写回，不直接修改剧情变量。正常选择和数字快捷键不能绕过正在进行的小游戏。

`RuntimeSession` 提供 `startMiniGame / playMiniGame / skipMiniGame / abortMiniGame / finishMiniGame`；快照 `miniGame` 可供其他宿主呈现。存档的可选 `vnMiniGame` 由会话层管理，现有存档版本不变。它提供可重建的过程状态，不是防作弊证明。

Studio 的正式图层与时间线面板可配置规则、操作预算和结果映射，并在同一引擎预览游玩。调查节点的库存门槛仍由原状态机决定：只有当前可用操作同时满足结果映射时才进入小游戏，否则保留原操作并提示配置不匹配。
