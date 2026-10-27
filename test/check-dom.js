/* 静态检查（新 UI 适配层）：
 *   1) app.js 引用的 DOM id 是否都存在于 index.html
 *   2) querySelector 用到的选择器锚点是否存在
 *   3) app.js 是否还残留「旧刻度换算链」与旧字段名
 *   4) index.html 是否按正确顺序、正确版本号引入 9 个核心脚本 + players + app
 *   5) 管理入口已彻底移除：index.html 不得再有 adminLink，app.js 不得再探测 /api
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let fail = 0;

/* ---------- 1. id 对齐 ---------- */
const ids = new Set();
for (const m of app.matchAll(/\$\("([\w-]+)"\)/g)) ids.add(m[1]);
for (const m of app.matchAll(/getElementById\("([\w-]+)"\)/g)) ids.add(m[1]);
const domIds = new Set();
for (const m of html.matchAll(/id="([\w-]+)"/g)) domIds.add(m[1]);

const missing = [...ids].filter((i) => !domIds.has(i));
console.log("app.js 引用 id:", ids.size, "| HTML id:", domIds.size);
if (missing.length) {
  console.log("缺失:", missing);
  fail++;
} else {
  console.log("id 对齐 ✓");
}

/* ---------- 2. querySelector 选择器锚点 ---------- */
const selectors = [
  "#viewTabs .tab",       // 顶部页签
  "#styleSel",            // 10 项样式下拉
  "#outlineSeg",          // 描边三态分段按钮
  "#mapDots button",      // 地图圆点
  "#pasteExtra",          // 多段命令复制按钮
  "#legacyNotice",        // 旧码提示条（预览区）
  "#legacyNoticeShare",   // 旧码提示条（分享区）
  "#teamList",            // 战队列表
  "#proGrid",             // 选手网格
  "#proRole",             // 位置筛选
  "#proSort",             // 排序
  "#mActions",            // 详情页导出动作组（新旧规则）
  "#importInput",         // 统一导入框
  "#modalTabs button",    // 弹窗页签
  "#playerModal",         // 弹窗根节点
];
let selBad = [];
for (const sel of selectors) {
  const anchor = sel.split(" ")[0].replace("#", "");
  if (sel.startsWith("#") && !domIds.has(anchor)) selBad.push(sel);
}
if (selBad.length) { console.log("选择器锚点缺失:", selBad); fail++; }
else console.log("选择器锚点 ✓（" + selectors.length + " 个）");

/* ---------- 3. 旧换算链 / 旧字段 / 管理入口必须彻底消失 ---------- */
const forbidden = [
  "oldGapToNew", "newGapToOld", "oldLenToNew", "newLenToOld", "oldThkToNew", "newThkToOld",
  "alphaEnabled", "outlineEnabled", "colorPalette", "styleSeg", "sOutlineEnabled", "sUseAlpha",
  "adminLink", "detectAdmin",
];
const leftover = forbidden.filter((k) => app.indexOf(k) !== -1);
if (leftover.length) { console.log("app.js 仍残留旧 API/字段/管理入口:", leftover); fail++; }
else console.log("旧换算链、旧字段与管理入口已清除 ✓");

/* ---------- 3.2 零网络调用：站点是纯静态前端 ----------
 * 「读取本机准星」功能已下线（页面不再需要 server.js 的接口），
 * 所以约束回到最严格的一版：app.js 一次 fetch 都不许有，也不许出现任何 /api/ 路径
 * 与其它网络 API（XMLHttpRequest / WebSocket / EventSource / sendBeacon）。 */
const netCalls = [];
const fetchCount = (app.match(/\bfetch\s*\(/g) || []).length;
if (fetchCount > 0) netCalls.push(fetchCount + " 处 fetch");
if (/XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(app)) netCalls.push("其它网络 API");
const otherApi = app.match(/\/api\//);
if (otherApi) netCalls.push("/api/ 路径");
if (netCalls.length) { console.log("app.js 仍出现网络调用:", netCalls); fail++; }
else console.log("零网络调用 ✓（0 处 fetch，无 /api/）");

/* ---------- 3.5 index.html 不得再出现 adminLink ---------- */
const htmlAdmin = [];
if (html.indexOf("adminLink") !== -1) htmlAdmin.push("adminLink");
if (/\/admin\b/.test(html)) htmlAdmin.push("/admin");
if (/\/api\//.test(html)) htmlAdmin.push("/api/");
if (htmlAdmin.length) { console.log("index.html 仍残留管理入口:", htmlAdmin); fail++; }
else console.log("index.html 无 adminLink / /admin / /api ✓");

/* ---------- 4. index.html 脚本顺序与版本号 ---------- */
const wantOrder = [
  "js/core-alphabet.js", "js/core-layouts.js", "js/core-codec.js", "js/core-legacy.js",
  "js/core-convert.js", "js/core-convars.js", "js/render-model.js", "js/render-canvas.js",
  "js/codec.js", "js/players.js", "js/hltv-teams.js", "js/app.js",
];
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const gotOrder = srcs.map((s) => s.split("?")[0]);
const gotVer = srcs.map((s) => (s.split("?")[1] || ""));
if (JSON.stringify(gotOrder) !== JSON.stringify(wantOrder)) {
  console.log("脚本顺序不对:\n  期望 " + wantOrder.join(" → ") + "\n  实际 " + gotOrder.join(" → "));
  fail++;
} else console.log("脚本顺序 ✓（" + gotOrder.length + " 个）");

// 版本查询串：全部脚本与 css 必须同版本（缓存击穿），不硬编码具体值
// （具体值会被每次数据更新 bump，硬编码必然过期；语义是「一致」）
const vers = new Set(gotVer.map((v) => v.replace(/^v=/, "")));
const cssVer = (html.match(/href="(css\/style\.css\?v=\d+)"/) || [])[1] || "";
const cssV = cssVer.split("?v=")[1] || "";
if (vers.size !== 1 || !cssV || cssV !== [...vers][0]) {
  console.log("版本查询串不一致:", [...vers], "| css:", cssVer);
  fail++;
} else console.log("版本查询串一致 ✓（v=" + [...vers][0] + "，含 css）");

console.log("\n" + (fail ? "✗ " + fail + " 项未通过" : "✓ 全部通过"));
process.exit(fail ? 1 : 0);
