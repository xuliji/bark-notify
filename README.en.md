# @local/bark-notify

[![简体中文](https://img.shields.io/badge/%F0%9F%87%E8%F0%9F%87%A9%F0%9F%87%AF-Simplified%20Chinese-lightgrey?style=flat-square&labelColor=555555&logo=github&link=./README.md)](./README.md)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-1677ff?style=flat-square&labelColor=0f172a)](https://github.com/DeepSeek-AI)

> Current language: **English** ｜ [简体中文](./README.md)

A DSH plugin that pushes notifications to your iPhone / Apple Watch via [Bark](https://bark.day.app) when an agent finishes a run, needs your approval, or errors out.

iOS mirrors Bark notifications to a paired Apple Watch automatically, so installing the Bark app on your iPhone is all you need.

## When you get notified

| Event | Trigger | Notification title |
|---|---|---|
| Agent run finished | `agent/status` goes from `running` to `idle`, and is still idle after `settleMs` | `✅ 任务完成` |
| Approval needed | `approval/request` (a tool call is waiting for a human decision) | `🔔 需要授权` |
| Run errored | `agent/error` (a turn or a step failed) | `⚠️ 运行出错` |

The plugin is a pure observer: for approval events it always calls `next()` to hand control back to the normal approval UI, so it never claims or alters an authorization decision.

## Installation

```
plugin_manager: { action: "install_bundle", target: "<absolute path to this directory>" }
```

This appends the bundle to `dsh.profile.bundles` for the current profile and writes a `bark-notify` entry. The change applies to every session and survives restarts.

> **⚠️ You must restart DSH after editing the plugin code.**
> DSH caches loaded plugins per module generation: reinstalling the same bundle only re-applies the entry and its configuration, it does not replace the already-loaded JavaScript module (`plugin_manager` explicitly returns `restart-required`).

## Configuration

The default configuration shipped with the bundle (`cordis.patch.yml`) leaves `deviceKey` as an empty placeholder — **you must fill in your Bark Key** for pushes to actually be sent.

The recommended approach is to add an override with the same id in the profile patch layer (`~/.dsh/profiles/desktop/cordis.patch.yml`). It takes precedence over the bundle layer and survives bundle upgrades:

```yaml
- id: bark-notify
  name: '@local/bark-notify'
  config:
    deviceKey: 'YOUR_BARK_KEY'       # the xxxxx in https://api.day.app/xxxxx on the Bark app home screen
    # everything below is an optional override
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

| Field | Default | Description |
|---|---|---|
| `serverUrl` | `https://api.day.app` | Bark server URL; point it at your own domain if you self-host bark-server |
| `deviceKey` | *(empty)* | **Required.** Bark device key; when empty the plugin only logs and makes no network calls |
| `notifyOnFinish` | `true` | Notify when an agent run finishes |
| `notifyOnApproval` | `true` | Notify when an approval is requested |
| `notifyOnError` | `true` | Notify when a run errors out |
| `includeSubagents` | `false` | Also notify for child (subagent) agents |
| `settleMs` | `1500` | How long to wait after going idle before pushing, to skip the "finished then immediately restarted" flicker; set `0` to push immediately |
| `timeoutMs` | `10000` | Per-request push timeout |
| `group` | `DeepSeek Harness` | Bark notification group |
| `sound` | *(empty)* | Bark ringtone name; empty means the system default |
| `level` | `active` | Interruption level: `active` / `timeSensitive` / `passive` / `critical` |
| `icon` | *(empty)* | Notification icon URL |
| `url` | *(empty)* | URL opened when the notification is tapped |

> Settings are **read on every push**: edit the YAML and restart DSH. The plugin does not validate key names — unknown keys are ignored, and fields of the wrong type fall back to their default.

## Example payloads

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

The session title comes from the optional `sessionTitle` service; when that service is unavailable the plugin falls back to "session + short id".

Notification bodies are currently composed in Chinese, matching the Chinese UI of the host harness.

## Implementation notes (for maintainers)

- **The approval listener MUST use `prepend`**: the first listener on the `approval/request` waterfall is a terminal answerer registered by the Host at boot, which returns the human's decision without calling `next()`. A listener queued at the tail therefore never runs — you must register with `ctx.on('approval/request', handler, { prepend: true })` to observe the request, then call `next()` to hand the decision back untouched.
- **Zero dependencies**: a bundle installed into a profile is symlinked to this directory and resolved by its real path, so packages that only exist inside the dsh installation (`@deepseek-ai/*`) do **not** resolve (verified: the import fails). This plugin therefore imports nothing and does its own defaulting and validation in `resolveSettings()`. As a consequence it does not project a configuration form in the Plugin Manager — write the YAML per the table above.
- **Bark HTTP API v2**: `POST {serverUrl}/push` with the JSON body `{ device_key, title, body, group?, sound?, level?, icon?, url? }`; a response of `code: 200` counts as success. Empty string fields are omitted from the request body.
- HTTP uses the in-process `fetch`; requests carry a timeout and are aborted when the plugin is disposed.
- All listeners are registered on the plugin context, so they are removed on unload; the idle-debounce timer and in-flight requests are cleaned up alongside them.
- Subagents are not notified by default, to avoid a single task producing a burst of notifications.
- A failed push only logs a warning; it never affects the agent run or the approval flow.

## Layout

```
plugin.js            # plugin implementation (zero dependencies, ESM)
cordis.patch.yml     # default bundle configuration
locale/{en,zh}.json  # name and description shown in the Plugin Manager
icon.svg             # icon
```

