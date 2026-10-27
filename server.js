/* =========================================================================
 * Showkey · CS2 准星工坊 — 极简静态文件服务器
 *
 * 纯静态站点：把项目目录发出去（index.html / css / js / assets），没有任何后端接口。
 * 页面自身不发网络请求（见 test/check-dom.js 的零 fetch 约束）。
 * 数据更新仍是**离线 CLI**：node tools/auto-update.js（见 README 第三节）
 *
 * 用法:
 *   node server.js                启动（默认端口 3800）
 *   node server.js --port 4000    自定义端口
 *   PORT=4000 node server.js      同上（环境变量）
 *   node server.js --host 0.0.0.0 允许局域网访问
 * ========================================================================= */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const PORT =
  Number(process.argv.indexOf("--port") > -1 ? process.argv[process.argv.indexOf("--port") + 1] : 0) ||
  Number(process.env.PORT) || 3800;

const HOST =
  (process.argv.indexOf("--host") > -1 ? process.argv[process.argv.indexOf("--host") + 1] : "") ||
  process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".cfg": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// 启动横幅用的数据摘要（只读 js/players.js，失败不影响服务）
function readMeta() {
  try {
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "players.js"), "utf8"), ctx);
    return {
      meta: ctx.window.PRO_META || {},
      players: (ctx.window.PRO_PLAYERS || []).length,
      teams: (ctx.window.PRO_TEAMS || []).length,
    };
  } catch (e) {
    return { meta: {}, players: 0, teams: 0 };
  }
}

const server = http.createServer((req, res) => {
  const raw = req.url || "/";
  const qIdx = raw.indexOf("?");
  let urlPath = decodeURIComponent(qIdx > -1 ? raw.slice(0, qIdx) : raw);

  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  const m = readMeta();
  const shown = HOST === "127.0.0.1" ? "127.0.0.1" : HOST;
  console.log("CS2 准星工坊 server running at http://" + shown + ":" + PORT);
  console.log("  数据: " + m.teams + " 队 · " + m.players + " 人 · 更新于 " + (m.meta.updated || "未知"));
  console.log("  更新数据: node tools/auto-update.js （离线 CLI，见 README）");
});
