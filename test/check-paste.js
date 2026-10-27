/* =========================================================================
 * check-paste.js — 控制台命令自检（Phase 4 验收）
 *
 *  ① 每段粘贴串必须 ≤ 512 字符（Source COMMAND_MAX_LENGTH，否则整条会被丢弃）
 *  ② 输出中**绝不能出现任何已被删除的旧 convar**（新系统改了名/删了项）
 *  ③ 命令集必须是新系统命令名，条件输出（split 仅 style 2 且偏离默认 /
 *     描边色仅开描边且偏离默认 / spread 仅动态且偏离默认）
 *  ④ 单行最小完备语义：核心 12 条永远在，等于默认值的条件尾部命令省略
 *  ⑤ 命令 → 解析 往返一致
 *
 * 用法: node test/check-paste.js
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const CS = require("../js/codec.js");

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("  ✗ " + msg); } };

// 新命令名 → 模型字段（与 core-convars.js 的表一致，用于往返断言）
const FIELD_OF = {
  cl_crosshairstyle: "style",
  cl_crosshair_length: "length",
  cl_crosshair_thickness: "thickness",
  cl_crosshair_gap: "gap",
  cl_crosshaircolor_r: "red",
  cl_crosshaircolor_g: "green",
  cl_crosshaircolor_b: "blue",
  cl_crosshaircolor_a: "alpha",
  cl_crosshairoutline_r: "outlineRed",
  cl_crosshairoutline_g: "outlineGreen",
  cl_crosshairoutline_b: "outlineBlue",
  cl_crosshairoutline_a: "outlineAlpha",
  cl_crosshair_drawoutline: "outlineMode",
  cl_crosshair_screen_height: "screenHeight",
  cl_crosshair_dynamic_spread_limit: "dynamicSpreadLimit",
  cl_crosshair_dynamic_splitdist: "splitDistance",
  cl_crosshair_dynamic_splitalpha_innermod: "innerSplitAlpha",
  cl_crosshair_dynamic_splitalpha_outermod: "outerSplitAlpha",
  cl_crosshair_dynamic_maxdist_splitratio: "splitSizeRatio",
  cl_ironsight_dot_scale: "scopeDotScale",
  cl_crosshairdot: "centerDotEnabled",
  cl_crosshair_t: "tStyleEnabled",
  cl_crosshair_recoil: "followRecoil",
  cl_ironsight_usecrosshaircolor: "scopeDotUseCrosshairColor",
};

function splitNames(chunk) {
  return chunk.split(";").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
}

/* ---------- ① 边界样例 ---------- */
console.log("① 边界样例");
const cases = {
  "默认": {},
  "style4 最小 gap0": { style: 4, gap: 0, length: 1, thickness: 1, alpha: 255 },
  "style4 描边全开": { style: 4, gap: 4, length: 8, thickness: 2, outlineMode: 1, outlineAlpha: 255 },
  "style4 半描边": { style: 4, gap: 4, length: 8, thickness: 2, outlineMode: 2, outlineAlpha: 200 },
  "style2 负 gap + 分裂": { style: 2, gap: -10, length: 12, thickness: 2, outlineMode: 1,
    innerSplitAlpha: 0.7, outerSplitAlpha: 0.3, splitSizeRatio: 0.6, splitDistance: 40 },
  "全量拉满（最坏长度）": { style: 2, gap: 128, length: 255, thickness: 32, alpha: 255,
    outlineMode: 1, dynamicSpreadLimit: 255, splitDistance: 127, innerSplitAlpha: 1,
    outerSplitAlpha: 1, splitSizeRatio: 1, screenHeight: 65535, scopeDotScale: 2,
    centerDotEnabled: true, tStyleEnabled: true, followRecoil: true,
    outlineRed: 255, outlineGreen: 255, outlineBlue: 255, outlineAlpha: 255 },
};
let worst = 0;
for (const k in cases) {
  const m = CS.normalizeModel(Object.assign(CS.defaultSettings(), cases[k]));
  const chunks = CS.settingsToPasteChunks(m);
  const max = Math.max(...chunks.map((c) => c.length));
  worst = Math.max(worst, max);
  ok(chunks.every((c) => c.length <= CS.PASTE_LIMIT), k + " 存在超长段: " + chunks.map((c) => c.length).join("/"));
  console.log("  · " + k + " -> " + chunks.length + " 段，最长 " + max + " 字符");
}
console.log("  最长段 " + worst + " / 上限 " + CS.PASTE_LIMIT + "（分段数 " + (worst > CS.PASTE_LIMIT ? ">1" : "1") + "）");

/* ---------- ② 全库真实选手（c2 新码 / 历史混合码） ---------- */
console.log("\n② 全库选手准星（新码 + 历史混合码）");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "players.js"), "utf8"), ctx);
const pros = ctx.window.PRO_PLAYERS;
const codes = [];
for (const p of pros) {
  // 当前准星优先 c2（新格式页面直接生成）；旧格式页面只有 c（legacy，走迁移）
  const cur = p.c2 || p.c;
  if (cur) codes.push({ who: p.n, code: cur });
  for (const h of (p.h || [])) if (h.c) codes.push({ who: p.n, code: h.c });
}
let multi = 0, maxAll = 0, maxName = "", noRemoved = 0;
for (const item of codes) {
  const m = CS.decodeShareCode(item.code);
  const chunks = CS.settingsToPasteChunks(m);
  const mx = Math.max(...chunks.map((c) => c.length));
  if (mx > CS.PASTE_LIMIT) { fail++; console.log("  ✗ " + item.who + " 超长 " + mx); }
  if (chunks.length > 1) multi++;
  if (mx > maxAll) { maxAll = mx; maxName = item.who; }
  for (const c of chunks) {
    for (const n of splitNames(c)) {
      if (CS.NEVER_OUTPUT.indexOf(n) !== -1) { fail++; console.log("  ✗ " + item.who + " 输出含旧 convar: " + n); }
      else noRemoved++;
    }
  }
}
console.log("  选手 " + pros.length + " 人 · 码 " + codes.length + " 条");
console.log("  最长单段 " + maxAll + " 字符（" + maxName + "）· 上限 " + CS.PASTE_LIMIT);
console.log("  需要分 2 段及以上粘贴的 " + multi + " 条");
console.log("  命令名检查通过 " + noRemoved + " 条，未出现任何旧 convar");

/* ---------- ③ 旧 convar 必须全部消失 ---------- */
console.log("\n③ 旧 convar 断言（10 样式 × 描边三态）· NEVER_OUTPUT " + CS.NEVER_OUTPUT.length + " 条 = 已移除 " + CS.REMOVED_CONVARS.length + " + 客户端隐藏 " + CS.HIDDEN_LEGACY_CONVARS.length);
let cmdCount = 0;
for (let style = 0; style <= 9; style++) {
  for (const outlineMode of [0, 1, 2]) {
    const m = CS.normalizeModel({ style: style, outlineMode: outlineMode, gap: style === 2 ? -5 : 6,
      length: 10, thickness: 2, outlineRed: 10, outlineGreen: 20, outlineBlue: 30, outlineAlpha: 200 });
    const all = CS.settingsToCommands(m).concat(CS.settingsToConVars(m));
    for (const line of all) {
      const name = line.trim().split(/\s+/)[0].replace(/"/g, "");
      cmdCount++;
      ok(CS.NEVER_OUTPUT.indexOf(name) === -1, "style " + style + " outline " + outlineMode + " 输出了旧 convar " + name);
    }
    // 条件输出规则（最小完备：偏离默认才输出）。本循环的模型未自定义 split/spread，
    // 所以 style 2 也不输出 split、动态样式也不输出 spread；自定义时才恢复（见下方回归）。
    const chunk = CS.settingsToPasteChunks(m).join(";");
    const names = splitNames(chunk);
    const hasSplit = names.indexOf("cl_crosshair_dynamic_splitdist") !== -1;
    ok(!hasSplit, "style " + style + " 默认 split 参数应省略（实得 " + (hasSplit ? "输出了" : "省略") + "）");
    const hasOutlineRgb = names.indexOf("cl_crosshairoutline_r") !== -1;
    ok(hasOutlineRgb === (outlineMode !== 0), "outlineMode " + outlineMode + " 的描边颜色条件输出不正确");
    const hasSpread = names.indexOf("cl_crosshair_dynamic_spread_limit") !== -1;
    ok(!hasSpread, "style " + style + " 默认 spread limit 应省略");
  }
}
// 自定义分裂 / 扩散时条件输出恢复
const customSplit = CS.normalizeModel({ style: 2, gap: 6, length: 10, thickness: 2,
  splitDistance: 40, innerSplitAlpha: 0.7, outerSplitAlpha: 0.3, splitSizeRatio: 0.6, dynamicSpreadLimit: 128 });
const customNames = splitNames(CS.settingsToPasteChunks(customSplit).join(";"));
ok(customNames.indexOf("cl_crosshair_dynamic_splitdist") !== -1 &&
  customNames.indexOf("cl_crosshair_dynamic_splitalpha_innermod") !== -1 &&
  customNames.indexOf("cl_crosshair_dynamic_splitalpha_outermod") !== -1 &&
  customNames.indexOf("cl_crosshair_dynamic_maxdist_splitratio") !== -1,
  "style 2 自定义分裂参数 → 4 条 split 命令全部输出");
const customDyn = CS.normalizeModel({ style: 0, gap: 6, length: 10, thickness: 2, dynamicSpreadLimit: 128, followRecoil: true });
const dynNames = splitNames(CS.settingsToPasteChunks(customDyn).join(";"));
ok(dynNames.indexOf("cl_crosshair_dynamic_spread_limit") !== -1 && dynNames.indexOf("cl_crosshair_recoil") !== -1,
  "动态样式自定义 spread / recoil → 条件输出恢复");
const staticNames = splitNames(CS.settingsToPasteChunks(CS.normalizeModel({ style: 4 })).join(";"));
ok(staticNames.indexOf("cl_crosshair_recoil") === -1 && staticNames.indexOf("cl_crosshair_dynamic_spread_limit") === -1,
  "静态样式不输出 spread / recoil");
console.log("  检查命令 " + cmdCount + " 条（10 样式 × 3 描边态 × 两种输出）+ 条件输出回归");

/* ---------- ④ 最小完备语义 ---------- */
console.log("\n④ 最小完备语义（核心 12 条恒在 · 默认值条件尾部省略）");
const defNames = splitNames(CS.settingsToPasteLine(CS.defaultSettings()));
["cl_crosshairstyle", "cl_crosshair_length", "cl_crosshair_thickness", "cl_crosshair_gap",
  "cl_crosshaircolor_r", "cl_crosshaircolor_g", "cl_crosshaircolor_b", "cl_crosshaircolor_a",
  "cl_crosshairdot", "cl_crosshair_t", "cl_crosshair_drawoutline", "cl_crosshair_screen_height",
].forEach((n) => ok(defNames.indexOf(n) !== -1, "核心命令必须恒在: " + n));
ok(defNames.indexOf("cl_ironsight_dot_scale") === -1 && defNames.indexOf("cl_ironsight_usecrosshaircolor") === -1,
  "默认镜内参数省略");
console.log("  默认准星单行 " + CS.settingsToPasteLine(CS.defaultSettings()).length + " 字符 · " + defNames.length + " 条命令");

/* ---------- ⑤ 命令 → 解析 往返 ---------- */
console.log("\n⑤ 命令 → 解析 往返");
let rtOk = 0, rtBad = 0;
for (let style = 0; style <= 9; style++) {
  for (const outlineMode of [0, 1, 2]) {
    const m = CS.normalizeModel({ style: style, outlineMode: outlineMode, gap: style === 2 ? -7 : 9,
      length: 13, thickness: 3, alpha: 210, red: 12, green: 34, blue: 56,
      outlineRed: 200, outlineGreen: 100, outlineBlue: 50, outlineAlpha: 180,
      screenHeight: 1440, scopeDotScale: 1.5, scopeDotUseCrosshairColor: true,
      dynamicSpreadLimit: 128, splitDistance: 33, innerSplitAlpha: 0.8, outerSplitAlpha: 0.4,
      splitSizeRatio: 0.55, centerDotEnabled: true, tStyleEnabled: true, followRecoil: true });
    const text = CS.settingsToCommands(m).join("\n");
    const back = CS.parseConVars(text);
    let badFields = [];
    for (const line of text.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const field = FIELD_OF[parts[0]];
      if (!field) { badFields.push("未映射 " + parts[0]); continue; }
      const want = typeof m[field] === "boolean" ? (parts[1] === "1") : Number(parts[1]);
      if (back[field] !== want) badFields.push(field + " 期望 " + want + " 实得 " + back[field]);
    }
    if (badFields.length) { rtBad++; if (rtBad < 5) console.log("  ✗ style " + style + " outline " + outlineMode + "：" + badFields.join("；")); }
    else rtOk++;
  }
}
console.log("  " + rtOk + " 通过 / " + rtBad + " 失败（30 组：10 样式 × 3 描边态）");
ok(rtBad === 0, "命令解析必须往返一致");

/* ---------- ⑥ 旧命令兼容解析 ---------- */
console.log("\n⑥ 旧命令兼容解析（互转页粘贴旧 cfg）");
const legacyText = [
  "cl_crosshairstyle 4", "cl_crosshairsize 2.5", "cl_crosshairthickness 1",
  "cl_crosshairgap -2", "cl_crosshairalpha 200", "cl_crosshaircolor 1",
  "cl_crosshair_outlinethickness 0.5", "cl_crosshair_drawoutline 1",
  "cl_fixedcrosshairgap 5", "cl_crosshairgap_useweaponvalue 0",
].join("\n");
const legacyModel = CS.parseConVars(legacyText);
ok(legacyModel.style === 4, "旧 style 4 → 新 style 4（实际 " + legacyModel.style + "）");
ok(legacyModel.length === 6, "cl_crosshairsize 2.5 → 6px（实际 " + legacyModel.length + "）");
ok(legacyModel.thickness === 2, "cl_crosshairthickness 1 → 2px（实际 " + legacyModel.thickness + "）");
ok(legacyModel.gap === 3, "cl_crosshairgap -2 → 3px（边沿 2px + ceil(2/2)，实际 " + legacyModel.gap + "）");
ok(legacyModel.alpha === 200, "cl_crosshairalpha 200");
ok(legacyModel.red === 0 && legacyModel.green === 255 && legacyModel.blue === 0, "预设色 1 → 绿");
ok(legacyModel.outlineMode === 2, "旧细描边 0.5 → 半描边（实际 " + legacyModel.outlineMode + "）");
ok(!!legacyModel.migration, "旧文本解析会带 migration 标记");
const newText = "cl_crosshair_gap 20; cl_crosshair_length 40; cl_crosshair_thickness 5; cl_crosshairstyle 7";
const newModel = CS.parseConVars(newText);
ok(newModel.gap === 20 && newModel.length === 40 && newModel.thickness === 5 && newModel.style === 7, "新命令直读");

/* ---------- ⑦ 新旧混合文本（真实实机 vcfg 快照回归） ----------
 * 实测：2026-10-15 本机 CS2 1.41.9.1 的用户配置里，
 * 新系统命令与旧命令名（cl_crosshairsize / cl_crosshairthickness / cl_crosshairalpha）
 * **同时存在**。解析器必须把它当「新系统文本 + 旧残留」，而不是整段按旧系统换算。
 */
console.log("\n⑦ 新旧混合文本（实机 vcfg 快照回归）");
const fixturePath = path.join(__dirname, "fixtures", "vcfg-crosshair-20261015.txt");
ok(fs.existsSync(fixturePath), "缺少实机快照 fixture");
const liveText = fs.readFileSync(fixturePath, "utf8");
const live = CS.parseConVarsInfo(liveText);
const lm = live.model;
ok(lm.style === 4, "实机 style 4 未被旧编号重映射（实得 " + lm.style + "）");
ok(lm.length === 6, "实机 length 6（实得 " + lm.length + "）");
ok(lm.thickness === 2, "实机 thickness 2（实得 " + lm.thickness + "）");
ok(lm.gap === 6, "实机 gap 6（实得 " + lm.gap + "）");
ok(lm.screenHeight === 960, "实机 screenHeight 960（实得 " + lm.screenHeight + "）");
ok(lm.dynamicSpreadLimit === 227, "实机 dynamicSpreadLimit 227（实得 " + lm.dynamicSpreadLimit + "）");
ok(lm.splitDistance === 6, "实机 splitDistance 6（实得 " + lm.splitDistance + "）");
ok(lm.outlineMode === 0, "实机 outlineMode 0（实得 " + lm.outlineMode + "）");
ok(lm.followRecoil === false && lm.centerDotEnabled === false && lm.tStyleEnabled === false, "实机三个布尔开关为 false");
ok(live.leftover.length === 3, "识别出 3 条旧残留（实得 " + live.leftover.length + "）");
["cl_crosshairsize", "cl_crosshairthickness", "cl_crosshairalpha"].forEach((n) => {
  ok(live.leftover.indexOf(n) !== -1, "旧残留清单含 " + n);
});
// 关键回归：混合文本中的新编号样式不得被重映射
const mixed = CS.parseConVars(liveText + "\ncl_crosshairstyle 7\ncl_crosshair_drawoutline 2");
ok(mixed.style === 7, "混合文本里 style 7 不得被重映射为旧编号（实得 " + mixed.style + "）");
ok(mixed.outlineMode === 2, "混合文本里 drawoutline 2 必须保持半描边（实得 " + mixed.outlineMode + "）");
// 对照：纯旧文本仍走换算路径
const pureOld = CS.parseConVars("cl_crosshairstyle 3\ncl_crosshairsize 2.5\ncl_crosshairgap -2");
ok(pureOld.style === 2, "纯旧文本 style 3 → 新 2（实得 " + pureOld.style + "）");
ok(pureOld.length === 6, "纯旧文本 cl_crosshairsize 2.5 → 6px（实得 " + pureOld.length + "）");
ok(pureOld.gap === 3, "纯旧文本 cl_crosshairgap -2 → 3px（边沿 2px + ceil(2/2)，实得 " + pureOld.gap + "）");
console.log("  实机快照解析通过 · 旧残留 " + live.leftover.join("、") + " 已忽略");

/* ---------- ⑧ 一次性粘贴 + 量程合规 ---------- */
console.log("\n⑧ 一次性粘贴与量程合规");
// 投掷物准星功能已移除（2026-10-17）：粘贴行不应再出现相关命令
const defaultLine = CS.settingsToPasteLine(CS.defaultSettings());
ok(!/cl_grenadecrosshair/.test(defaultLine), "粘贴行不包含投掷物准星命令");
// 全库选手：最小完备命令集下必须**全部 1 段**且 ≤512
// 说明：库内准星的 split / spread / 镜内参数全部等于默认值 → 条件尾部整体省略，
// 单行最长 ~350 字符；只有生成器里同时自定义分裂与描边色的极端组合才可能超 512（UI 保留分段兜底）。
let single = 0, over = [];
for (const item of codes) {
  const m = CS.decodeShareCode(item.code);
  const chunks = CS.settingsToPasteChunks(m);
  const mx = Math.max.apply(null, chunks.map((c) => c.length));
  if (chunks.length === 1) single++;
  else over.push(item.who + "(" + chunks.length + "段)");
  if (mx > CS.PASTE_LIMIT) over.push(item.who + "(" + mx + "字符)");
}
console.log("  全库 " + codes.length + " 条：一次粘贴 " + single + " 条（" +
  (codes.length - single ? "存在需分段：" + over.slice(0, 5).join("、") : "100% 单行") + "）");
ok(over.length === 0, "全库选手准星必须全部单行粘贴：" + over.slice(0, 5).join("、"));
// 量程：所有输出值必须在游戏量程内（越界会被静默忽略）
const RANGES = {
  cl_crosshairstyle: [0, 9], cl_crosshair_length: [0, 255], cl_crosshair_thickness: [0, 32],
  cl_crosshair_gap: [-3840, 3840], cl_crosshaircolor_r: [0, 255], cl_crosshaircolor_g: [0, 255],
  cl_crosshaircolor_b: [0, 255], cl_crosshaircolor_a: [0, 255], cl_crosshair_drawoutline: [0, 2],
  cl_crosshair_screen_height: [240, 65535], cl_crosshairoutline_r: [0, 255], cl_crosshairoutline_g: [0, 255],
  cl_crosshairoutline_b: [0, 255], cl_crosshairoutline_a: [0, 255], cl_crosshairdot: [0, 1], cl_crosshair_t: [0, 1],
  cl_crosshair_recoil: [0, 1], cl_crosshair_dynamic_spread_limit: [0, 255], cl_crosshair_dynamic_splitdist: [0, 127],
  cl_crosshair_dynamic_splitalpha_innermod: [0, 1], cl_crosshair_dynamic_splitalpha_outermod: [0.3, 1],
  cl_crosshair_dynamic_maxdist_splitratio: [0, 1], cl_ironsight_dot_scale: [0.1, 2], cl_ironsight_usecrosshaircolor: [0, 1],
};
let outOfRange = 0, checked = 0, unmapped = new Set();
const extreme = [
  CS.normalizeModel({ style: 2, gap: -3840, length: 255, thickness: 32, outlineMode: 2, screenHeight: 65535, scopeDotScale: 2 }),
  CS.normalizeModel({ style: 4, gap: 0, length: 0, thickness: 0, outlineMode: 1, screenHeight: 240, scopeDotScale: 0.1 }),
  CS.normalizeModel({ style: 7, gap: 128, length: 255, thickness: 32, dynamicSpreadLimit: 255 }),
];
const allText = extreme.map((m) => CS.settingsToPasteChunks(m).join(";")).concat([defaultLine]).join(";");
for (const row of allText.split(";")) {
  const i = row.indexOf(" ");
  const k = row.slice(0, i), v = Number(row.slice(i + 1));
  checked++;
  if (!RANGES[k]) { unmapped.add(k); continue; }
  if (!(v >= RANGES[k][0] && v <= RANGES[k][1])) {
    outOfRange++;
    console.log("  ✗ " + k + " = " + v + " 超出量程 [" + RANGES[k] + "]");
  }
}
ok(outOfRange === 0, "存在越界值 " + outOfRange + " 处");
ok(unmapped.size === 0, "有未登记量程的命令：" + [...unmapped].join(", "));
console.log("  量程检查通过 " + checked + " 条命令（含 gap −3840 / thickness 32 / screenHeight 65535 等极端值）");
// 极端值也不得越界 + 粘贴行长度
console.log("  极端配置的粘贴段数：" + extreme.map((m) => CS.settingsToPasteChunks(m).length).join(" / "));

console.log("\n" + (fail ? "✗ 有 " + fail + " 项未通过" : "✓ 全部通过"));
process.exit(fail ? 1 : 0);
