# @lijixu/bark-notify

[![English](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-lightgrey?style=flat-square&labelColor=555555&logo=github&link=./README.en.md)](./README.en.md)
[![npm](https://img.shields.io/npm/v/@lijixu/bark-notify?style=flat-square&labelColor=0f172a)](https://www.npmjs.com/package/@lijixu/bark-notify)

> 当前语言：**简体中文** ｜ [English](./README.en.md)

DSH 插件：任务跑完、需要你授权、或者运行出错时，把通知推到你的 iPhone（会自动镜像到配对的 Apple Watch）。

**你只需要做两件事**：iPhone 上装好 [Bark](https://bark.day.app) App，然后把这个 App 给你的 Key 填进配置。

## 什么情况下会收到通知

| 什么时候 | 收到什么 |
|---|---|
| 任务跑完 | `✅ 任务完成` |
| 有个工具调用需要你点「允许」 | `🔔 需要授权` |
| 运行出错 | `⚠️ 运行出错` |
| 你自己点了「停止」 | 不推送（这是故意的，见下） |

几条默认行为，都是为了不打扰你：

- **手动停掉的任务不会被报成「任务完成」**。想让中止也通知，把 `notifyOnAbort` 设为 `true`，会收到一条 `⏹️ 已中止`。
- **出错只推一条**，不会在错误通知后面再补一条「任务完成」。
- **子 Agent 默认静默**。一次任务可能派生很多子 Agent，全都推会刷屏；要开就设 `includeSubagents: true`。
- **只是通知，不替你决定**。授权仍然要在 DSH 里正常确认，插件不会动授权结果。

## 安装

**前置**：iPhone 上安装 Bark App，打开首页会看到 `https://api.day.app/xxxxx`，其中 `xxxxx` 就是你的 Key。

在 DSH 里执行：

```
plugin_manager: { action: "install_bundle", target: "@lijixu/bark-notify" }
```

装完**重启 DSH**。想从源码或 GitHub 装（`github:xuliji/bark-notify`、本地绝对路径等），写法见 [PUBLISHING.md](https://github.com/xuliji/bark-notify/blob/main/PUBLISHING.md)。

## 配置

`deviceKey` **必填**。不填的话插件只会在日志里提示一句，不会联网推送。

推荐写进 profile 的 patch 层（`~/.dsh/profiles/desktop/cordis.patch.yml`），这一层优先级更高，插件升级时配置不会丢：

```yaml
- id: bark-notify
  name: '@lijixu/bark-notify'
  config:
    deviceKey: '你的 Bark Key'
```

改完 **重启 DSH** 生效。以下全部可选项：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `serverUrl` | `https://api.day.app` | Bark 服务器地址；自建 bark-server 就改成自己的域名 |
| `notifyOnFinish` | `true` | 任务跑完是否推送 |
| `notifyOnApproval` | `true` | 需要你授权时是否推送 |
| `notifyOnError` | `true` | 运行出错时是否推送 |
| `notifyOnAbort` | `false` | 手动中止时是否推送 |
| `includeSubagents` | `false` | 子 Agent 是否也推送 |
| `settleMs` | `1500` | 结束多久后才推（毫秒），用来跳过「刚结束又立刻开始」的抖动；`0` 表示立即推 |
| `timeoutMs` | `10000` | 单次推送的超时时间（毫秒） |
| `group` | `DeepSeek Harness` | Bark 通知分组，方便在 App 里分类查看 |
| `sound` | 空 | Bark 铃声名，留空用系统默认 |
| `level` | `active` | 打扰级别：`active` / `timeSensitive` / `passive` / `critical` |
| `icon` | 空 | 通知图标 URL |
| `url` | 空 | 点通知要打开的链接 |

## 通知长这样

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

最后一行是任务标题 + 会话 ID 前 8 位，方便你知道是哪条会话在叫你。

## 常见问题

**完全收不到通知？** 按顺序排查：

1. `deviceKey` 填了吗、有没有抄错（为空时插件不会联网）。
2. 改完配置**重启 DSH** 了吗？配置只在启动时读取。
3. 用了自建 bark-server 的话，`serverUrl` 改了吗？
4. iPhone 上 Bark App 的通知权限是否开着，有没有被「专注模式」挡掉。
5. `level` 是不是 `passive` —— 它不会亮屏也不会响，只安静地进通知中心。

**太吵了，只想在需要授权时提醒我？** 把 `notifyOnFinish` 和 `notifyOnError` 设为 `false`；或者把 `level` 改成 `passive`。

**一次任务收到好几条通知？** 子 Agent 默认不推，如果开了 `includeSubagents` 会明显变多；`settleMs` 则用来合并「刚结束又立刻开始」的情况。

**我点了停止，怎么没通知？** 故意的，中止不算完成。要收就设 `notifyOnAbort: true`。

**我的 Key 会泄漏吗？** 不会。Key 只存在你本机的 DSH 配置里，插件只把它 POST 到你配置的 `serverUrl`（默认官方 `api.day.app`）。

## 卸载

彻底卸载：

```
plugin_manager: { action: "remove_bundle", target: "@lijixu/bark-notify" }
```

只想临时关掉：

```
plugin_manager: { action: "set_bundle", target: "@lijixu/bark-notify", enabled: false }
```

两种都需要**重启 DSH** 生效。

## 给开发者

维护者文档（中文）：

- [DEVELOPMENT.md](https://github.com/xuliji/bark-notify/blob/main/DEVELOPMENT.md) —— 目录结构、跑测试、实现要点
- [PUBLISHING.md](https://github.com/xuliji/bark-notify/blob/main/PUBLISHING.md) —— 打包、发布到 npm、GitHub 托管

## License

[MIT](./LICENSE)
