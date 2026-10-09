# @local/bark-notify

[![English](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-lightgrey?style=flat-square&labelColor=555555&logo=github&link=./README.en.md)](./README.en.md)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-1677ff?style=flat-square&labelColor=0f172a)](https://github.com/DeepSeek-AI)

> 当前语言：**简体中文** ｜ [English](./README.en.md)

DSH 插件：Agent 运行结束、需要人工授权、或运行出错时，通过 [Bark](https://bark.day.app) 推送到 iPhone / Apple Watch。

Bark 的通知会由 iPhone 自动镜像到配对的 Apple Watch，所以只需在 iPhone 上装好 Bark App。

## 通知时机

| 事件 | 触发点 | 通知标题 |
|---|---|---|
| Agent 运行结束 | `agent/status` 从 `running` 落到 `idle`，且 `settleMs` 后仍空闲 | `✅ 任务完成` |
| 需要授权 | `approval/request`（工具调用等待人工批准） | `🔔 需要授权` |
| 运行出错 | `agent/error`（某一轮 / 某一步出错） | `⚠️ 运行出错` |

插件只做「旁观者」：授权事件始终调用 `next()` 交回给原有的审批 UI，不会抢占或改变授权结果。

## 安装

```
plugin_manager: { action: "install_bundle", target: "<本目录绝对路径>" }
```

安装会在当前 profile 的 `dsh.profile.bundles` 末尾加入本 bundle，并写入 `bark-notify` 行；改动对所有会话生效，重启后依然存在。

> **⚠️ 改了插件代码后必须重启 DSH。**
> DSH 按「模块代」缓存已加载的插件：重新安装同一个 bundle 只会重新应用行与配置，不会替换已加载的 JavaScript 模块（`plugin_manager` 会明确返回 `restart-required`）。

## 配置

安装时的默认配置（本 bundle 的 `cordis.patch.yml`）里 `deviceKey` 是空占位符，**必须填上你的 Bark Key** 才会真正联网推送。

推荐做法是在 profile 的 patch 层（`~/.dsh/profiles/desktop/cordis.patch.yml`）追加一条同 id 覆盖，它会覆盖 bundle 层的配置，且升级本 bundle 时不会丢：

```yaml
- id: bark-notify
  name: '@local/bark-notify'
  config:
    deviceKey: '你的 Bark Key'      # Bark App 首页 https://api.day.app/xxxxx 中的 xxxxx
    # 其余为可选覆盖
    # serverUrl: https://api.day.app
    # notifyOnFinish: true
    # notifyOnApproval: true
    # notifyOnError: true
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

会话标题取自可选的 `sessionTitle` 服务；服务缺失时退化为「会话 + 短 ID」。

## 实现要点（维护者必读）

- **授权监听必须 `prepend`**：`approval/request` 的瀑布链第一个监听器是 Host 启动时注册的「终止应答者」，它拿到人工决定后直接返回、不再调用 `next()`。因此排在链尾的监听器永远不会被执行，必须 `ctx.on('approval/request', handler, { prepend: true })` 才能观察到请求，并原样调用 `next()` 把决定权交回去。
- **零依赖**：profile 里安装的 bundle 是软链到本目录、按真实路径解析的，`@deepseek-ai/*` 这类只存在于 dsh 安装目录里的包**解析不到**（实测 import 失败）。所以本插件不 import 任何模块，`resolveSettings()` 自己做默认值与校验；这也意味着它不会在 Plugin Manager 里投影出配置表单，配置请按上表写 YAML。
- **Bark HTTP API v2**：`POST {serverUrl}/push`，JSON 体 `{ device_key, title, body, group?, sound?, level?, icon?, url? }`，返回 `code: 200` 视为成功；空字符串字段不会出现在请求体里。
- HTTP 用进程内 `fetch`；请求带超时，并随插件卸载一起中止。
- 监听器都注册在插件上下文里，卸载时自动注销；空闲去抖定时器与在途请求一并清理。
- 子 Agent 默认不推送，避免一次任务产生大量通知。
- 通知推送失败只记 warn 日志，不会影响 Agent 运行或授权流程。

## 目录结构

```
plugin.js            # 插件实现（零依赖，ESM）
cordis.patch.yml     # bundle 默认配置
locale/{en,zh}.json  # Plugin Manager 里展示的名称与描述
icon.svg             # 图标
```

## License

[MIT](./LICENSE)

