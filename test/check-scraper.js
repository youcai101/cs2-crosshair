/* =========================================================================
 * check-scraper.js — prosettings 抓取管线测试（真实页面 fixture）
 *
 * 用法: node test/check-scraper.js
 *
 * 样本：2026-10-16 实抓的 prosettings 选手页（m0NESY / s1mple）与
 *       m0NESY 的 history API 响应，存于 test/fixtures/。
 *
 * 最硬的一条断言：把页面字段组装成模型再编码，必须与 prosettings 自己
 * 通过 history API 发布的分享码**逐字符一致**——这同时验证了
 * ① 新字段解析 ② CrosshairV2 模型 ③ cs2-v1 编码器 对第三方真实样本的正确性。
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const PS = require("../tools/prosettings-parse.js");
const CS = PS.CS;

const FX = path.join(__dirname, "fixtures");
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
}

/* ---------- ① m0NESY 页面 → 码，与站点 history API 发布的码逐字符一致 ---------- */
console.log("\n① m0NESY 页面字段 → cs2-v1 码 vs 站点发布码");
{
  const html = fs.readFileSync(path.join(FX, "prosettings-m0nesy-20261016.html"), "utf8");
  const f = PS.parseCrosshairFields(html);
  ok(PS.isNewFormatFields(f), "页面识别为新准星系统格式");
  ok(PS.UNKNOWN_STYLES.size === 0 && PS.UNKNOWN_OUTLINES.size === 0, "无未识别的样式/描边文本");
  const model = PS.fieldsToModelNew(f);
  const code = CS.encodeShareCode(model);
  // history API 最新一条（2026-10-15 比赛检出）的发布码
  const hist = JSON.parse(fs.readFileSync(path.join(FX, "history-m0nesy-20261016.json"), "utf8")).history || [];
  const published = hist[0] && hist[0].crosshair_code;
  ok(!!published && /^CS[A-Za-z0-9]{43,44}$/.test(published), "站点发布码是 CS 容器（" + String(published).slice(0, 14) + "…）");
  ok(code === published, "生成码与站点发布码逐字符一致\n      生成:   " + code + "\n      发布:   " + published);
  // 与页面字段逐一对照
  ok(model.style === 4 && model.length === 2 && model.thickness === 1 && model.gap === 1 &&
     model.red === 255 && model.green === 255 && model.blue === 255 && model.alpha === 255 &&
     model.screenHeight === 960 && model.outlineMode === 0 && !model.centerDotEnabled &&
     !model.tStyleEnabled && !model.followRecoil && model.splitDistance === 3 &&
     model.innerSplitAlpha === 0 && model.outerSplitAlpha === 1 && model.splitSizeRatio === 1 &&
     model.dynamicSpreadLimit === 227 && model.scopeDotScale === 1 && !model.scopeDotUseCrosshairColor,
     "模型字段与页面表格逐一相符（style4 len2 thk1 gap1 白 @960 split3 spread227）");
  // 解码回来 round-trip
  ok(CS.encodeShareCode(CS.decodeShareCode(code)) === code, "生成码 round-trip 稳定");
  // 页面矩形仍在（官方渲染参考）
  const rects = PS.parseCrosshairRects(html);
  ok(rects.length === 4, "页面 SVG 矩形 4 条（官方渲染参考）");
}

/* ---------- ② s1mple 页面（第二个真实样本，含非默认 alpha/颜色） ---------- */
console.log("\n② s1mple 页面字段");
{
  const html = fs.readFileSync(path.join(FX, "prosettings-s1mple-20261016.html"), "utf8");
  const f = PS.parseCrosshairFields(html);
  const model = PS.fieldsToModelNew(f);
  ok(PS.isNewFormatFields(f), "识别为新格式");
  ok(model.style === 4 && model.length === 4 && model.thickness === 1 && model.gap === 2 &&
     model.red === 46 && model.green === 255 && model.blue === 0 && model.alpha === 229 &&
     model.screenHeight === 960 && model.outlineMode === 0,
     "style4 len4 thk1 gap2 · RGB(46,255,0) alpha229 @960");
  ok(/^CS[A-Za-z0-9]{43,44}$/.test(CS.encodeShareCode(model)), "生成合法 cs2-v1 码");
}

/* ---------- ③ history API：新旧混合 + lg 标记 ---------- */
console.log("\n③ history API 时代标记");
{
  const hist = JSON.parse(fs.readFileSync(path.join(FX, "history-m0nesy-20261016.json"), "utf8")).history || [];
  const lg = hist.filter((e) => /^CSGO-/.test(e.crosshair_code)).length;
  const cs2 = hist.filter((e) => /^CS[A-Za-z0-9]{43,44}$/.test(e.crosshairCode || e.crosshair_code)).length;
  ok(hist.length === 20, "20 条历史");
  ok(lg === 13 && cs2 === 7, "旧 CSGO- 码 13 条 + 新 CS 码 7 条（实得 " + lg + "/" + cs2 + "）");
  // lg 标记与容器精确对应（API 的 legacy 字段）
  const mismatch = hist.filter((e) => {
    const isLegacyContainer = /^CSGO-/.test(e.crosshair_code);
    return (e.legacy === true) !== isLegacyContainer;
  });
  ok(mismatch.length === 0, "每条 legacy 标记与码容器精确对应（0 条冲突）");
  // 最新一条是 10 月的新码，最早是 4 月的旧码（时间线符合 9.22 改版）
  ok(/^CS/.test(hist[0].crosshair_code) && /^CSGO-/.test(hist[hist.length - 1].crosshair_code),
     "最新为新码、最早为旧码（改版时间线一致）");
}

/* ---------- ④ 旧格式页面回退（合成字段，验证纯 legacy 形状 + 转换） ---------- */
console.log("\n④ 旧格式页面回退路径");
{
  const oldFields = {
    "cl_crosshairstyle": "classic static", "cl_crosshairsize": "2", "cl_crosshairthickness": "0.5",
    "cl_crosshairgap": "-2.2", "cl_crosshair_drawoutline": "1", "cl_crosshair_outlinethickness": "1",
    "cl_crosshaircolor": "green", "cl_crosshairalpha": "200", "cl_crosshairusealpha": "1",
    "cl_crosshairdot": "0", "cl_crosshair_t": "0", "cl_crosshair_recoil": "1",
  };
  ok(!PS.isNewFormatFields(oldFields), "旧字段集识别为旧格式");
  const legacy = PS.fieldsToLegacySettings(oldFields);
  ok(legacy.length === 2 && legacy.thickness === 0.5 && legacy.gap === -2.2 && legacy.style === 4,
     "纯 legacy 形状（length 2 / thk 0.5 / gap -2.2 / style 4）");
  const code = CS.encodeLegacy(legacy);
  ok(/^CSGO(-?[A-Za-z0-9]{5}){5}$/.test(code), "legacy 码格式正确");
  const rt = CS.decodeLegacy(code);
  ok(rt.length === 2 && rt.thickness === 0.5 && rt.gap === -2.2 && rt.style === 4, "legacy round-trip 无损");
  const conv = CS.decodeInfo(code, { screenHeight: 1080 });
  // R3 已裁决（2026-10-16 离线实验）：新 gap 从屏幕中心起算，迁移补 ceil(f/2)。
  // 本样本：旧 gap -2.2 → 边沿间隙 1px，臂厚 1px → 新 gap = 1 + 1 = 2px
  ok(conv.model.style === 4 && conv.model.gap === 2 && conv.model.length === 4 && conv.model.thickness === 1 &&
     conv.model.green === 255 && conv.model.alpha === 200 && conv.model.outlineMode === 1,
     "转换到新模型：style4 gap2px(1+ceil(1/2)) len4px thk1px 绿 alpha200 全描边");
}

/* ---------- ⑤ 样式文本映射全覆盖（10 个样式 + 站点别名） ---------- */
console.log("\n⑤ 样式文本映射");
{
  const cases = [
    ["Dynamic Cross", 0], ["Dynamic Circle", 1], ["Dynamic Cross (Legacy)", 2], ["Classic", 2],
    ["Static Circle", 3], ["Static Cross", 4], ["Classic Static", 4], ["Static Cross (Shot Feedback)", 5],
    ["Dot Only", 6], ["Dynamic Quad", 7], ["Dynamic Quadrant", 7], ["Static Square", 8],
    ["Static Quad", 9], ["Static Quadrant", 9],
  ];
  let bad = [];
  for (const [text, want] of cases) {
    const m = PS.fieldsToModelNew({ "cl_crosshairstyle": text });
    if (m.style !== want) bad.push(text + "→" + m.style + "(want " + want + ")");
  }
  ok(bad.length === 0, "14 种样式文本（含别名）全部映射正确" + (bad.length ? " · " + bad.join("; ") : ""));
  // 数字兜底
  ok(PS.fieldsToModelNew({ "cl_crosshairstyle": "7" }).style === 7, "数字样式名兜底（'7'→7）");
  // 未知文本记入 UNKNOWN_STYLES 且不猜（保持默认 4）
  const before = PS.UNKNOWN_STYLES.size;
  const m = PS.fieldsToModelNew({ "cl_crosshairstyle": "Wat Is This" });
  ok(m.style === 4 && PS.UNKNOWN_STYLES.size === before + 1, "未知样式文本：保持默认 4 并记录待反馈");
}

console.log("\n" + (fail === 0 ? "✓ 全部通过" : "✗ 有失败项") + " · " + pass + " pass / " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
