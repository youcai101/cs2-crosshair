# 部署与每日自动更新

## 线上地址

- 主站：<https://youcai101.github.io/cs2-crosshair/>
- 仓库：<https://github.com/youcai101/cs2-crosshair>

## 它是怎么发布的

这个站点是**纯静态**页面（没有任何后端、没有任何 fetch 请求），所以托管只要“把文件放到能访问的地方”。

- GitHub Pages 的发布方式：**legacy build，源头 = `main` 分支根目录**。
- 也就是说，`main` 根目录下的 `index.html` / `css/` / `js/` / `assets/` 就是线上文件，push 后大约 30–60 秒自动上线。
- 根目录的 `.nojekyll` 用来关掉 Jekyll 处理，避免以 `_` 开头的资源被忽略。
- `cs2-crosshair/` 是 `node tools/build-dist.js` 生成的**本地打包副本**（可以整体上传到任意静态托管），已经写进 `.gitignore`，不需要推送。

### 日常改完代码怎么上线

```bash
git add -A
git commit -m "feat: 你的改动"
git push
```

推送完成后打开仓库的 **Actions → pages build and deployment** 看构建，或者直接刷新线上地址。

> 提示：改了 `css/style.css`、`js/*.js`、`index.html` 之后记得把 `index.html` 里的 `?v=` 版本号改掉（`node tools/auto-update.js` 会自动 bump；纯手工改前端时手动改一下），否则浏览器可能继续用缓存。

## 每日自动更新数据

工作流：`.github/workflows/daily-update.yml`

- 触发：每天 **UTC 19:23（北京 03:23）**，以及手动 `workflow_dispatch`。
- 步骤：`node tools/auto-update.js --no-dist` → 有改动就由 `showkey-bot` 身份提交 `chore(data): 每日准星数据更新 YYYY-MM-DD` → Pages 自动重新构建。
- 更新内容：选手名单、准星码 / 分享码、准星参数、eDPI、历史记录、选手归属战队（以 `js/hltv-teams.js` 的现役阵容为准）。
- 每次运行大约 3 分钟，只依赖 Node 自带模块，不需要 `npm install`。

手动触发（任选其一）：

```bash
# GitHub 网页：仓库 → Actions → “每日更新选手准星数据” → Run workflow
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/youcai101/cs2-crosshair/actions/workflows/daily-update.yml/dispatches \
  -d '{"ref":"main"}'
```

### 不在 CI 里跑的部分：HLTV 阵容与排名

`hltv.org` 全站由 Cloudflare 挑战保护，服务器上直接请求一律 403；抓取必须靠**有头浏览器**（`tools/hltv-sync.js` 通过 CDP 驱动本机 Edge/Chrome）。所以在自己的电脑上手动刷新：

```bash
# 1) 起一个有头浏览器（不能 headless）
msedge.exe --remote-debugging-port=9223 --user-data-dir=.tmp-edge \
  --no-first-run --no-default-browser-check about:blank

# 2) 抓 30 支跟踪战队的阵容、队标、世界/欧洲/Valve 排名
node tools/hltv-sync.js

# 3) 提交
git add js/hltv-teams.js assets/hltv
git commit -m "chore(hltv): 阵容与排名快照"
git push
```

## 失败保护

`tools/auto-update.js` 里有 `rosterGuard`：抓到的选手数少于 20 人、或不足上一次的 50% 时**直接中止**，不会把线上数据冲成空的。数据源异常时 Actions 会失败，页面保持上一次的内容。

## 本地预览

```bash
node server.js          # http://127.0.0.1:3800
# 或者双击 一键启动.bat
# 或者直接双击 index.html（纯静态，file:// 也能跑）
```
