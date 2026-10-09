# 打包与发布

面向维护者。用户怎么装怎么配看 [README.md](./README.md)，实现细节看 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 一个 bundle 就是一个 npm 包

只要 `package.json` 里有 `dsh.bundle.patch` 指向它的 patch 文件即可：

```json
{
  "name": "@lijixu/bark-notify",
  "main": "plugin.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` 里的 `id` / `name` / `config` 就是安装后写进 profile 的那一行，`plugin.js` 是真正被加载的入口（`main` / `exports`）。本仓库**零依赖、零转译、无构建步骤**，所以「打包」= 把文件放进包里，`npm pack` 出来的 tarball 就是可分发的成品。

## 当前状态

| 项 | 值 |
|---|---|
| npm 包名 | `@lijixu/bark-notify` |
| GitHub 仓库 | <https://github.com/xuliji/bark-notify> |
| 发布可见性 | 公开（`publishConfig.access = "public"`；scoped 包默认是私有的，免费账号发不了） |
| 包内容 | 9 个文件、约 13 kB（见 `files` 字段；`test/`、本文件与 DEVELOPMENT.md 都不会进包） |

> GitHub 账号是 `xuliji`、npm 账号是 `lijixu`，两者不同，改配置时别混。

**三处名字必须一致**：`package.json` 的 `name`、`cordis.patch.yml` 的 `name:`、README 的示例。不一致的话，profile 里那一行会指向不存在的包。

## 前置：账号必须开 2FA

npm 现在对**发布**强制二步验证，没开的话 `npm publish` 会直接 403：

```
403 Forbidden - PUT https://registry.npmjs.org/@lijixu%2fbark-notify
Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

注意 `npm publish --dry-run` **不会**暴露这个问题——它不发那个 PUT，只校验包内容，所以能过并不代表能发。

- 先看状态：`npm profile get`，找 `two-factor auth` 一行。
- `disabled` 就去开启，`auth-only` 要升级成 `auth-and-writes`。
- 位置：<https://www.npmjs.com/settings/lijixu/profile> → Two-Factor Authentication → 选 **Authorization and Publishing**（不是 Authorization only），用认证器 App 或安全钥匙，并把 recovery codes 存好。
- 之后发布时按提示输入 OTP，或直接 `npm publish --otp=123456`。

替代方案是建一个允许 **bypass 2FA** 的 Granular Access Token（Access Tokens → Generate New Token → Granular，权限 Read and write，Packages 选中 `@lijixu`）。注意 npm 正在收紧这条路（见 <https://gh.io/npm-gat-bypass2fa-deprecation>），只建议留给 CI。

## 首次发布

```bash
cd /Users/lijixu/Documents/bark-notify
npm test                # 15 条用例
npm pack --dry-run      # 确认包内容
npm publish             # publishConfig 已声明 public，不需要再加 --access public
```

## 后续发版

```bash
npm version patch       # 或 minor / major；会顺带提交并打 git tag
git push --follow-tags
npm publish
```

DSH 侧升级：再跑一次 `install_bundle`（或在 Plugin Manager 里更新该 bundle），然后重启 DSH。

## GitHub 托管

```bash
cd /Users/lijixu/Documents/bark-notify
git add -A
git commit -m "docs: 重写 README 为面向用户版"
git branch -M main
git remote set-url origin https://github.com/xuliji/bark-notify.git
git push -u origin main
```

CI 见 [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)。

## 安装来源（`install_bundle` 的 `target`）

`target` 会先被 `dsh-plugin-manager` 解析成 install spec：

| 形式 | 例子 |
|---|---|
| npm 包名 | `@lijixu/bark-notify`、`@lijixu/bark-notify@1.0.1` |
| 绝对路径 / `file:` / `link:` | `/Users/lijixu/Documents/bark-notify` |
| GitHub 简写 / git URL | `github:xuliji/bark-notify`、`git+https://github.com/xuliji/bark-notify.git` |
| 仓库 URL | `https://github.com/xuliji/bark-notify` |
| tarball（本地或远程） | `…/lijixu-bark-notify-1.0.0.tgz`、`https://…/x.tgz` |

（相对路径会被拒绝：Host 的工作目录和你在浏览器里输入的位置没有关系。）

## 三个坑

- **🔑 真实 Bark Key 绝不能进仓库。** `cordis.patch.yml` 会随 npm 包公开分发，所以仓库里 `deviceKey` 保持空占位符，真 Key 写在 profile 的 patch 层（`~/.dsh/profiles/desktop/cordis.patch.yml`，不在 git 里、升级 bundle 也不会丢，且优先级高于 bundle 层）。文末提到 Key 时也只写占位符。
- **改了 `plugin.js` 必须重启 DSH。** DSH 按「模块代」缓存已加载的插件，重装同一个 bundle 不会替换已加载的模块（`plugin_manager` 返回 `restart-required`）。
- **不要把 `@deepseek-ai/dsh*` 写进 `peerDependencies`。** DSH 会拿这些 peer 对运行时版本做 semver 校验，不匹配就拦下安装并要求对 `包名@版本` 逐条授予版本豁免，豁免本身带风险。本插件保持零依赖，正是为了在任何 dsh 版本上都能直接安装。

## 发布前自检清单

- [ ] `npm test` 全绿
- [ ] `npm pack --dry-run` 文件清单正确（9 个，无 `test/`）
- [ ] 三处包名一致
- [ ] `cordis.patch.yml` 里 `deviceKey` 仍是空占位符
- [ ] `version` 已 bump（DSH 侧靠版本号识别升级）
