/* =========================================================================
 * prosettings-parse.js — prosettings.net 页面解析（新旧准星系统双格式）
 *
 * 抽出来给 auto-update.js / check-freshness.js 共用，避免两处解析逻辑漂移。
 *
 * 页面事实（2026-10-16 实测）：
 *   · 站点已完成新准星系统迁移：准星表给新 convar 名 + 文本值
 *     （cl_crosshairstyle = "Static Cross"、布尔 = "Yes"/"No"、数值直接给像素），
 *     且**不再提供分享码** —— 由调用方组装成 CrosshairV2 模型后生成 cs2-v1 码；
 *   · 旧格式页面（过渡期残留）仍是旧 convar 名 + 旧刻度，走 legacy 编码 + 有损转换；
 *   · 历史 API（crosshair-pipeline/history）每条带 legacy 标记，CSGO- 旧码与 CS 新码混合。
 * ========================================================================= */
"use strict";

const path = require("path");
const CS = require(path.join(__dirname, "..", "js", "codec.js"));

/* 站点样式文本 → 新编号（0-9）。站点文案不完全统一（见过 "Classic Static" 别名），
 * 做归一化匹配 + 数字兜底；匹配不到的记入 UNKNOWN_STYLES，由调用方进报告，不猜。 */
const NEW_STYLE_MAP = {
  "dynamic cross": 0,
  "dynamic circle": 1,
  "dynamic cross (legacy)": 2,
  "dynamic cross (classic)": 2,
  classic: 2,
  "static circle": 3,
  "static cross": 4,
  "classic static": 4,
  "static cross (shot feedback)": 5,
  "dynamic cross (legacy/shot feedback)": 5,
  "dynamic cross (legacy) / shot feedback": 5,
  "legacy": 5,
  "dot only": 6,
  "dynamic quad": 7,
  "dynamic quadrant": 7,
  "static square": 8,
  "static quad": 9,
  "static quadrant": 9,
};
const UNKNOWN_STYLES = new Set();
const UNKNOWN_OUTLINES = new Set();

function normStyleText(v) {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
}
function outlineFromText(v) {
  const t = String(v == null ? "" : v).trim().toLowerCase();
  if (t === "") return null;
  if (t === "no" || t === "none" || t === "off" || t === "0" || t === "false") return 0;
  if (t === "half") return 2;
  if (t === "full" || t === "yes" || t === "on" || t === "1" || t === "true") return 1;
  UNKNOWN_OUTLINES.add(t); // 不猜：未知文本记下来，由调用方进报告
  return null;
}
// 出现任一新 convar 名即判定为新格式页面
function isNewFormatFields(f) {
  return !!(f["cl_crosshair_length"] || f["cl_crosshair_screen_height"] ||
    f["cl_crosshairoutline_r"] || f["cl_ironsight_dot_scale"]);
}
// 新格式字段 → CrosshairV2 模型（像素刻度，无换算）
function fieldsToModelNew(f) {
  const m = CS.defaultModel();
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const bool = (v) => {
    const t = String(v == null ? "" : v).trim().toLowerCase();
    return t === "yes" || t === "1" || t === "true" || t === "on";
  };
  const st = normStyleText(f["cl_crosshairstyle"]);
  if (st in NEW_STYLE_MAP) m.style = NEW_STYLE_MAP[st];
  else if (/^\d+$/.test(st)) m.style = Math.max(0, Math.min(9, parseInt(st, 10)));
  else if (st !== "") UNKNOWN_STYLES.add(st);
  m.length = num(f["cl_crosshair_length"], m.length);
  m.thickness = num(f["cl_crosshair_thickness"], m.thickness);
  m.gap = num(f["cl_crosshair_gap"], m.gap);
  m.red = num(f["cl_crosshaircolor_r"], m.red) | 0;
  m.green = num(f["cl_crosshaircolor_g"], m.green) | 0;
  m.blue = num(f["cl_crosshaircolor_b"], m.blue) | 0;
  m.alpha = num(f["cl_crosshaircolor_a"], m.alpha) | 0;
  m.outlineRed = num(f["cl_crosshairoutline_r"], 0) | 0;
  m.outlineGreen = num(f["cl_crosshairoutline_g"], 0) | 0;
  m.outlineBlue = num(f["cl_crosshairoutline_b"], 0) | 0;
  m.outlineAlpha = num(f["cl_crosshairoutline_a"], 255) | 0;
  const ol = outlineFromText(f["cl_crosshair_drawoutline"]);
  if (ol !== null) m.outlineMode = ol;
  m.centerDotEnabled = bool(f["cl_crosshairdot"]);
  m.tStyleEnabled = bool(f["cl_crosshair_t"]);
  m.followRecoil = bool(f["cl_crosshair_recoil"]);
  m.dynamicSpreadLimit = num(f["cl_crosshair_dynamic_spread_limit"], m.dynamicSpreadLimit);
  m.splitDistance = num(f["cl_crosshair_dynamic_splitdist"], m.splitDistance);
  m.innerSplitAlpha = num(f["cl_crosshair_dynamic_splitalpha_innermod"], m.innerSplitAlpha);
  m.outerSplitAlpha = num(f["cl_crosshair_dynamic_splitalpha_outermod"], m.outerSplitAlpha);
  m.splitSizeRatio = num(f["cl_crosshair_dynamic_maxdist_splitratio"], m.splitSizeRatio);
  m.screenHeight = num(f["cl_crosshair_screen_height"], m.screenHeight);
  m.scopeDotScale = num(f["cl_ironsight_dot_scale"], m.scopeDotScale);
  m.scopeDotUseCrosshairColor = bool(f["cl_ironsight_usecrosshaircolor"]);
  m.sniperWidth = num(f["cl_crosshair_sniper_width"], 0);
  return m;
}

/* ---------------- 旧格式字段（站点过渡期残留页面用） ----------------
 * 旧 convar 名 + 旧刻度 → **纯 legacy 形状**的设置对象（供 CS.encodeLegacy）。
 * 注意：不能基于 CS.defaultSettings() 拼装——那是新像素模型的默认值，
 * 页面缺字段时会把新默认值（如 length 11px）混进旧刻度编码，产生错误旧码。
 * 这里的默认值取自重构前的 legacy-v1 默认准星。 */
function fieldsToLegacySettings(f) {
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const bool = (v) => {
    const t = String(v == null ? "" : v).toLowerCase();
    return t === "yes" || t === "1" || t === "true";
  };
  const LEGACY_STYLE_MAP = {
    classic: 2, "classic static": 4, legacy: 5,
    "default dynamic": 0, "default static": 1, "classic dynamic": 3,
  };
  const COLOR_MAP = { red: 0, green: 1, yellow: 2, blue: 3, cyan: 4 };
  const s = {
    style: 4, centerDotEnabled: false, length: 5, thickness: 1, gap: 3,
    outlineEnabled: false, outline: 0.5, red: 0, green: 255, blue: 0,
    alphaEnabled: true, alpha: 200, tStyleEnabled: false, followRecoil: false,
    fixedCrosshairGap: 0, innerSplitAlpha: 1, outerSplitAlpha: 0.5, splitSizeRatio: 1,
    splitDistance: 7, deployedWeaponGapEnabled: false, color: 1,
  };
  const style = String(f["cl_crosshairstyle"] || "").toLowerCase();
  s.style = style in LEGACY_STYLE_MAP ? LEGACY_STYLE_MAP[style] : 4;
  s.length = num(f["cl_crosshairsize"], 5);
  s.thickness = num(f["cl_crosshairthickness"], 1);
  s.gap = num(f["cl_crosshairgap"], 3);
  s.outlineEnabled = bool(f["cl_crosshair_drawoutline"]);
  s.outline = num(f["cl_crosshair_outlinethickness"], 1);
  s.centerDotEnabled = bool(f["cl_crosshairdot"]);
  s.tStyleEnabled = bool(f["cl_crosshair_t"]);
  s.followRecoil = bool(f["cl_crosshair_recoil"]);
  s.deployedWeaponGapEnabled = bool(f["cl_crosshairgap_useweaponvalue"]);
  s.alphaEnabled = bool(f["cl_crosshairusealpha"]);
  s.alpha = num(f["cl_crosshairalpha"], 255);
  const colorName = String(f["cl_crosshaircolor"] || "").toLowerCase();
  if (colorName in COLOR_MAP) {
    s.color = COLOR_MAP[colorName];
    const p = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 255, 255]][s.color];
    s.red = p[0]; s.green = p[1]; s.blue = p[2];
  } else {
    s.color = 5;
    s.red = num(f["cl_crosshaircolor_r"], 0) | 0;
    s.green = num(f["cl_crosshaircolor_g"], 255) | 0;
    s.blue = num(f["cl_crosshaircolor_b"], 0) | 0;
  }
  s.fixedCrosshairGap = num(f["cl_fixedcrosshairgap"], 0);
  s.splitDistance = num(f["cl_crosshair_dynamic_splitdist"], 7);
  s.innerSplitAlpha = num(f["cl_crosshair_dynamic_splitalpha_innermod"], 1);
  s.outerSplitAlpha = num(f["cl_crosshair_dynamic_splitalpha_outermod"], 0.5);
  s.splitSizeRatio = num(f["cl_crosshair_dynamic_maxdist_splitratio"], 1);
  ["length", "thickness", "gap", "fixedCrosshairGap"].forEach((k) => (s[k] = Math.round(s[k] * 10) / 10));
  ["innerSplitAlpha", "outerSplitAlpha", "splitSizeRatio"].forEach((k) => (s[k] = Math.round(s[k] * 10) / 10));
  return s;
}

/* ---------------- HTML 解析 ---------------- */
function stripTags(s) { return String(s == null ? "" : s).replace(/<[^>]*>/g, "").trim(); }

// 准星表 data-field 行 → { convar 名: 文本值 }（新旧字段名都抓）
function parseCrosshairFields(html) {
  const out = {};
  const re = /<tr[^>]*data-field="(cl_[a-z0-9_]+)"[^>]*>\s*<th>[^<]*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = stripTags(m[2]);
  return out;
}
// 官方渲染矩形（cs2-crosshair-svg，[x,y,w,h,r,g,b,a]）
function parseCrosshairRects(html) {
  const rects = [];
  const i = html.indexOf("cs2-crosshair-svg");
  if (i < 0) return rects;
  const seg = html.slice(i, i + 6000);
  const re = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="rgb\((\d+),(\d+),(\d+)\)"(?:\s*fill-opacity="([\d.]+)")?\s*\/>/g;
  let m;
  while ((m = re.exec(seg))) {
    rects.push([+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], +m[7], m[8] == null ? 1 : +m[8]]);
  }
  return rects;
}
// 通用 data-field 取值（parseInfo 用）
function fieldOf(html, name) {
  const m = html.match(new RegExp('<tr[^>]*data-field="' + name + '"[^>]*>\\s*<th>[^<]*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>'));
  return m ? stripTags(m[1]) : "";
}
// "1280x960" → 960（旧码换算的参考屏幕高度）
function resHeight(info) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String((info && info.res) || ""));
  return m ? Number(m[2]) : 1080;
}

module.exports = {
  CS,
  NEW_STYLE_MAP,
  UNKNOWN_STYLES,
  UNKNOWN_OUTLINES,
  normStyleText,
  outlineFromText,
  isNewFormatFields,
  fieldsToModelNew,
  fieldsToLegacySettings,
  parseCrosshairFields,
  parseCrosshairRects,
  fieldOf,
  stripTags,
  resHeight,
};
