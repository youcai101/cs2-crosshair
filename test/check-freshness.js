/* =========================================================================
 * check-freshness.js — 本地选手数据 vs prosettings 现场逐字段比对
 *
 * 用法: node test/check-freshness.js
 *
 * 2026-10-16 起：站点已迁移新准星系统（页面给新 convar 名 + 文本值，不再给分享码），
 * 因此比对方式是「页面新字段 → CrosshairV2 模型 → cs2-v1 码」与本地 c2 逐字符比对；
 * 解析逻辑与 tools/auto-update.js 共用 tools/prosettings-parse.js，避免两处漂移。
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PS = require("../tools/prosettings-parse.js");
const CS = PS.CS;

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" };

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "players.js"), "utf8"), ctx);
const pros = ctx.window.PRO_PLAYERS || [];

// 本地准星码：优先 c2（新格式），旧数据用 c 按该选手分辨率转换后比对
function localCode(p) {
  if (p.c2) return p.c2;
  if (p.c) {
    try {
      return CS.encodeShareCode(CS.decodeInfo(p.c, { screenHeight: PS.resHeight(p.i) }).model);
    } catch (e) { return null; }
  }
  return null;
}

(async () => {
  if (!pros.length) { console.log("✖ players.js 为空"); process.exit(1); }
  const noC2 = pros.filter((p) => !p.c2).length;
  console.log("本地选手 " + pros.length + " 名 · 有 c2 " + (pros.length - noC2) + " · 无 c2（旧数据） " + noC2);

  const sample = [];
  const step = Math.max(1, Math.floor(pros.length / 24));
  for (let i = 0; i < pros.length && sample.length < 24; i += step) sample.push(pros[i]);

  let same = 0, diff = 0, err = 0;
  const diffs = [];
  for (const p of sample) {
    try {
      const html = await (await fetch(p.u, { headers: UA })).text();
      const f = PS.parseCrosshairFields(html);
      if (!PS.isNewFormatFields(f) && !f["cl_crosshairsize"]) { err++; continue; }
      // 现场码：新格式页面直接组装；旧格式页面走 legacy 编码 + 转换（与 auto-update 同规则）
      let live;
      if (PS.isNewFormatFields(f)) {
        live = CS.encodeShareCode(PS.fieldsToModelNew(f));
      } else {
        const legacy = CS.encodeLegacy(PS.fieldsToLegacySettings(f));
        live = CS.encodeShareCode(CS.decodeInfo(legacy, { screenHeight: PS.resHeight(p.i) }).model);
      }
      const mine = localCode(p);
      if (mine && mine === live) same++;
      else {
        diff++;
        diffs.push(p.n + " 本地=" + mine + " 现场=" + live +
          " 字段=" + JSON.stringify({ style: f["cl_crosshairstyle"], len: f["cl_crosshair_length"], thk: f["cl_crosshair_thickness"], gap: f["cl_crosshair_gap"], h: f["cl_crosshair_screen_height"] }));
      }
    } catch (e) { err++; }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log("\n抽查比对（24 名）: 一致 " + same + " / 不一致 " + diff + " / 失败 " + err);
  diffs.slice(0, 8).forEach((d) => console.log("  ✗ " + d));
  if (PS.UNKNOWN_STYLES.size) console.log("  ⚠ 未能识别的样式文本: " + [...PS.UNKNOWN_STYLES].join("、"));
  if (PS.UNKNOWN_OUTLINES.size) console.log("  ⚠ 未能识别的描边文本: " + [...PS.UNKNOWN_OUTLINES].join("、"));
  process.exit(diff === 0 && err === 0 ? 0 : 1);
})();
