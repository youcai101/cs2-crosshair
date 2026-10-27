/* =========================================================================
 * Showkey · CS2 准星工坊 — 本机配置读取（服务端模块）
 *
 * 职责：在**本机**找到 CS2 客户端保存的准星 convar，原样交给前端解析。
 *       本身不做任何换算 —— 一切语义解析仍归 js/core-convars.js:parse()，
 *       保证「游戏里读到的值」与「手输命令」走同一条代码路径，不会各算各的。
 *
 * 数据来源（实测 2026-10-19，CS2 1.41.9.1）：
 *   <steam>\userdata\<accountid>\730\local\cfg\cs2_user_convars_0_slot0.vcfg
 *   Valve KeyValues 文本，"convars" 段里制表符分隔的 "key" "value"。
 *   ⚠ 这个文件只写**非默认值**，缺失项必须由前端用默认模型补齐。
 *
 * 为什么要在服务端做：浏览器拿不到任意本地路径，file:// 也不允许 fetch。
 *   所以让 server.js 暴露一个只读路由，读出来的仍是**纯文本**，前端照常 importAny()。
 *
 * 安全边界：
 *   · 只读，不写任何游戏文件；
 *   · 只认 Steam 目录下的 `730/local/cfg/*.vcfg`，不接受任意路径；
 *   · 绑定 127.0.0.1，不对外网开放。
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

/* ---------------- 1. 找 Steam 安装位置 ---------------- */

// 注册表里的 SteamPath 最准，但读注册表要起子进程、且非 Windows 没有 —— 改为按常见路径嗅探。
const STEAM_HINTS = [
  "C:\\Program Files (x86)\\Steam",
  "C:\\Program Files\\Steam",
  "D:\\Steam",
  "D:\\software\\steam",
  "E:\\Steam",
  "E:\\software\\steam",
  "F:\\Steam",
  "F:\\software\\steam",
];

function isSteamDir(p) {
  try {
    return fs.statSync(path.join(p, "userdata")).isDirectory() &&
      fs.statSync(path.join(p, "steamapps")).isDirectory();
  } catch (e) { return false; }
}

/* 从 libraryfolders.vdf 里再挖出其它盘上的库（Steam 允许一个账号跨多个库） */
function steamLibraries(root) {
  const out = [root];
  try {
    const txt = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    const re = /"path"\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt))) {
      const p = m[1].replace(/\\\\/g, "\\");
      if (out.indexOf(p) === -1 && isSteamDir(p)) out.push(p);
    }
  } catch (e) { /* 没有 libraryfolders 就只用主目录 */ }
  return out;
}

function findSteamRoots() {
  const roots = [];
  const push = (p) => { if (p && roots.indexOf(p) === -1 && isSteamDir(p)) roots.push(p); };
  STEAM_HINTS.forEach(push);
  // 环境变量兜底（有些机器把 Steam 装在非默认盘）
  ["STEAM_PATH", "ProgramFiles(x86)", "ProgramFiles"].forEach((k) => {
    if (process.env[k]) push(path.join(process.env[k], "Steam"));
  });
  return roots;
}

/* ---------------- 2. 找账号（取最近登录的那个） ---------------- */

function accountDirs(steamRoot) {
  const out = [];
  for (const lib of steamLibraries(steamRoot)) {
    const ud = path.join(lib, "userdata");
    let names = [];
    try { names = fs.readdirSync(ud); } catch (e) { continue; }
    for (const n of names) {
      if (!/^\d+$/.test(n)) continue;
      const cfgDir = path.join(ud, n, "730", "local", "cfg");
      if (!fs.existsSync(cfgDir)) continue;
      out.push({ accountId: n, steamRoot: lib, cfgDir });
    }
  }
  return out;
}

/* 准星状态存在 user_convars 里；按修改时间挑「最近玩过的账号」 */
function latestCrosshairVcfg(cfgDir) {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(cfgDir); } catch (e) { return null; }
  for (const n of names) {
    if (!/^cs2_user_convars_\d+_slot\d+\.vcfg$/i.test(n)) continue;
    const abs = path.join(cfgDir, n);
    let st;
    try { st = fs.statSync(abs); } catch (e) { continue; }
    if (!best || st.mtimeMs > best.mtimeMs) best = { abs, name: n, mtimeMs: st.mtimeMs, size: st.size };
  }
  return best;
}

/* 只保留与准星有关的行，减少传给前端的体积（vcfg 里大部分是买菜单、雷达等无关项）。
 * 注意：这里**刻意保留 legacy 名**（cl_crosshairsize 等），交给前端 parse() 去判定
 * 「新系统文本里的旧残留」，不要在服务端提前过滤掉。 */
const KEEP_RE = /^(cl_crosshair|cl_ironsight|crosshair$)/i;

function extractConvars(text) {
  const lines = String(text).split(/\r?\n/);
  const kept = [];
  const all = [];
  const re = /^\s*"([^"]+)"\s+"([^"]*)"\s*$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    all.push({ k: m[1], v: m[2] });
    if (KEEP_RE.test(m[1])) kept.push(m[1] + " " + m[2]);
  }
  return { kept, total: all.length };
}

/* ---------------- 3. 对外接口 ---------------- */

function scan(opts) {
  opts = opts || {};
  const steamRoots = opts.steamRoot ? [opts.steamRoot] : findSteamRoots();
  if (!steamRoots.length) {
    return { ok: false, reason: "no-steam", message: "没找到 Steam 安装目录" };
  }

  const accounts = [];
  for (const root of steamRoots) accounts.push(...accountDirs(root));
  if (!accounts.length) {
    return { ok: false, reason: "no-account", message: "Steam 目录里没有找到 CS2 账号（userdata/<id>/730）", steamRoots };
  }

  // 每个账号取它最新的一份 crosshair vcfg，再按时间排出「当前账号」
  const found = [];
  for (const a of accounts) {
    const v = latestCrosshairVcfg(a.cfgDir);
    if (v) found.push(Object.assign({}, a, { vcfg: v }));
  }
  if (!found.length) {
    return { ok: false, reason: "no-vcfg", message: "账号目录下没有准星配置文件（可能从未进过游戏）", accounts: accounts.map((a) => a.accountId) };
  }
  found.sort((x, y) => y.vcfg.mtimeMs - x.vcfg.mtimeMs);
  const pick = opts.accountId ? (found.find((f) => f.accountId === String(opts.accountId)) || found[0]) : found[0];

  let raw;
  try { raw = fs.readFileSync(pick.vcfg.abs, "utf8"); } catch (e) {
    return { ok: false, reason: "read-failed", message: "读不到配置文件：" + e.message };
  }
  const { kept, total } = extractConvars(raw);
  if (!kept.length) {
    return { ok: false, reason: "no-crosshair", message: "配置文件里没有准星 convar", file: pick.vcfg.abs };
  }

  return {
    ok: true,
    accountId: pick.accountId,
    steamRoot: pick.steamRoot,
    file: pick.vcfg.abs,
    fileName: pick.vcfg.name,
    mtime: new Date(pick.vcfg.mtimeMs).toISOString(),
    size: pick.vcfg.size,
    convarCount: total,
    crosshairCount: kept.length,
    // 纯文本：一行一条 `cl_xxx value`，前端直接喂给 CS.parseConVars()
    text: kept.join("\n"),
    // 同时列出其它账号，供前端做「切换到另一个账号」
    accounts: found.map((f) => ({
      accountId: f.accountId,
      file: f.vcfg.name,
      mtime: new Date(f.vcfg.mtimeMs).toISOString(),
      size: f.vcfg.size,
    })),
  };
}

module.exports = { scan, findSteamRoots, accountDirs, latestCrosshairVcfg, extractConvars };
