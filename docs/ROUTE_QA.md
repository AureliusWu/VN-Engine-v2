# 路线用例与回归报告

项目可声明 `routeTests: {schema:1,cases:[...]}`。用例从真实开场独立执行，不使用伪造的初始变量、导入历史或解锁数据。未声明时开发播放保持兼容，路线验证返回 UNVERIFIED。

```json
{
  "schema": 1,
  "cases": [{
    "id": "trust-route",
    "steps": [{"type":"action","id":"yes"}],
    "expect": {"ending":"完成","variables":{"trust":1}}
  }]
}
```

步骤支持 `next`、`action`（id）、`mini-start`、`mini-input`（index）、`mini-skip`、`mini-abort`、`mini-finish`、`checkpoint` / `restore`（命名 id）。`expect` 可检查 sceneId、lineId、准确 text、ending、variables 的指定变量及准确 evidence 集合。调查结局使用 `chapter-id:complete/failure`。

`runRouteSuite(project)` 使用真实 RuntimeSession、玩法 driver 与 codec。作者停顿使用注入的虚拟时钟，文字直接完整显示；每一步保存并恢复，再比较真实帧、变量、证据、小游戏状态与历史。命名检查点另外验证回到选择之前或分支中间。它不创建 DOM、媒体、Save / Meta / 已读存储，不验证真实画面和听感。

每套最多 64 个用例、每用例 4096 个步骤，默认总预算 20,000 次操作；预算耗尽保留定位并标 UNVERIFIED。失败给出用例、步骤、当前节点、实际值和轨迹。报告区分：用例失败为 FAIL；没有用例、未执行完或未覆盖声明结局为 UNVERIFIED；只有全部用例与声明结局覆盖通过才为 PASS。仅成功用例贡献覆盖。

这不是穷举分支求解器。相同结局可能有多种路径，作者应分别声明所需用例；结局覆盖不证明所有分支组合都已检查。剧情质量、美术、媒体与平台体验继续使用原 QA。

```bash
npm run test:routes -- project.json --output=ROUTE_REPORT.json
```

CLI 无论失败或未验证都会保留可解析报告，并使用非零退出码；报告记录实际源文件 SHA256 和引擎版本。源码不执行任意脚本步骤。
