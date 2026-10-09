# @lijixu/bark-notify

[![简体中文](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-Simplified%20Chinese-lightgrey?style=flat-square&labelColor=555555&logo=github&link=./README.md)](./README.md)
[![npm](https://img.shields.io/npm/v/@lijixu/bark-notify?style=flat-square&labelColor=0f172a)](https://www.npmjs.com/package/@lijixu/bark-notify)

> Current language: **English** ｜ [简体中文](./README.md)

A DSH plugin that pushes a notification to your iPhone (mirrored to a paired Apple Watch automatically) when a task finishes, needs your approval, or errors out.

**All you need** is the [Bark](https://bark.day.app) app on your iPhone, and the key that app gives you.

## When you get notified

| When | What arrives |
|---|---|
| A task finishes | `✅ 任务完成` |
| A tool call needs you to tap Allow | `🔔 需要授权` |
| A run errors out | `⚠️ 运行出错` |
| You tap Stop yourself | Nothing (on purpose — see below) |

A few defaults exist to keep this quiet:

- **A run you stopped is never reported as finished.** If you want to hear about aborts too, set `notifyOnAbort: true` and you get `⏹️ 已中止` instead.
- **A failure is reported once.** An errored run does not also send a "finished" notification.
- **Child agents stay silent by default.** One task can spawn many subagents, and notifying for all of them is a flood; set `includeSubagents: true` to include them.
- **It only notifies.** Approvals still happen in DSH as usual — the plugin never answers them for you.

## Installation

**First**, install the Bark app on your iPhone. Its home screen shows `https://api.day.app/xxxxx`; `xxxxx` is your key.

Then, in DSH:

```
plugin_manager: { action: "install_bundle", target: "@lijixu/bark-notify" }
```

Restart DSH afterwards. Installing from source or GitHub (`github:xuliji/bark-notify`, or an absolute local path) is covered in [PUBLISHING.md](https://github.com/xuliji/bark-notify/blob/main/PUBLISHING.md).

## Configuration

`deviceKey` is **required**. While it is empty the plugin only logs a line and never touches the network.

The recommended place is your profile's patch layer (`~/.dsh/profiles/desktop/cordis.patch.yml`), which takes precedence over the plugin's own defaults and survives plugin upgrades:

```yaml
- id: bark-notify
  name: '@lijixu/bark-notify'
  config:
    deviceKey: 'YOUR_BARK_KEY'
```

Restart DSH to apply. Everything else is optional:

| Setting | Default | Description |
|---|---|---|
| `serverUrl` | `https://api.day.app` | Bark server URL; point it at your own domain for a self-hosted bark-server |
| `notifyOnFinish` | `true` | Notify when a task finishes |
| `notifyOnApproval` | `true` | Notify when your approval is needed |
| `notifyOnError` | `true` | Notify when a run errors out |
| `notifyOnAbort` | `false` | Notify when you abort a run |
| `includeSubagents` | `false` | Also notify for child agents |
| `settleMs` | `1500` | How long to wait after finishing before pushing (ms), so a task that immediately restarts does not notify twice; `0` pushes at once |
| `timeoutMs` | `10000` | Per-push timeout (ms) |
| `group` | `DeepSeek Harness` | Bark notification group, handy for filtering in the app |
| `sound` | *(empty)* | Bark ringtone name; empty uses the system default |
| `level` | `active` | Interruption level: `active` / `timeSensitive` / `passive` / `critical` |
| `icon` | *(empty)* | Notification icon URL |
| `url` | *(empty)* | Link opened when the notification is tapped |

## What the notifications look like

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

The last line is the task title plus the first 8 characters of the session id, so you can tell which session is calling you. (Notification bodies are composed in Chinese to match the host harness UI.)

## Troubleshooting

**No notifications at all?** Check in this order:

1. Is `deviceKey` filled in, and copied correctly? While it is empty the plugin never goes online.
2. Did you **restart DSH** after editing the config? It is read at startup.
3. Using a self-hosted bark-server? Then `serverUrl` must be changed too.
4. Is the Bark app allowed to notify on your iPhone, and not silenced by a Focus mode?
5. Is `level` set to `passive`? That neither lights the screen nor makes a sound — it only lands quietly in Notification Center.

**Too noisy — I only care about approvals?** Set `notifyOnFinish` and `notifyOnError` to `false`, or set `level: passive`.

**Several notifications for one task?** Child agents are silent by default, so `includeSubagents: true` is the usual cause; `settleMs` merges the "finished, then immediately restarted" case.

**I pressed Stop and got nothing?** That is intentional — an abort is not a completion. Set `notifyOnAbort: true` if you want it anyway.

**Does my key leak anywhere?** No. It stays in your local DSH configuration, and the plugin only POSTs it to the `serverUrl` you configured (the official `api.day.app` by default).

## Uninstalling

Remove it completely:

```
plugin_manager: { action: "remove_bundle", target: "@lijixu/bark-notify" }
```

Or just switch it off:

```
plugin_manager: { action: "set_bundle", target: "@lijixu/bark-notify", enabled: false }
```

Either way, restart DSH.

## For developers

Maintainer docs are currently Chinese-only:

- [DEVELOPMENT.md](https://github.com/xuliji/bark-notify/blob/main/DEVELOPMENT.md) — layout, running the tests, implementation notes
- [PUBLISHING.md](https://github.com/xuliji/bark-notify/blob/main/PUBLISHING.md) — packaging, publishing to npm, hosting on GitHub

## License

[MIT](./LICENSE)
