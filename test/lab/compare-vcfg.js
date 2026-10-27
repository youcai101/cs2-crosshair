/* =========================================================================
 * test/lab/compare-vcfg.js — 实机 convar 与生成器的逐项比对
 *
 * 用法:
 *   node test/lab/compare-vcfg.js [snapshot.json] [--code CS....]
 *   node test/lab/compare-vcfg.js test/lab/vcfg-snapshot-20261015.json
 *
 * 做三件事：
 *   ① 存在性：游戏配置里有、但生成器从不输出的 convar（覆盖缺口）
 *   ② 数值：生成器默认基线 vs 实机值
 *   ③ 往返：把实机 convar 灌进生成器解析器 → 再导出命令，看能否 1:1 还原
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const CS = require(path.join(__dirname, "..", "..", "js", "codec.js"));

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json")) || path.join(__dirname, "vcfg-snapshot-20261015.json");
const codeIdx = args.indexOf("--code");
const snap = JSON.parse(fs.readFileSync(file, "utf8"));

function norm(v) {
  const s = String(v).toLowerCase();
  if (s === "true") return "1";
  if (s === "false") return "0";
  return s;
}
function num(v) { const n = Number(v); return isFinite(n) ? n : null; }

const game = snap.crosshair;
const gameText = Object.keys(game).map((k) => k + " " + game[k]).join("\n");
const info = CS.parseConVarsInfo(gameText);
const imported = info.model;

const baseline = codeIdx > -1 ? CS.decodeShareCode(args[codeIdx + 1]) : CS.defaultSettings();
const baselineRows = CS.settingsToCommands(baseline).map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; });
const baselineMap = {};
for (const r of baselineRows) baselineMap[r[0]] = r[1];
const reRows = CS.settingsToCommands(imported).map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; });
const reMap = {};
for (const r of reRows) reMap[r[0]] = r[1];

console.log("快照      : " + snap.vcfg.file);
console.log("账号      : " + snap.account + " · vcfg mtime " + snap.vcfg.mtime);
console.log("客户端    : " + (snap.client ? snap.client.PatchVersion : "?") + (snap.client ? " (ClientVersion " + snap.client.ClientVersion + ")" : ""));
console.log("分辨率    : " + (snap.resolution ? snap.resolution.width + " x " + snap.resolution.height : "?"));
console.log("解析遗留  : " + (info.leftover.length ? info.leftover.length + " 条旧 convar 已忽略 -> " + info.leftover.join(", ") : "无"));
console.log("");

/* ---------- ① 存在性 ---------- */
// 生成器「可能输出」的全集：遍历 10 样式 × 3 描边态取并集，
// 这样「条件性输出」不会被误判成「没有覆盖」。
const FULL_SET = {};
const trulyAll = {};
for (let s = 0; s <= 9; s++) {
  for (const om of [0, 1, 2]) {
    const m = CS.normalizeModel({ style: s, outlineMode: om });
    for (const row of CS.settingsToCommands(m)) {
      const name = row.slice(0, row.indexOf(" "));
      FULL_SET[name] = (FULL_SET[name] || 0) + 1;
      if (om === 0) trulyAll[name] = 1;
    }
  }
}
const CONDITIONAL = {
  "cl_crosshairoutline_r": "仅开启描边时输出",
  "cl_crosshairoutline_g": "仅开启描边时输出",
  "cl_crosshairoutline_b": "仅开启描边时输出",
  "cl_crosshairoutline_a": "仅开启描边时输出",
  "cl_crosshair_dynamic_spread_limit": "仅动态样式输出",
  "cl_crosshair_recoil": "仅动态样式输出",
  "cl_crosshair_dynamic_splitdist": "仅样式 2 输出",
  "cl_crosshair_dynamic_splitalpha_innermod": "仅样式 2 输出",
  "cl_crosshair_dynamic_splitalpha_outermod": "仅样式 2 输出",
  "cl_crosshair_dynamic_maxdist_splitratio": "仅样式 2 输出",
};
const knownIgnore = ["cl_crosshairsize", "cl_crosshairthickness", "cl_crosshairalpha"];
const gameOnly = Object.keys(game).filter((k) => FULL_SET[k] === undefined);
console.log("【① 存在性】游戏配置里出现、但生成器在任何样式/描边态下都不会输出的 convar");
console.log("  预期忽略（旧 convar 存档残留，策略上本就不输出）: " + (gameOnly.filter((k) => knownIgnore.indexOf(k) !== -1).join(", ") || "无"));
const realGap = gameOnly.filter((k) => knownIgnore.indexOf(k) === -1);
console.log("  真实缺口（游戏有、生成器完全没覆盖）:");
if (!realGap.length) console.log("    无");
else for (const k of realGap) console.log("    " + k.padEnd(40) + "实机值 " + game[k]);
const condOmitted = Object.keys(game).filter((k) => FULL_SET[k] !== undefined && baselineMap[k] === undefined);
console.log("  条件性省略（生成器支持，但当前样式/描边态下不该输出 —— 非缺口）:");
if (!condOmitted.length) console.log("    无");
else for (const k of condOmitted) console.log("    " + k.padEnd(40) + (CONDITIONAL[k] || "按当前状态省略"));
console.log("");
console.log("【①b】生成器输出、但实机配置里没有的 convar（稀疏配置可能只是取默认值）");
const missing = baselineRows.map((r) => r[0]).filter((k) => game[k] === undefined);
console.log("  " + (missing.length ? missing.join(", ") : "无"));
console.log("");

/* ---------- ② 数值 ---------- */
console.log("【② 数值】生成器默认基线 vs 实机值（两边都有的项）");
const shared = baselineRows.map((r) => r[0]).filter((k) => game[k] !== undefined);
let diff = 0, same = 0;
for (const k of shared) {
  const g = norm(game[k]), b = norm(baselineMap[k]);
  const same_ = num(g) !== null && num(b) !== null ? Math.abs(num(g) - num(b)) < 1e-9 : g === b;
  if (same_) same++;
  else { diff++; console.log("  ✗ " + k.padEnd(42) + " 实机 " + g + "  生成器 " + b); }
}
console.log("  一致 " + same + " / 不一致 " + diff + "（共 " + shared.length + " 项）");
console.log("");

/* ---------- ③ 往返 ---------- */
console.log("【③ 往返】实机 convar -> 生成器解析 -> 再导出，是否 1:1 还原");
let rtSame = 0, rtDiff = 0;
for (const k of shared) {
  const g = norm(game[k]), r = norm(reMap[k]);
  const ok = num(g) !== null && num(r) !== null ? Math.abs(num(g) - num(r)) < 1e-9 : g === r;
  if (ok) rtSame++;
  else { rtDiff++; console.log("  ✗ " + k.padEnd(42) + " 实机 " + g + "  导出 " + r); }
}
console.log("  一致 " + rtSame + " / 不一致 " + rtDiff);
console.log("");
console.log("【③b】实机 -> 生成器模型（关键字段）");
const keys = ["style", "length", "thickness", "gap", "alpha", "red", "green", "blue", "outlineMode",
  "dynamicSpreadLimit", "splitDistance", "innerSplitAlpha", "outerSplitAlpha", "splitSizeRatio",
  "screenHeight", "scopeDotScale", "scopeDotUseCrosshairColor", "centerDotEnabled", "tStyleEnabled", "followRecoil"];
for (const k of keys) console.log("  " + k.padEnd(26) + JSON.stringify(imported[k]));
console.log("");
console.log("【③c】由实机模型生成的分享码: " + CS.encodeShareCode(imported));
