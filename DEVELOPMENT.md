# 开发与实现说明

面向维护本插件的开发者。用户怎么装、怎么配，看 [README.md](./README.md)；怎么打包发布，看 [PUBLISHING.md](./PUBLISHING.md)。

## 目录结构

```
plugin.js             # 插件实现（零依赖，ESM）
cordis.patch.yml      # bundle 默认配置（安装时写进 profile 的那一行）
locale/{en,zh}.json   # Plugin Manager 里展示的名称与描述
icon.svg              # 图标
test/plugin.test.js   # node:test 用例（不发布）
.github/workflows/    # CI
```

## 跑测试

```bash
npm test          # 等价于 node --test
node --check plugin.js
```

15 条用例，覆盖纯函数（配置归一化、子 Agent 判定、`turn/end` 分类）和**行为**：用例会起一个本地 HTTP 服务冒充 Bark API，断言的不只是「决定推不推」，还有真正发出去的请求体。所以改动事件判定后一定要跑它。

## 通知契约

这是插件的核心约定，改代码前先读这段。

`agent/status` 只有 `idle` / `running` 两个状态，**中止和正常结束在这里长得一模一样**。真正的结束原因在 `turn/end` 事件的 `reason` 里：

| 本轮 `turn/end` 原因 | 插件行为 |
|---|---|
| `aborted`（手动停止 / 上级 Agent 取消 / hook 取消 / 会话关闭） | 默认不推送；`notifyOnAbort: true` 时推 `⏹️ 已中止` |
| `error` | 只推 `⚠️ 运行出错`（由 `agent/error` 触发），不再补 `✅ 任务完成` |
| 其他（`completed`、`max-tokens`、`blocked` …） | 推 `✅ 任务完成` |
| 没观察到 `turn/end` | 不推送 |

最后一条很重要：一次 `idle` 只有在**本次空闲期间真的发生过 `turn/end`** 时才算「结束」。被唤醒但无活可干的空转不算，否则会误报完成。

## 实现要点

- **中止要自己读日志**。点「停止」时 `dsh-agent-loop` 只 append `turn/end { reason: { kind: 'aborted', reason: { kind: 'user' } } }`，**不发** `agent/error`，`agent/status` 也只是 `running → idle`。所以插件监听 `session/event`（post-commit 事件源，在 `append` 期间**同步**回调，因此必定早于随后的 `idle`），把 `turn/end` 的 reason 按 Session 记进 `WeakMap`，在 `agent/status` 落到 `idle` 时**消费一次并删除**。消费式读取正是上面「空转不误报」的实现方式。
- **子 Agent 判定必须用 `header.origin === 'subagent'`**，不能只看 `header.parentSession`：用户手动 fork 会话时 `SessionController.fork()` 也会写 `parentSession`（但不写 `origin`、不写 `delegationDepth`）。只按 `parentSession` 判断会把用户自己 fork 出来的会话当成子 Agent，默认配置下永久静音。
- **授权监听必须 `prepend`**。`approval/request` 是瀑布链，链上第一个监听器是 Host 启动时注册的「终止应答者」，它拿到人工决定后直接返回、不再调用 `next()`。排在链尾的监听器永远不会执行，所以必须 `ctx.on('approval/request', handler, { prepend: true })` 才能观察到请求，然后原样 `next()` 把决定权交回去。
- **零依赖**。profile 里安装的 bundle 是软链到本目录、按真实路径解析的，`@deepseek-ai/*` 这类只存在于 dsh 安装目录里的包**解析不到**（实测 import 失败）。因此本插件不 import 任何模块，`resolveSettings()` 自己做默认值与校验。副作用：它不会在 Plugin Manager 里投影出配置表单，配置只能写 YAML。
- **Bark HTTP API v2**：`POST {serverUrl}/push`，JSON 体 `{ device_key, title, body, group?, sound?, level?, icon?, url? }`，返回 `code: 200` 视为成功；空字符串字段不会出现在请求体里。
- HTTP 用进程内 `fetch`，带超时，并随插件卸载一起中止。
- 监听器都注册在插件上下文里，卸载时自动注销；Agent 被 dispose 时清掉它的去抖定时器与状态，卸载时清空全部并中止在途请求。
- 推送失败只记 warn 日志，绝不影响 Agent 运行或授权流程。

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) 在 push / PR 时用 Node 20 与 22 跑 `npm test` 和 `npm pack --dry-run`（后者用来防止 `files` 漏文件）。

**自动发布是有意不加的**：npm 现在对发布强制 2FA，CI 发布需要 granular token 并处理 2FA bypass 规则（而且那条路正在被 npm 收紧）。发布留在终端手动执行，步骤见 [PUBLISHING.md](./PUBLISHING.md)。

## 本地调试

改完 `plugin.js` **必须重启 DSH**：DSH 按「模块代」缓存已加载的插件，重新安装同一个 bundle 只会重新应用行与配置，不会替换已加载的 JavaScript 模块（`plugin_manager` 会明确返回 `restart-required`）。

验证中止行为的最快路径：随便发一句话让 Agent 跑起来，然后点「停止」——应该**没有**推送；再正常跑完一次——应该收到 `✅ 任务完成`。
