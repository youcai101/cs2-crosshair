/* =========================================================================
 * test/lab/read-vcfg.js — 读取本机 CS2 的实际 convar 存档（实验真源 A）
 *
 * 只读：不写游戏目录、不改任何设置、不动进程。
 * 用法:
 *   node test/lab/read-vcfg.js                 # 自动挑选最近写入的账号
 *   node test/lab/read-vcfg.js --account 886924967
 *   node test/lab/read-vcfg.js --list          # 只列账号与文件时间
 *   node test/lab/read-vcfg.js --out snapshot.json
 *
 * 输出：账号、文件路径与 mtime、cs2 进程与启动时间、客户端版本（steam.inf）、
 *       分辨率（cs2_video.txt）、全部 convar，以及准星相关子集。
 *
 * 注意：vcfg 由客户端写入，退出游戏时会落盘；本脚本会把 mtime 与 cs2 启动时间
 *       一起打印出来，便于判断快照是否来自当前这一局（mtime 晚于启动即当前会话写入）。
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const hasFlag = (n) => process.argv.indexOf("--" + n) > -1;

function findSteam() {
  const cands = [];
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-ItemProperty 'HKCU:\\\\Software\\\\Valve\\\\Steam' -ErrorAction SilentlyContinue).SteamPath"],
      { encoding: "utf8", windowsHide: true, timeout: 30000 }).trim();
    if (out) cands.push(out.replace(/\//g, "\\"));
  } catch (e) {}
  cands.push("D:\\\\software\\\\steam", "C:\\\\Program Files (x86)\\\\Steam");
  for (const c of cands) if (fs.existsSync(path.join(c, "userdata"))) return c;
  return null;
}

function listAccounts(steam) {
  const ud = path.join(steam, "userdata");
  if (!fs.existsSync(ud)) return [];
  const out = [];
  for (const acct of fs.readdirSync(ud)) {
    const f = path.join(ud, acct, "730", "local", "cfg", "cs2_user_convars_0_slot0.vcfg");
    if (fs.existsSync(f)) out.push({ account: acct, file: f, mtime: fs.statSync(f).mtime.toISOString(), size: fs.statSync(f).size });
  }
  return out.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

// vcfg 是文本 KeyValues：每行 "键" <tab> "值"
function parseConvars(text) {
  const convars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*"([^"]+)"\s+"([^"]*)"\s*$/);
    if (m) convars[m[1]] = m[2];
  }
  return convars;
}

function cs2Process() {
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-Process cs2 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty StartTime | ForEach-Object { $_.ToString('o') }"],
      { encoding: "utf8", windowsHide: true, timeout: 30000 }).trim();
    return out || null;
  } catch (e) { return null; }
}

function clientVersion(steam) {
  const lib = path.join(steam, "steamapps", "libraryfolders.vdf");
  const roots = [path.join(steam, "steamapps", "common")];
  try {
    const t = fs.readFileSync(lib, "utf8");
    for (const m of t.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(path.join(m[1].replace(/\\\\/g, "\\"), "steamapps", "common"));
  } catch (e) {}
  for (const r of roots) {
    const inf = path.join(r, "Counter-Strike Global Offensive", "game", "csgo", "steam.inf");
    if (fs.existsSync(inf)) {
      const kv = {};
      for (const line of fs.readFileSync(inf, "utf8").split(/\r?\n/)) {
        const i = line.indexOf("=");
        if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      return { ini: inf, ...kv };
    }
  }
  return null;
}

function resolution(entryFile) {
  const v = path.join(path.dirname(entryFile), "cs2_video.txt");
  if (!fs.existsSync(v)) return null;
  const kv = {};
  for (const line of fs.readFileSync(v, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*"([^"]+)"\s+"([^"]*)"\s*$/);
    if (m) kv[m[1]] = m[2];
  }
  return { file: v, width: Number(kv["setting.defaultres"]), height: Number(kv["setting.defaultresheight"]), fullscreen: kv["setting.fullscreen"] };
}

const CROSSHAIR_RE = /^(cl_crosshair|cl_ironsight|crosshair$)/i;
const GRENADE_RE = /^cl_grenadecrosshair/i;

function main() {
  const steam = findSteam();
  if (!steam) { console.error("找不到 Steam 目录"); process.exit(2); }
  const accounts = listAccounts(steam);
  if (hasFlag("list")) {
    console.log("Steam: " + steam);
    for (const a of accounts) console.log("  " + a.account + "  " + a.mtime + "  " + a.size + "B");
    return;
  }
  const want = arg("account", null);
  const pick = want ? accounts.find((a) => a.account === want) : accounts[0];
  if (!pick) { console.error("没有可用账号（--account " + want + "）"); process.exit(2); }

  const convars = parseConvars(fs.readFileSync(pick.file, "utf8"));
  const crosshair = {}, grenade = {};
  for (const k of Object.keys(convars).sort()) {
    if (CROSSHAIR_RE.test(k)) crosshair[k] = convars[k];
    if (GRENADE_RE.test(k)) grenade[k] = convars[k];
  }

  const snapshot = {
    readAt: new Date().toISOString(),
    steam,
    account: pick.account,
    vcfg: { file: pick.file, mtime: pick.mtime, size: pick.size },
    cs2ProcessStart: cs2Process(),
    client: clientVersion(steam),
    resolution: resolution(pick.file),
    convarCount: Object.keys(convars).length,
    crosshair,
    grenade,
    convars,
  };

  const out = arg("out", null);
  if (out) { fs.writeFileSync(out, JSON.stringify(snapshot, null, 1)); console.log("SAVED " + out); }

  console.log("Steam        : " + steam);
  console.log("账号          : " + pick.account);
  console.log("vcfg          : " + pick.file);
  console.log("vcfg mtime    : " + pick.mtime);
  if (snapshot.cs2ProcessStart) {
    const fresh = new Date(pick.mtime) > new Date(snapshot.cs2ProcessStart);
    console.log("cs2 进程启动   : " + snapshot.cs2ProcessStart);
    console.log("快照新鲜度     : " + (fresh ? "★ mtime 晚于本次启动 —— 由当前运行中的客户端写入" : "早于本次启动 —— 可能是上次退出的快照"));
  } else {
    console.log("cs2 进程      : 未运行（快照只可能是上次退出时写的）");
  }
  if (snapshot.client) console.log("客户端版本     : " + snapshot.client.PatchVersion + " (ClientVersion " + snapshot.client.ClientVersion + ", " + snapshot.client.VersionDate + ")");
  if (snapshot.resolution) console.log("分辨率        : " + snapshot.resolution.width + " x " + snapshot.resolution.height);
  console.log("convar 总数   : " + snapshot.convarCount + " · 准星相关 " + Object.keys(crosshair).length + " · 投掷物 " + Object.keys(grenade).length);
  console.log("");
  for (const k of Object.keys(crosshair)) console.log("  " + k.padEnd(44) + crosshair[k]);
  console.log("");
  for (const k of Object.keys(grenade)) console.log("  " + k.padEnd(44) + grenade[k]);
}

main();
