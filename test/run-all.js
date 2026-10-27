/* =========================================================================
 * run-all.js — 一次跑完全部测试套件
 * 用法: node test/run-all.js
 * 退出码 = 失败的套件数（0 = 全绿）
 * ========================================================================= */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

const SUITES = [
  ["vectors-check.js", "Phase 0 · 离线对拍向量可用性"],
  ["check-codec.js",   "Phase 1 · 四布局编解码与 oracle 对拍"],
  ["check-scraper.js", "Phase 2 · prosettings 抓取管线（真实页面 fixture）"],
  ["check-paste.js",   "Phase 4 · convar 输出/解析与 512 限制"],
  ["verify.js",        "Phase 3 · 渲染器与迁移保真"],
  ["check-render-invariance.js", "Phase 3 · 分辨率/比例/DPR 无关性"],
  ["check-dom.js",     "Phase 5 · app.js/DOM id 对齐"],
  ["check-page.js",    "Phase 5 · jsdom 整页回归"],
];

const only = process.argv.slice(2);
let failed = [];
for (const [file, label] of SUITES) {
  if (only.length && !only.some((o) => file.indexOf(o) !== -1)) continue;
  const full = path.join(__dirname, file);
  console.log("\n══════════ " + label + "  (" + file + ") ══════════");
  const r = spawnSync(process.execPath, [full], { stdio: "inherit", cwd: path.join(__dirname, "..") });
  if (r.status !== 0) failed.push(file + "(exit " + r.status + ")");
}
console.log("\n════════════════════════════════════════");
if (failed.length) {
  console.log("✗ 失败套件: " + failed.join(", "));
  process.exit(failed.length);
}
console.log("✓ 全部 " + SUITES.length + " 个套件通过");
