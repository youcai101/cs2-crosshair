/* =========================================================================
 * check-codec.js — 核心编解码对拍（Phase 1 验收）
 *
 * 基准：akiver/csgo-sharecode 7.0.1 生成的离线向量 test/vectors/sharecode-vectors.json
 * 断言：
 *   ① cs2-v1：本站解码 == oracle 解码；本站重编码 == 原码（逐字符往返）
 *   ② legacy-v1/v3/v4：本站解码 == oracle 解码；本站重编码 == 原码
 *   ③ 生成路径只产出 cs2 容器（永远不再生成 CSGO- 旧码）
 *   ④ 容器识别与校验和：篡改一个字符必须被拒绝
 *
 * 用法: node test/check-codec.js
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const A = require("../js/core-alphabet.js");
const L = require("../js/core-layouts.js");
const Codec = require("../js/core-codec.js");
const Legacy = require("../js/core-legacy.js");

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("  ✗ " + msg); } };

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "vectors", "sharecode-vectors.json"), "utf8"));
const EPS = 1e-9;

function sameValue(a, b) {
  if (typeof a === "boolean" || typeof b === "boolean") return !!a === !!b;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < EPS;
  return a === b;
}

function compareFields(label, mine, oracle, skip) {
  let bad = 0;
  for (const k of Object.keys(oracle)) {
    if (skip && skip.indexOf(k) !== -1) continue;
    if (!sameValue(mine[k], oracle[k])) {
      if (bad < 3) console.log("  ✗ " + label + " 字段 " + k + " 本站=" + mine[k] + " oracle=" + oracle[k]);
      bad++;
    }
  }
  if (bad) { fail++; return false; }
  return true;
}

/* ① cs2-v1 */
console.log("① cs2-v1 对拍（" + vectors.cs2.length + " 条向量）");
let cs2Decode = 0, cs2Round = 0, cs2Encode = 0;
for (const v of vectors.cs2) {
  const mine = Codec.decode(v.code);
  if (compareFields(v.code.slice(0, 12) + "…", mine, v.crosshair, ["format"])) cs2Decode++;
  if (Codec.encode(mine) === v.code) cs2Round++;
  else { fail++; console.log("  ✗ 往返不一致: " + v.code + " -> " + Codec.encode(mine)); }
  if (Codec.encode(v.input) === v.code) cs2Encode++;
  else { fail++; console.log("  ✗ 由输入模型编码不一致: " + v.code); }
}
console.log("  解码一致 " + cs2Decode + "/" + vectors.cs2.length +
  " · 往返一致 " + cs2Round + "/" + vectors.cs2.length +
  " · 输入重编码一致 " + cs2Encode + "/" + vectors.cs2.length);

/* ② legacy */
console.log("\n② legacy 三种布局对拍（" + vectors.legacy.length + " 条向量）");
const byFormat = {};
let lgDecode = 0, lgRound = 0;
for (const v of vectors.legacy) {
  const f = v.crosshair.format;
  byFormat[f] = (byFormat[f] || 0) + 1;
  const mine = Legacy.decode(v.code);
  if (compareFields(v.code, mine, v.crosshair, ["format", "version"])) lgDecode++;
  if (Legacy.encode(mine) === v.code) lgRound++;
  else { fail++; console.log("  ✗ legacy 往返不一致: " + v.code + " -> " + Legacy.encode(mine)); }
}
console.log("  解码一致 " + lgDecode + "/" + vectors.legacy.length + " · 往返一致 " + lgRound + "/" + vectors.legacy.length);
console.log("  分布: " + Object.keys(byFormat).map((k) => k + " " + byFormat[k]).join(" / "));
ok(lgDecode === vectors.legacy.length, "legacy 解码全部一致");
ok(lgRound === vectors.legacy.length, "legacy 往返全部一致");

/* ③ 生成路径只产出 cs2 容器 */
console.log("\n③ 生成路径");
ok(A.detectContainer(Codec.encode(Codec.defaultModel())) === "cs2", "默认模型生成 cs2 容器");
ok(Codec.encode(Codec.defaultModel()).length === 46, "码长 46（CS + 44 字符）");
const defaultCode = Codec.encode(Codec.defaultModel());
ok(defaultCode.slice(0, 2) === "CS" && defaultCode.indexOf("-") === -1, "以 CS 开头且无分隔符");
ok(Array.from(defaultCode.slice(2)).every((c) => A.ALPHABET.indexOf(c) !== -1), "全部字符都在 Base57 字母表内");
ok(A.verifyChecksum(A.cs2ShareCodeToBytes(Codec.encode(Codec.defaultModel()))), "校验和正确");

/* ④ 容器识别 / 拒绝 */
console.log("\n④ 容器识别与损坏检测");
const sample = vectors.cs2[0].code;
ok(A.detectContainer(sample) === "cs2", "识别 cs2 容器");
ok(A.detectContainer(vectors.legacy[0].code) === "legacy", "识别 legacy 容器");
ok(A.detectContainer("CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXX0") === null, "拒绝非法 base57 字符（0/I/O/l 不在字母表）");
ok(A.detectContainer("CS" + "a".repeat(44).slice(0, 43) + "0") === null, "cs2 容器同样拒绝字母表外字符");
ok(A.detectContainer("CS") === null, "拒绝过短的 cs2 码");
const tampered = sample.slice(0, 5) + (sample[5] === "a" ? "b" : "a") + sample.slice(6);
let threw = false;
try { Codec.decode(tampered); } catch (e) { threw = true; }
ok(threw, "篡改字符后校验和拒绝");
threw = false;
try { Legacy.decode(vectors.legacy[0].code.slice(0, -1) + (vectors.legacy[0].code.slice(-1) === "a" ? "b" : "a")); }
catch (e) { threw = true; }
ok(threw, "legacy 篡改后拒绝");

/* ⑤ 布局表自检 */
console.log("\n⑤ 布局表自检");
const layouts = Object.keys(L.LAYOUTS);
ok(layouts.length === 4, "布局表 4 张：" + layouts.join(" / "));
ok(L.LAYOUTS["cs2-v1"].byteLength === 32 && L.LAYOUTS["cs2-v1"].container === "cs2", "cs2-v1 = 32 字节 cs2 容器");
ok(L.LAYOUTS["legacy-v1"].byteLength === 18, "legacy-v1 = 18 字节");
const cs2Fields = L.LAYOUTS["cs2-v1"].fields.map((f) => f.name);
["screenHeight", "outlineMode", "dynamicSpreadLimit", "scopeDotScale", "scopeDotUseCrosshairColor",
  "innerSplitAlpha", "outerSplitAlpha", "splitSizeRatio"].forEach((n) => {
  ok(cs2Fields.indexOf(n) !== -1, "cs2-v1 含字段 " + n);
});

/* ⑥ 范围裁剪 */
console.log("\n⑥ 范围裁剪");
const wild = Codec.normalizeModel({ style: 99, thickness: 999, length: 9999, gap: 99999, screenHeight: 0,
  innerSplitAlpha: 5, outerSplitAlpha: 0, splitSizeRatio: 9, scopeDotScale: 9, outlineMode: 7 });
ok(wild.style === 9, "style 裁剪到 9");
ok(wild.thickness === 32, "thickness 裁剪到 32");
ok(wild.length === 255, "length 裁剪到 255");
ok(wild.gap === 3840, "gap 裁剪到 3840");
ok(wild.screenHeight === 240, "screenHeight 0 -> 240（游戏会拒绝 0）");
ok(wild.innerSplitAlpha === 1, "innerSplitAlpha 裁剪到 1");
ok(wild.outerSplitAlpha === 0.3, "outerSplitAlpha 裁剪到 0.3");
ok(wild.splitSizeRatio === 1, "splitSizeRatio 裁剪到 1");
ok(wild.scopeDotScale === 2, "scopeDotScale 裁剪到 2");
ok(wild.outlineMode === 2, "outlineMode 裁剪到 2");

console.log("\n" + (fail ? "✗ 有 " + fail + " 项未通过" : "✓ 全部通过"));
process.exit(fail ? 1 : 0);
