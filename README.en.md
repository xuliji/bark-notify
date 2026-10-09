# @lijixu/bark-notify

[![简体中文](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-Simplified%20Chinese-lightgrey?style=flat-square&labelColor=555555&logo=github&link=./README.md)](./README.md)
[![npm](https://img.shields.io/npm/v/@lijixu/bark-notify?style=flat-square&labelColor=0f172a)](https://www.npmjs.com/package/@lijixu/bark-notify)
[![CI](https://github.com/xuliji/bark-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/xuliji/bark-notify/actions/workflows/ci.yml)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-1677ff?style=flat-square&labelColor=0f172a)](https://github.com/DeepSeek-AI)

> Current language: **English** ｜ [简体中文](./README.md)

A DSH plugin that pushes notifications to your iPhone / Apple Watch via [Bark](https://bark.day.app) when an agent finishes a run, needs your approval, or errors out.

iOS mirrors Bark notifications to a paired Apple Watch automatically, so installing the Bark app on your iPhone is all you need.

## When you get notified

| Event | Trigger | Notification title |
|---|---|---|
| Agent run finished | `agent/status` goes from `running` to `idle`, this turn's `turn/end` reason is `completed`, and it is still idle after `settleMs` | `✅ 任务完成` |
| Approval needed | `approval/request` (a tool call is waiting for a human decision) | `🔔 需要授权` |
| Run errored | `agent/error` (a turn or a step failed) | `⚠️ 运行出错` |
| Run aborted | this turn's `turn/end` reason is `aborted`, and `notifyOnAbort: true` | `⏹️ 已中止` |

**An aborted run is never reported as a finished one.** Pressing Stop only records `turn/end { reason: { kind: 'aborted', reason: { kind: 'user' } } }` in the session log — `dsh-agent-loop` emits **no** `agent/error` for it, and `agent/status` still just goes `running` → `idle`. Status alone cannot tell "finished" from "stopped", so the plugin also reads this turn's `turn/end` reason from the `session/event` feed:

| This turn's `turn/end` reason | What the plugin does |
|---|---|
| `aborted` (manual stop / parent agent cancel / hook cancel / session closed) | Nothing by default; with `notifyOnAbort: true` it pushes `⏹️ 已中止` naming who cancelled it |
| `error` (the turn failed) | Pushes `⚠️ 运行出错` only — no extra `✅ 任务完成` |
| anything else (`completed`, `max-tokens`, …) | Pushes `✅ 任务完成` |
| no `turn/end` at all (a woken driver with no work) | Nothing |

The plugin is a pure observer: for approval events it always calls `next()` to hand control back to the normal approval UI, so it never claims or alters an authorization decision.

## Installation

Published on npm, so one line is enough (source directory and GitHub installs are covered under "Packaging and publishing"):

```
plugin_manager: { action: "install_bundle", target: "@lijixu/bark-notify" }
```

This appends the bundle to `dsh.profile.bundles` for the current profile and writes a `bark-notify` entry. The change applies to every session and survives restarts.

> **⚠️ You must restart DSH after editing the plugin code.**
> DSH caches loaded plugins per module generation: reinstalling the same bundle only re-applies the entry and its configuration, it does not replace the already-loaded JavaScript module (`plugin_manager` explicitly returns `restart-required`).

## Packaging and publishing

A DSH bundle is **just an ordinary npm package** whose `package.json` points `dsh.bundle.patch` at its patch file (see [`package.json`](./package.json)). The `id` / `name` / `config` in `cordis.patch.yml` become the profile entry written on install, and `plugin.js` is the module that actually loads (`main` / `exports`). This repository has **no dependencies, no transpile step, and no build**: "packaging" is just shipping those files, and the tarball `npm pack` produces is the distributable artifact (9 files, ~17 kB).

### Current state

| Item | Value |
|---|---|
| npm package | `@lijixu/bark-notify` |
| GitHub repository | <https://github.com/xuliji/bark-notify> |
| Visibility | Public (`publishConfig.access = "public"`; scoped packages default to private, which a free account cannot publish) |
| The name in three places | `name` in `package.json`, `name:` in `cordis.patch.yml`, and the examples in this document — they **must agree**, or the profile entry points at a package that does not exist |

> The GitHub account is `xuliji` and the npm account is `lijixu`; they are not the same, so do not mix them up in config.

### First release (manual)

```bash
cd /Users/lijixu/Documents/bark-notify
npm test                # 15 node:test cases
npm pack --dry-run      # confirm the contents: 9 files, test/ is not shipped
npm publish             # publishConfig already declares public; --access public is not needed
```

### Later releases

```bash
npm version patch       # or minor / major; this commits and tags for you
git push --follow-tags
npm publish
```

To upgrade on the DSH side, run `install_bundle` again (or update the bundle in the Plugin Manager) and restart DSH.

### Hosting on GitHub

To push the repository (create an empty `bark-notify` on GitHub first if it does not exist):

```bash
cd /Users/lijixu/Documents/bark-notify
git add -A
git commit -m "feat: publish as @lijixu/bark-notify, fix aborted runs reported as finished"
git branch -M main
git remote add origin https://github.com/xuliji/bark-notify.git   # use git remote set-url if origin exists
git push -u origin main
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm test` and `npm pack --dry-run` on every push and pull request (Node 20 and 22). **Automated publishing is deliberately not included**: releases stay in your terminal, so the first version never has to deal with npm's token / 2FA-bypass rules.

### Install sources (`install_bundle`'s `target`)

`dsh-plugin-manager` parses `target` as an install spec, so all of these work:

| Form | Example |
|---|---|
| npm package name | `@lijixu/bark-notify`, `@lijixu/bark-notify@1.0.1` |
| Absolute path / `file:` / `link:` | `/Users/lijixu/Documents/bark-notify` |
| GitHub shorthand / git URL | `github:xuliji/bark-notify`, `git+https://github.com/xuliji/bark-notify.git` |
| Repository URL | `https://github.com/xuliji/bark-notify` |
| Tarball, local or remote | `…/lijixu-bark-notify-1.0.0.tgz`, `https://…/x.tgz` |

(Relative paths are rejected: the Host's working directory has nothing to do with where you typed the spec.)

### Three traps

- **🔑 Never put your real Bark key into the repository's `cordis.patch.yml`.** That file ships inside the published npm package. Keep `deviceKey` as the empty placeholder in the repository and put the real key in the profile patch layer (`~/.dsh/profiles/desktop/cordis.patch.yml`), which is outside git, survives bundle upgrades, and takes precedence over the bundle layer.
- **Editing `plugin.js` requires a DSH restart.** DSH caches loaded plugins per module generation: reinstalling the same bundle only re-applies the entry and its configuration, it never replaces the already-loaded JavaScript module (`plugin_manager` returns `restart-required`). Bump `version` when you publish.
- **Never put `@deepseek-ai/dsh*` into `peerDependencies`.** DSH semver-checks those peers against its own runtime version and blocks the install on a mismatch until you grant a per-`name@version` exemption — which carries real risk. This plugin stays dependency-free so it installs on any dsh version.

## Configuration

The default configuration shipped with the bundle (`cordis.patch.yml`) leaves `deviceKey` as an empty placeholder — **you must fill in your Bark Key** for pushes to actually be sent.

The recommended approach is to add an override with the same id in the profile patch layer (`~/.dsh/profiles/desktop/cordis.patch.yml`). It takes precedence over the bundle layer and survives bundle upgrades:

```yaml
- id: bark-notify
  name: '@lijixu/bark-notify'
  config:
    deviceKey: 'YOUR_BARK_KEY'       # the xxxxx in https://api.day.app/xxxxx on the Bark app home screen
    # everything below is an optional override
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

| Field | Default | Description |
|---|---|---|
| `serverUrl` | `https://api.day.app` | Bark server URL; point it at your own domain if you self-host bark-server |
| `deviceKey` | *(empty)* | **Required.** Bark device key; when empty the plugin only logs and makes no network calls |
| `notifyOnFinish` | `true` | Notify when an agent run finishes |
| `notifyOnApproval` | `true` | Notify when an approval is requested |
| `notifyOnError` | `true` | Notify when a run errors out |
| `notifyOnAbort` | `false` | Notify when a run is aborted (including a manual stop); off keeps a cancelled run quiet, on pushes `⏹️ 已中止` instead |
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

```
⏹️ 已中止
运行已被手动中止
重构登录模块（7dbd389b）
```

The session title comes from the optional `sessionTitle` service; when that service is unavailable the plugin falls back to "session + short id".

Notification bodies are currently composed in Chinese, matching the Chinese UI of the host harness.

## Implementation notes (for maintainers)

- **"Finished" and "stopped" can only be told apart from the log.** `agent/status` has just `idle` and `running`; an abort looks identical to a completion there. The real cause is the `turn/end` `reason` (appended by `dsh-agent-loop` in `turn()`'s `finally`). The plugin listens on `session/event` — a post-commit feed whose callbacks run synchronously during the append, hence strictly before the following `idle` — records the reason per Session in a `WeakMap`, and **consumes it once** when `agent/status` settles to `idle`. A push therefore requires a `turn/end` in that very idle period, so a woken driver that found no work never reports a false completion.
- **Subagent detection must use `header.origin === 'subagent'`**, not `header.parentSession` alone: a user-initiated session fork writes `parentSession` too (`SessionController.fork()`, which writes neither `origin` nor `delegationDepth`). Treating `parentSession` as the marker would classify the user's own forked session as a subagent and, with the default configuration, silently stop notifying for it.
- **The approval listener MUST use `prepend`**: the first listener on the `approval/request` waterfall is a terminal answerer registered by the Host at boot, which returns the human's decision without calling `next()`. A listener queued at the tail therefore never runs — you must register with `ctx.on('approval/request', handler, { prepend: true })` to observe the request, then call `next()` to hand the decision back untouched.
- **Zero dependencies**: a bundle installed into a profile is symlinked to this directory and resolved by its real path, so packages that only exist inside the dsh installation (`@deepseek-ai/*`) do **not** resolve (verified: the import fails). This plugin therefore imports nothing and does its own defaulting and validation in `resolveSettings()`. As a consequence it does not project a configuration form in the Plugin Manager — write the YAML per the table above.
- **Bark HTTP API v2**: `POST {serverUrl}/push` with the JSON body `{ device_key, title, body, group?, sound?, level?, icon?, url? }`; a response of `code: 200` counts as success. Empty string fields are omitted from the request body.
- HTTP uses the in-process `fetch`; requests carry a timeout and are aborted when the plugin is disposed.
- All listeners are registered on the plugin context, so they are removed on unload; disposing an agent drops its debounce timer and state, and unloading clears them all and aborts in-flight requests.
- Subagents are not notified by default, to avoid a single task producing a burst of notifications.
- A failed push only logs a warning; it never affects the agent run or the approval flow.

## Layout

```
plugin.js             # plugin implementation (zero dependencies, ESM)
cordis.patch.yml      # default bundle configuration
locale/{en,zh}.json   # name and description shown in the Plugin Manager
icon.svg              # icon
test/plugin.test.js   # node:test cases (not published)
```

## License

[MIT](./LICENSE)

