/* =========================================================================
 * vectors-check.js — Phase 0 验收：离线对拍向量可用性
 * 用法: node test/vectors-check.js
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const A = require("../js/core-alphabet.js");

const file = path.join(__dirname, "vectors", "sharecode-vectors.json");
if (!fs.existsSync(file)) {
  console.log("✗ 缺少 " + file + "（用 _oracle/gen-vectors.mjs 生成）");
  process.exit(1);
}
const v = JSON.parse(fs.readFileSync(file, "utf8"));
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } };

console.log("向量来源: " + v.source);
console.log("生成时间: " + v.generatedAt);
console.log("cs2 向量: " + v.cs2.length + " 条");
console.log("legacy 向量: " + v.legacy.length + " 条");
const byFormat = {};
for (const x of v.legacy) byFormat[x.crosshair.format] = (byFormat[x.crosshair.format] || 0) + 1;
console.log("legacy 分布: " + JSON.stringify(byFormat));

let cs2Good = 0, lgGood = 0;
for (const x of v.cs2) {
  if (A.detectContainer(x.code) === "cs2" && A.verifyChecksum(A.cs2ShareCodeToBytes(x.code))) cs2Good++;
  else { fail++; console.log("  ✗ 非法 cs2 向量: " + x.code); }
}
for (const x of v.legacy) {
  if (A.detectContainer(x.code) === "legacy" && A.verifyChecksum(A.legacyShareCodeToBytes(x.code))) lgGood++;
  else { fail++; console.log("  ✗ 非法 legacy 向量: " + x.code); }
}
console.log("校验和通过: cs2 " + cs2Good + "/" + v.cs2.length + " · legacy " + lgGood + "/" + v.legacy.length);
ok(cs2Good === v.cs2.length, "全部 cs2 向量合法");
ok(lgGood === v.legacy.length, "全部 legacy 向量合法");
ok(v.cs2.length >= 400 && v.legacy.length >= 700, "向量规模足够（cs2 ≥400，legacy ≥700）");
ok(["legacy-v1", "legacy-v3", "legacy-v4"].every((f) => byFormat[f] > 0), "三种 legacy 布局都有向量");

console.log("\n" + (fail ? "✗ 有 " + fail + " 项未通过" : "✓ 全部通过"));
process.exit(fail ? 1 : 0);
