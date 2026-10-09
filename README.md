# @lijixu/bark-notify

[![English](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-lightgrey?style=flat-square&labelColor=555555&logo=github&link=./README.en.md)](./README.en.md)
[![npm](https://img.shields.io/npm/v/@lijixu/bark-notify?style=flat-square&labelColor=0f172a)](https://www.npmjs.com/package/@lijixu/bark-notify)
[![CI](https://github.com/xuliji/bark-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/xuliji/bark-notify/actions/workflows/ci.yml)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-1677ff?style=flat-square&labelColor=0f172a)](https://github.com/DeepSeek-AI)

> 当前语言：**简体中文** ｜ [English](./README.en.md)

DSH 插件：Agent 运行结束、需要人工授权、或运行出错时，通过 [Bark](https://bark.day.app) 推送到 iPhone / Apple Watch。

Bark 的通知会由 iPhone 自动镜像到配对的 Apple Watch，所以只需在 iPhone 上装好 Bark App。

## 通知时机

| 事件 | 触发点 | 通知标题 |
|---|---|---|
| Agent 运行结束 | `agent/status` 从 `running` 落到 `idle`，且本轮 `turn/end` 原因为 `completed`，`settleMs` 后仍空闲 | `✅ 任务完成` |
| 需要授权 | `approval/request`（工具调用等待人工批准） | `🔔 需要授权` |
| 运行出错 | `agent/error`（某一轮 / 某一步出错） | `⚠️ 运行出错` |
| 运行被中止 | 本轮 `turn/end` 原因为 `aborted`，且 `notifyOnAbort: true` | `⏹️ 已中止` |

**被中止的运行不会被当成「任务完成」。** 点「停止」时 `dsh-agent-loop` 只会记下 `turn/end { reason: { kind: 'aborted', reason: { kind: 'user' } } }`，**不会**发出 `agent/error`，而 `agent/status` 同样只是从 `running` 落到 `idle` —— 光看状态是分不出「跑完了」和「被停了」的。因此插件额外监听 `session/event`，读出本轮 `turn/end` 的原因再决定推不推：

| 本轮 `turn/end` 原因 | 插件行为 |
|---|---|
| `aborted`（手动停止 / 上级 Agent 取消 / hook 取消 / 会话关闭） | 默认**不推送**；`notifyOnAbort: true` 时改推 `⏹️ 已中止`（正文写明是谁中止的） |
| `error`（本轮以失败收尾） | 只推 `⚠️ 运行出错`，不再补一条 `✅ 任务完成` |
| 其他（`completed`、`max-tokens` 等正常收尾） | 推 `✅ 任务完成` |
| 没有 `turn/end`（被唤醒但无活可干） | 不推送 |

插件只做「旁观者」：授权事件始终调用 `next()` 交回给原有的审批 UI，不会抢占或改变授权结果。

## 安装

已发布到 npm，一条命令即可（也可以从源码目录或 GitHub 装，见「打包与发布」）：

```
plugin_manager: { action: "install_bundle", target: "@lijixu/bark-notify" }
```

安装会在当前 profile 的 `dsh.profile.bundles` 末尾加入本 bundle，并写入 `bark-notify` 行；改动对所有会话生效，重启后依然存在。

> **⚠️ 改了插件代码后必须重启 DSH。**
> DSH 按「模块代」缓存已加载的插件：重新安装同一个 bundle 只会重新应用行与配置，不会替换已加载的 JavaScript 模块（`plugin_manager` 会明确返回 `restart-required`）。

## 打包与发布

一个 DSH bundle 就是**一个普通 npm 包**，只要求 `package.json` 里有 `dsh.bundle.patch` 指向它的 patch 文件（见 [`package.json`](./package.json)）。`cordis.patch.yml` 里的 `id` / `name` / `config` 就是安装后写进 profile 的那一行，`plugin.js` 是真正被加载的入口（`main` / `exports`）。本仓库**零依赖、零转译、无构建步骤**，所以「打包」= 把文件放进包里 —— `npm pack` 出来的 tarball 就是可分发的成品（9 个文件、约 17 kB）。

### 当前状态

| 项 | 值 |
|---|---|
| npm 包名 | `@lijixu/bark-notify` |
| GitHub 仓库 | <https://github.com/xuliji/bark-notify> |
| 发布可见性 | 公开（`publishConfig.access = "public"`；scoped 包默认是私有的，免费账号发不了） |
| 三处名字 | `package.json` 的 `name`、`cordis.patch.yml` 的 `name:`、本文档的示例 —— **必须完全一致**，否则 profile 里那一行会指向不存在的包 |

> GitHub 用户名是 `xuliji`，npm 用户名是 `lijixu`，两者不是同一个，改配置时别混。

### 首次发布（手动）

```bash
cd /Users/lijixu/Documents/bark-notify
npm test                # 15 条 node:test 用例
npm pack --dry-run      # 确认包内容：9 个文件，test/ 不会进包
npm publish             # publishConfig 已声明 public，不需要再加 --access public
```

### 后续发版

```bash
npm version patch       # 或 minor / major；会顺带打 git tag 并提交
git push --follow-tags
npm publish
```

DSH 侧升级：再跑一次 `install_bundle`（或在 Plugin Manager 里更新该 bundle），然后重启 DSH。

### 托管到 GitHub

仓库推上去（远端还没建的话，先在 GitHub 上建一个空的 `bark-notify`）：

```bash
cd /Users/lijixu/Documents/bark-notify
git add -A
git commit -m "feat: 发布为 @lijixu/bark-notify，修复中止误报完成"
git branch -M main
git remote add origin https://github.com/xuliji/bark-notify.git   # 已有 origin 则用 git remote set-url
git push -u origin main
```

仓库里的 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 会在 push / PR 时跑 `npm test` 与 `npm pack --dry-run`（Node 20 + 22）。**自动发布按你的选择没加**，npm 发布保持在终端手动执行 —— 这样第一个版本不用碰 npm 的 token / 2FA bypass 新规。

### 安装来源（`install_bundle` 的 `target` 支持哪些写法）

`target` 会被 `dsh-plugin-manager` 先解析成 install spec，支持以下形式：

| 形式 | 例子 |
|---|---|
| npm 包名 | `@lijixu/bark-notify`、`@lijixu/bark-notify@1.0.1` |
| 绝对路径 / `file:` / `link:` | `/Users/lijixu/Documents/bark-notify` |
| GitHub 简写 / git URL | `github:xuliji/bark-notify`、`git+https://github.com/xuliji/bark-notify.git` |
| 仓库 URL | `https://github.com/xuliji/bark-notify` |
| tarball（本地或远程） | `…/lijixu-bark-notify-1.0.0.tgz`、`https://…/x.tgz` |

（相对路径会被拒绝：Host 的工作目录和你在浏览器里输入的位置没有关系。）

### 三个坑

- **🔑 不要把真实 Bark Key 写进仓库里的 `cordis.patch.yml`。** 那个文件会随 npm 包公开分发出去。仓库里的 `deviceKey` 保持空占位符，真 Key 写在 profile 的 patch 层（`~/.dsh/profiles/desktop/cordis.patch.yml`，不在 git 里、升级 bundle 也不会丢），它的优先级高于 bundle 层。
- **改了 `plugin.js` 必须重启 DSH。** DSH 按「模块代」缓存已加载的插件：重新安装同一个 bundle 只会重新应用行与配置，不会替换已加载的 JavaScript 模块（`plugin_manager` 会明确返回 `restart-required`）。发新版本时记得 bump `version`。
- **不要把 `@deepseek-ai/dsh*` 写进 `peerDependencies`。** DSH 会拿这些 peer 对运行时版本做 semver 校验，不匹配就拦下安装并要求对 `包名@版本` 逐条授予版本豁免；豁免本身带风险。本插件保持零依赖，正是为了在任何 dsh 版本上都能直接安装。

## 配置

安装时的默认配置（本 bundle 的 `cordis.patch.yml`）里 `deviceKey` 是空占位符，**必须填上你的 Bark Key** 才会真正联网推送。

推荐做法是在 profile 的 patch 层（`~/.dsh/profiles/desktop/cordis.patch.yml`）追加一条同 id 覆盖，它会覆盖 bundle 层的配置，真 Key 不会进 git、升级本 bundle 时也不会丢：

```yaml
- id: bark-notify
  name: '@lijixu/bark-notify'
  config:
    deviceKey: '你的 Bark Key'      # Bark App 首页 https://api.day.app/xxxxx 中的 xxxxx
    # 其余为可选覆盖
    # serverUrl: https://api.day.app
    # notifyOnFinish: true
    # notifyOnApproval: true
    # notifyOnError: true
    # notifyOnAbort: false
    # includeSubagents: false
    # settleMs: 1500
    # timeoutMs: 10000
    # group: DeepSeek Harness
    # sound: ''
    # level: active
    # icon: ''
    # url: ''
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `serverUrl` | `https://api.day.app` | Bark 服务器地址；自建 bark-server 改成自己的域名 |
| `deviceKey` | 空 | **必填**，Bark 设备 Key；为空时只记录日志、不联网 |
| `notifyOnFinish` | `true` | Agent 运行结束是否推送 |
| `notifyOnApproval` | `true` | 需要授权是否推送 |
| `notifyOnError` | `true` | 运行出错是否推送 |
| `notifyOnAbort` | `false` | 运行被中止（含手动停止）是否推送；关闭时中止不打扰，打开时改推 `⏹️ 已中止` |
| `includeSubagents` | `false` | 是否也为子 Agent（subagent）推送 |
| `settleMs` | `1500` | 空闲后延迟多久才推送，跳过「刚结束又立刻开始」的抖动；设为 `0` 立即推送 |
| `timeoutMs` | `10000` | 单次推送请求超时 |
| `group` | `DeepSeek Harness` | Bark 通知分组 |
| `sound` | 空 | Bark 铃声名，空为系统默认 |
| `level` | `active` | 中断级别：`active` / `timeSensitive` / `passive` / `critical` |
| `icon` | 空 | 通知图标 URL |
| `url` | 空 | 点击通知打开的 URL |

> 配置是**每次推送时读取**的：改完 YAML 重启 DSH 生效；插件自身不校验字段名，未知键会被忽略，字段类型不对则回退默认值。

## 推送内容示例

```
✅ 任务完成
Agent 本轮运行已结束
重构登录模块（7dbd389b）
```

```
🔔 需要授权
工具：bash
原因：在工作区外写入文件
重构登录模块（7dbd389b）
```

```
⚠️ 运行出错
第 3 轮 / 第 2 步出错
ENOENT: no such file or directory, open 'src/app.ts'
重构登录模块（7dbd389b）
```

```
⏹️ 已中止
运行已被手动中止
重构登录模块（7dbd389b）
```

会话标题取自可选的 `sessionTitle` 服务；服务缺失时退化为「会话 + 短 ID」。

## 实现要点（维护者必读）

- **「跑完了」和「被停了」要靠日志区分**：`agent/status` 只有 `idle` / `running` 两个状态，中止和正常结束在这里完全一样。真正的原因是 `turn/end` 的 `reason`（由 `dsh-agent-loop` 在 `turn()` 的 `finally` 里 append）。插件监听 `session/event`（post-commit、append 期间同步回调，因此一定早于随后的 `idle`）把原因按 Session 记进 `WeakMap`，在 `agent/status` 落到 `idle` 时**消费一次**：只有本次 `idle` 真的有过 `turn/end` 才谈得上推送，所以「被唤醒但没有活可干」的空转不会误报完成。
- **子 Agent 判定必须用 `header.origin === 'subagent'`**，不能只看 `header.parentSession`：用户手动 fork 会话时 `SessionController.fork()` 也会写 `parentSession`（但不写 `origin`、不写 `delegationDepth`）。只按 `parentSession` 判断会把用户自己 fork 出来的会话当成子 Agent，默认配置下就再也收不到它的通知了。
- **授权监听必须 `prepend`**：`approval/request` 的瀑布链第一个监听器是 Host 启动时注册的「终止应答者」，它拿到人工决定后直接返回、不再调用 `next()`。因此排在链尾的监听器永远不会被执行，必须 `ctx.on('approval/request', handler, { prepend: true })` 才能观察到请求，并原样调用 `next()` 把决定权交回去。
- **零依赖**：profile 里安装的 bundle 是软链到本目录、按真实路径解析的，`@deepseek-ai/*` 这类只存在于 dsh 安装目录里的包**解析不到**（实测 import 失败）。所以本插件不 import 任何模块，`resolveSettings()` 自己做默认值与校验；这也意味着它不会在 Plugin Manager 里投影出配置表单，配置请按上表写 YAML。
- **Bark HTTP API v2**：`POST {serverUrl}/push`，JSON 体 `{ device_key, title, body, group?, sound?, level?, icon?, url? }`，返回 `code: 200` 视为成功；空字符串字段不会出现在请求体里。
- HTTP 用进程内 `fetch`；请求带超时，并随插件卸载一起中止。
- 监听器都注册在插件上下文里，卸载时自动注销；Agent 被 dispose 时清掉它的去抖定时器与状态，卸载时清空全部并把在途请求中止。
- 子 Agent 默认不推送，避免一次任务产生大量通知。
- 通知推送失败只记 warn 日志，不会影响 Agent 运行或授权流程。

## 目录结构

```
plugin.js             # 插件实现（零依赖，ESM）
cordis.patch.yml      # bundle 默认配置
locale/{en,zh}.json   # Plugin Manager 里展示的名称与描述
icon.svg              # 图标
test/plugin.test.js   # node:test 用例（不发布）
```

## License

[MIT](./LICENSE)

