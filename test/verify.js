/* =========================================================================
 * verify.js — 渲染器验证（Phase 3 验收）
 *
 * 三层证据：
 *   A. 旧渲染器逐像素对拍：legacy-v1 码 → 迁移成新模型 → 新渲染器
 *      必须与「cs2util 官方移植渲染器」在同一批旧参数下逐像素一致。
 *      这是「迁移不改变观感」的直接证据。
 *   B. 官方矩形回归：职业选手的 prosettings 官方矩形 (f,b,x) 与模型互洽——
 *      legacy 源页面按「边沿起算 + ceil(f/2)」、新格式页面按「中心起算」（R3 已裁决）。
 *   C. 新系统自洽断言：10 样式、开火行为、半描边只描左上、分辨率缩放、
 *      分享码往返、渲染冒烟。
 *
 * 用法: node test/verify.js
 * ========================================================================= */
"use strict";
global.window = globalThis;
const fs = require("fs");
const vm = require("vm");
const CS = require("../js/codec.js");

const { makeCtx, rasterize, normTag, diffMaps } = require("./lib/rasterize.js");

/* ---------------- cs2util 官方移植渲染器（旧系统真源） ----------------
 * 内部 style 编号 ≠ 游戏 cl_crosshairstyle：
 *   分支条件是「2 !== t.style」，只认分享码里的原始数值。
 */
function cs2utilDraw(a, t, r) {
  const n = 800, i = 800;
  a.clearRect(0, 0, n, i);
  let s = 400, h = 400;
  a.save();
  let d = { enabled: t.outlineEnabled, value: t.outline };
  let u = Math.max(1, Math.floor(d.value));
  let p = { xy: 0.5 * u, wh: +u };
  let g = (t.alphaEnabled ? t.alpha : 255) / 255;
  a.fillStyle = "rgba(" + t.red + ", " + t.green + ", " + t.blue + ", " + g + ")";
  a.strokeStyle = "#000";
  a.lineWidth = u;
  a.globalAlpha = 1;
  let f = Math.max(1, Math.floor((t.thickness + 0.2222) / 0.4444));
  let b = Math.floor((t.length + 0.2222) / 0.4445);
  let y = s - Math.floor(f / 2);
  let w = h - Math.floor(f / 2);
  let x = (t.gap < 0 ? -Math.floor(-t.gap) : Math.floor(t.gap)) + 4;
  if (2 !== t.style || r) {
    x = (t.gap < -4 ? -Math.floor(-t.gap) : Math.floor(t.gap)) + 4;
    if (r && t.deployedWeaponGapEnabled) x += 3;
  } else x += 1;
  a.beginPath();
  let _ = [];
  _.push({ x: y + f + x, y: w, width: b, height: f });
  _.push({ x: y - x - b, y: w, width: b, height: f });
  if (!t.tStyleEnabled) _.push({ x: y, y: w - x - b, width: f, height: b });
  _.push({ x: y, y: w + f + x, width: f, height: b });
  if (t.centerDotEnabled) _.push({ x: y, y: w, width: f, height: f });
  _ = _.filter((e) => e.width > 0 && e.height > 0);
  _.forEach((e) => { a.rect(e.x, e.y, e.width, e.height); });
  a.fill();
  if (d.enabled && 0 !== d.value) {
    a.beginPath();
    if (d.value < 1) {
      _.forEach((e) => { a.moveTo(e.x - p.xy, e.y + e.height); a.lineTo(e.x - p.xy, e.y - p.xy); a.lineTo(e.x + e.width, e.y - p.xy); });
    } else {
      _.forEach((e) => { a.rect(e.x - p.xy, e.y - p.xy, e.width + p.wh, e.height + p.wh); });
    }
    a.stroke();
  }
  a.restore();
}

function oursDraw(a, model, recoil) {
  CS.renderOpsSnapped(a, CS.buildDrawOps(model, { recoil: !!recoil }), 400, 400, 1);
}

/* ---------------- 数据 ---------------- */
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + "/../js/players.js", "utf8"), ctx);
const PROS = ctx.window.PRO_PLAYERS;
const ALL_CODES = [];
for (const p of PROS) {
  // 当前准星优先 c2（新格式页面直接生成）；旧格式页面只有 c（legacy，走迁移）
  const cur = p.c2 || p.c;
  if (cur) ALL_CODES.push({ who: p.n, code: cur });
  for (const hh of (p.h || [])) if (hh.c) ALL_CODES.push({ who: p.n, code: hh.c });
}
const LEGACY_CODES = ALL_CODES.filter((it) => /^CSGO-/.test(it.code));
const CS2_CODES = ALL_CODES.filter((it) => /^CS[A-Za-z0-9]{43,44}$/.test(it.code));

let fail = 0;
function ok(cond, msg) { if (!cond) { fail++; console.log("  ✗ " + msg); } }

/* ============ A. 迁移保真：legacy 码度量 == 旧公式；cs2 码必须 fixpoint ============ */
console.log("\n① 迁移保真（legacy " + LEGACY_CODES.length + " 条度量一致 / cs2 " + CS2_CODES.length + " 条往返 fixpoint）");let mA = 0, mAbad = 0, fxOk = 0, fxBad = 0;
for (const { code } of LEGACY_CODES) {
  const info = CS.decodeInfo(code);
  const m = CS.crosshairMetrics(info.model, { viewHeight: info.model.screenHeight });
  const sc = info.migration.scale;
  // 渲染内部 x = model.gap - ceil(f/2)；迁移取 gap = x_old + ceil(f/2)（候选 B），
  // 因此 x 回到 x_old——与旧公式逐字段一致正是迁移保真的证明。
  if (m.f === sc.f && m.b === sc.b && m.x === sc.x) mA++;
  else { mAbad++; if (mAbad < 4) console.log("  ✗ ", code, "新", JSON.stringify({ f: m.f, b: m.b, x: m.x }), "旧", JSON.stringify(sc)); }
}
for (const { code } of CS2_CODES) {
  const a = CS.decodeInfo(code).model;
  const b = CS.decodeShareCode(CS.encodeShareCode(a));
  if (JSON.stringify(a) === JSON.stringify(b)) fxOk++;
  else { fxBad++; if (fxBad < 4) console.log("  ✗ " + code + " 往返不一致"); }
}
console.log("  legacy " + mA + "/" + LEGACY_CODES.length + " 条迁移后度量与旧公式一致；cs2 " + fxOk + "/" + CS2_CODES.length + " 条精确往返");
ok(mAbad === 0, "legacy 码迁移后像素度量必须与旧公式一致");
ok(fxBad === 0, "cs2 码必须 decode→encode→decode 精确往返");

/* ============ B. 逐像素对拍（cs2util 官方移植） ============ */
console.log("\n② 逐像素对拍（legacy-v1 迁移路径 vs cs2util 官方移植）");
const GAPS = [-5, -4.9, -4.4, -4, -3.7, -2.7, -2, -1, -0.4, 0, 0.3, 1, 2.6, 3, 4.2, 5];
const LENS = [0, 0.2, 0.4, 1, 1.6, 2, 3.3, 5, 7.8, 10, 15];
const THKS = [0, 0.2, 0.4, 0.5, 0.6, 1, 1.4, 1.5, 2, 2.6, 3.1, 6];
const OUTS = [0.5, 1]; // ≥1.5 时新系统描边宽度固定 1px，属已知有损，不参与像素对拍
const LEGACY_STYLES = [0, 1, 2, 3, 4, 5];
const R = (a) => a[Math.floor(Math.random() * a.length)];
let passB = 0, badB = 0;
// 旧解码器会把颜色预设索引展开成 RGB，索引 6/7 回落为绿色；对拍必须复现这一步
const OLD_PALETTE = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 255, 255]];
function portFromLegacy(v1) {
  const rgb = v1.color === 5 ? [v1.red, v1.green, v1.blue] : (OLD_PALETTE[v1.color] || [0, 255, 0]);
  return Object.assign({}, v1, {
    style: v1.style === 2 ? 2 : 0,
    red: rgb[0], green: rgb[1], blue: rgb[2],
    alpha: v1.alphaEnabled ? v1.alpha : 255, alphaEnabled: true,
  });
}
function compareLegacy(v1, label) {
  const port = portFromLegacy(v1);
  const model = CS.convertToModel(v1);
  const A = makeCtx(); cs2utilDraw(A, port, false);
  const B = makeCtx(); oursDraw(B, model, false);
  const d = diffMaps(rasterize(A), rasterize(B));
  if (d.diffs) {
    badB++;
    if (badB < 6) console.log("  ✗ " + label + " diffs=" + d.diffs + " " + JSON.stringify(v1) + " → " + JSON.stringify(d.first));
    return false;
  }
  passB++;
  return true;
}
for (const style of LEGACY_STYLES) {
  for (const gap of GAPS) {
    for (const length of LENS) {
      for (const thickness of THKS) {
        for (const outlineEnabled of [false, true]) {
          for (const outline of outlineEnabled ? OUTS : [0]) {
            compareLegacy({ format: "legacy-v1", style: style, gap: gap, length: length, thickness: thickness,
              outlineEnabled: outlineEnabled, outline: outline,
              fixedCrosshairGap: 0, red: 0, green: 255, blue: 0, alpha: 200, alphaEnabled: true,
              color: 1, centerDotEnabled: false, tStyleEnabled: false, followRecoil: false,
              deployedWeaponGapEnabled: false, innerSplitAlpha: 1, outerSplitAlpha: 0.5,
              splitSizeRatio: 1, splitDistance: 7 }, "grid");
          }
        }
      }
    }
  }
}
for (let i = 0; i < 1500; i++) {
  compareLegacy({
    format: "legacy-v1", style: R(LEGACY_STYLES), gap: R(GAPS), length: R(LENS), thickness: R(THKS),
    outlineEnabled: Math.random() < 0.5, outline: R(OUTS),
    fixedCrosshairGap: 0, color: R([0, 1, 2, 3, 4, 5]),
    red: R([0, 255, 128]), green: R([0, 255, 128]), blue: R([0, 255, 128]),
    alpha: Math.floor(Math.random() * 256), alphaEnabled: Math.random() < 0.5,
    centerDotEnabled: Math.random() < 0.5, tStyleEnabled: Math.random() < 0.4,
    followRecoil: false, deployedWeaponGapEnabled: false,
    innerSplitAlpha: 1, outerSplitAlpha: 0.5, splitSizeRatio: 1, splitDistance: 7,
  }, "rand");
}
console.log("  " + passB + " PASS / " + badB + " FAIL");
ok(badB === 0, "旧码迁移后必须与官方移植渲染器逐像素一致");

let realPx = 0, realBad = 0, realSkip = 0;
for (const item of ALL_CODES) {
  // 本节只对 legacy 旧码做「迁移后 vs 官方移植」逐像素对拍；cs2 新码不适用（无旧渲染器）
  if (!/^CSGO-/.test(item.code)) { realSkip++; continue; }
  let info;
  try { info = CS.decodeInfo(item.code); } catch (e) { realSkip++; continue; }
  const v1 = require("../js/core-legacy.js").decode(item.code);
  if (v1.outlineEnabled && v1.outline >= 1.5) { realSkip++; continue; }
  const A = makeCtx(); cs2utilDraw(A, portFromLegacy(v1), false);
  const B = makeCtx(); oursDraw(B, info.model, false);
  const d = diffMaps(rasterize(A), rasterize(B));
  if (d.diffs) { realBad++; if (realBad < 5) console.log("  ✗ 真实码 " + item.who + " " + item.code + " diffs=" + d.diffs); }
  else realPx++;
}
console.log("  全库真实旧码 " + realPx + " 一致 / " + realBad + " 不一致 / " + realSkip + " 跳过（cs2 新码与描边≥1.5 已知有损）");
ok(realBad === 0, "全库真实旧码迁移后逐像素一致");

/* ============ C. 官方矩形回归 ============ */
console.log("\n③ 官方矩形回归（prosettings 官方 rects）");
const CTR = 25;
function rectToMetrics(rects) {
  if (!rects || rects.length < 4) return null;
  const Rr = rects[0], Lf = rects[1], Tp = rects[2], Bt = rects[3];
  if (!Rr || !Lf || !Tp || !Bt) return null;
  const f = Rr[3], b = Rr[2];
  if (Tp[2] !== f || Bt[2] !== f || Tp[3] !== b || Bt[3] !== b) return null;
  const off = -Math.floor(f / 2);
  const x = Rr[0] - CTR - off - f;
  if (Lf[0] !== CTR + off - x - b) return null;
  if (Tp[1] !== CTR + off - x - b) return null;
  if (Bt[1] !== CTR + off + f + x) return null;
  return { f: f, b: b, x: x };
}
let offOk = 0, offBad = 0, offSkip = 0;
for (const p of PROS) {
  // legacy 源页面（有 p.c）：站点矩形是旧渲染器（边沿起算）。
  // 渲染内部 x = gap - ceil(f/2)，迁移后回到旧公式的 x，与站点矩形逐字段相等。
  const d = rectToMetrics(p.x);
  if (!d || !p.c) { offSkip++; continue; }
  let info; try { info = CS.decodeInfo(p.c); } catch (e) { offSkip++; continue; }
  const m = CS.crosshairMetrics(info.model, { viewHeight: info.model.screenHeight });
  if (m.f === d.f && m.b === d.b && m.x === d.x) offOk++;
  else { offBad++; if (offBad < 6) console.log("  ✗ " + p.n + " 官方 " + JSON.stringify(d) + " 本站 " + JSON.stringify({ f: m.f, b: m.b, x: m.x })); }
}
console.log("  legacy 源页面 " + offOk + " 一致 / " + offBad + " 不一致 / " + offSkip + " 跳过（新格式页面与无矩形）");
ok(offBad === 0, "官方矩形回归（legacy 源页面）必须全部一致");

/* ============ C2. 新格式页面：中心起算锚点回归（R3 裁决的固化） ============ */
// 2026-10-16 离线实验：模型 gap 是中心起算（游戏语义），渲染内部转成 x = gap - ceil(f/2)。
// 站点新格式页面的矩形按旧公式解读出的 x 应恰好等于该值（即站点几何 ≡ 旧公式取 x'=gap-ceil(f/2)）。
// 站点存在少量渲染离群（实测约 1-2%），按比例断言而非逐条。
console.log("\n③b 新格式页面中心起算回归（R3）");
let nfOk = 0, nfBad = 0, nfSkip = 0;
for (const p of PROS) {
  const d = rectToMetrics(p.x);
  if (!d || !p.c2 || !p.m || p.m.from !== "prosettings") { nfSkip++; continue; }
  let info; try { info = CS.decodeInfo(p.c2); } catch (e) { nfSkip++; continue; }
  const m = CS.crosshairMetrics(info.model, { viewHeight: info.model.screenHeight });
  if (m.f === d.f && m.b === d.b && m.x === d.x) nfOk++;
  else { nfBad++; if (nfBad < 6) console.log("  · 离群 " + p.n + " 官方 " + JSON.stringify(d) + " 本站 x=" + m.x); }
}
const nfTotal = nfOk + nfBad;
console.log("  " + nfOk + "/" + nfTotal + " 命中（跳过 " + nfSkip + "）");
ok(nfTotal > 50 && nfOk / nfTotal >= 0.9, "新格式页面矩形必须绝大多数命中「x = gap - ceil(f/2)」（站点离群容忍 10%）");

/* ============ D. 静态样式开火不变 ============ */
console.log("\n④ 静态样式开火不变");
let stOk = 0, stBad = 0;
for (const style of [3, 4, 6, 8, 9]) {
  for (let i = 0; i < 60; i++) {
    const m = CS.normalizeModel({ style: style, gap: R([0, 3, 8, 20]), length: R([2, 8, 20]), thickness: R([1, 2, 5]),
      centerDotEnabled: Math.random() < 0.5, tStyleEnabled: Math.random() < 0.4, followRecoil: Math.random() < 0.5,
      outlineMode: R([0, 1, 2]) });
    const A = makeCtx(); oursDraw(A, m, false);
    const B = makeCtx(); oursDraw(B, m, true);
    if (JSON.stringify([...rasterize(A)].sort()) === JSON.stringify([...rasterize(B)].sort())) stOk++;
    else { stBad++; if (stBad < 3) console.log("  ✗ 静态样式开火后变化了: " + JSON.stringify(m)); }
  }
}
console.log("  " + stOk + " 通过 / " + stBad + " 失败");
ok(stBad === 0, "静态样式开火不得变化");

/* ============ E. style 2 开火分裂（游戏 0xDA66C0 实读） ============ */
/* 反汇编语义（tools/re/CROSSHAIR-REVERSE.md）：
 *   - 只有 style 2 是双套臂；style 5 是单套臂（0xDA6B60），不分裂。
 *   - 内臂：gap = gap + min(R, splitdist)，长度 = ceil((1 - splitSizeRatio) * length)
 *   - 外臂：gap = gap + R（R = t·focal），长度 = |length * splitSizeRatio|
 *   - splitdist 与 gapUnit 同一套 480p 单位，换算到当前高度 × H/480
 *   - innerSplitAlpha 是「内臂隐藏度」：1 = 内臂完全隐藏；outerSplitAlpha 乘外臂。 */
console.log("\n⑤ style 2 开火分裂（双套臂，长度按 splitSizeRatio 切段）");
let spOk = 0, spBad = 0;
const spAssert = (c, msg) => { if (c) spOk++; else { spBad++; console.log("  ✗ " + msg); } };
const clamp01v = (v) => Math.min(1, Math.max(0, v));
for (let i = 0; i < 200; i++) {
  const m = CS.normalizeModel({ style: 2, gap: R([-3, 0, 3, 8]), length: R([8, 14, 20]), thickness: R([1, 2, 4]),
    centerDotEnabled: Math.random() < 0.5, tStyleEnabled: Math.random() < 0.4,
    splitDistance: Math.floor(Math.random() * 40), splitSizeRatio: R([0, 0.3, 0.5, 0.7, 1]),
    innerSplitAlpha: R([0, 0.5, 1]), outerSplitAlpha: R([0.3, 0.5, 1]), followRecoil: Math.random() < 0.5 });
  const g = CS.crosshairRects(m, { recoil: true });
  const armCount = m.tStyleEnabled ? 3 : 4;
  const innerMul = 1 - clamp01v(m.innerSplitAlpha);
  const wantDot = m.centerDotEnabled ? 1 : 0;
  const ratio = clamp01v(m.splitSizeRatio);
  const innerLen = Math.ceil((1 - ratio) * g.b);
  const outerLen = Math.round(Math.abs(g.b * ratio));
  const wantInner = innerMul > 0.01 && innerLen > 0 ? 1 : 0;
  const wantOuter = outerLen > 0 ? 1 : 0;

  spAssert(g.split === true, "style 2 应标记 split");
  spAssert(g.layers.length === wantDot + wantInner + wantOuter, "层数 = 中心点 + 内臂 + 外臂");

  const outer = wantOuter ? g.layers[g.layers.length - 1] : null;
  if (outer) {
    spAssert(Math.abs(outer.mul - clamp01v(m.outerSplitAlpha)) < 1e-9, "外层乘数 = outerSplitAlpha");
    spAssert(outer.rects.length === armCount, "外层臂数");
    for (const r of outer.rects) {
      const len = (r.w === g.f) ? r.h : r.w;   // 竖直臂 w=f，水平臂 h=f
      spAssert(len === outerLen, "外臂长度 = |length × splitSizeRatio|");
    }
  }

  if (wantDot) {
    const dot = g.layers[0];
    spAssert(dot.rects.length === 1 && dot.rects[0].w === g.f && dot.rects[0].h === g.f, "中心点层");
  }
  if (wantInner && outer) {
    const inner = g.layers[wantDot];
    spAssert(Math.abs(inner.mul - innerMul) < 1e-9, "内层乘数 = 1 - innerSplitAlpha");
    spAssert(inner.rects.length === armCount, "内层臂数");
    for (const r of inner.rects) {
      const len = (r.w === g.f) ? r.h : r.w;
      spAssert(len === innerLen, "内臂长度 = ceil((1 - splitSizeRatio) × length)");
    }
    const ri = inner.rects[0], ro = outer.rects[0];
    // 游戏 0xda67xx：内臂推进 min(半径, splitdist)，外臂推进完整半径 R；
    // 所以两层起点差 = max(0, R - splitdist 换算值)。
    spAssert(ro.x - ri.x === Math.max(0, g.spread - g.splitPx), "外臂推进 R、内臂被 splitdist 截断");
  }
  spAssert(CS.crosshairRects(m, { recoil: false }).layers.length === 1, "静止应为单层");
  spAssert((g.dy < 0) === !!m.followRecoil, "followRecoil 位移");
}
console.log("  " + spOk + " 断言通过 / " + spBad + " 失败");
ok(spBad === 0, "style 2 开火分裂行为");

/* style 5 必须和 style 4 一样是单套臂（游戏 0xDA6B60 只调一次 ARMS），
 * 但臂根半径按开火反馈量 k 外推：r = round(max(0,gap) + H × k / 1200)，k ∈ [0,25]。 */
{
  const base = { gap: 6, length: 20, thickness: 2, splitDistance: 10, innerSplitAlpha: 0, outerSplitAlpha: 1, splitSizeRatio: 0.5, screenHeight: 1080 };
  for (const sp of [0, 0.5, 1]) {
    const a = CS.crosshairRects(CS.normalizeModel({ ...base, style: 5 }), { spread01: sp });
    ok(a.layers.length === 1 && a.split === false, "style 5 不分裂（spread01=" + sp + "）");
  }
  const fb0 = CS.crosshairMetrics(CS.normalizeModel({ ...base, style: 5 }), { spread01: 0 });
  const fb1 = CS.crosshairMetrics(CS.normalizeModel({ ...base, style: 5 }), { spread01: 1 });
  ok(fb0.shotR === 6 && fb0.shotK === 0, "style 5 静止时臂根 = gap（k=0）");
  ok(fb1.shotK === 25 && fb1.shotR === 6 + Math.round(1080 * 25 / 1200),
    "style 5 满量 k=25 → +H×25/1200 px（1080p = +23）");
  ok(fb1.shotR === 29, "style 5 满量臂根 = 29（gap 6 + 23）");
  const fb720 = CS.crosshairMetrics(CS.normalizeModel({ ...base, style: 5, screenHeight: 720 }), { spread01: 1 });
  ok(fb720.shotR === 6 + Math.round(720 * 25 / 1200), "style 5 外推量随屏幕高度线性（720p = +15）");
  const arms1 = CS.crosshairRects(CS.normalizeModel({ ...base, style: 5 }), { spread01: 1 }).layers[0].rects;
  ok(arms1[0].x === fb1.shotR, "style 5 右臂内沿落在 shotR 上");
  ok(CS.crosshairRects(CS.normalizeModel({ ...base, style: 5 }), { spread01: 0 }).layers[0].rects[0].x === 6,
    "style 5 静止时右臂内沿 = gap（与 style 4 同形）");
  const r0 = JSON.stringify(CS.crosshairRects(CS.normalizeModel({ ...base, style: 2, splitSizeRatio: 0 }), { recoil: true }).layers);
  const r1 = JSON.stringify(CS.crosshairRects(CS.normalizeModel({ ...base, style: 2, splitSizeRatio: 1 }), { recoil: true }).layers);
  ok(r0 !== r1, "splitSizeRatio 参与 style 2 几何（游戏 0xDA66C0 按比例切臂长）");
}

/* ============ F. 半描边只描左上 ============ */
console.log("\n⑥ 半描边（outlineMode 2）只描左上");
function outlineCells(mode) {
  const ops = {
    layers: [{ mul: 1, rects: [{ x: 0, y: 0, w: 10, h: 10 }], rings: [] }],
    rgb: "0,255,0", alpha: 1, dy: 0,
    outlineEnabled: mode !== 0, outlineMode: mode, outlineRgb: "rgb(0,0,0)", outlineAlpha: 1, outlineWidth: 1,
  };
  const c = makeCtx();
  CS.renderOpsSnapped(c, ops, 100, 100, 1);
  return [...rasterize(c).keys()].map((k) => k.split(",").map(Number));
}
const none = outlineCells(0), half = outlineCells(2), full = outlineCells(1);
const hasCell = (arr, i, j) => arr.some((c) => c[0] === i && c[1] === j);
let halfOk = true;
for (const cell of half) {
  const i = cell[0], j = cell[1];
  const inside = i >= 100 && i <= 109 && j >= 100 && j <= 109;
  if (inside) continue;
  if (!(j === 99 || i === 99)) { halfOk = false; console.log("  ✗ 半描边出现在非左上位置: " + i + "," + j); }
}
ok(halfOk, "半描边只绘制左上两条边");
ok(half.length > none.length, "半描边必须比无描边多出像素（" + half.length + " > " + none.length + "）");
ok(full.length > half.length, "全描边必须比半描边多（" + full.length + " > " + half.length + "）");
ok(!hasCell(half, 110, 105) && !hasCell(half, 105, 110), "半描边不得含右/下边");
ok(hasCell(full, 110, 105) && hasCell(full, 105, 110), "全描边必须含右/下边");
console.log("  像素数 无=" + none.length + " 半=" + half.length + " 全=" + full.length);

/* ============ G. 分辨率缩放 ============ */
console.log("\n⑦ 分辨率缩放（游戏按 当前高度/记录高度 等比）");
const baseModel = CS.normalizeModel({ thickness: 2, length: 8, gap: 4, screenHeight: 1080, style: 4 });
const at1080 = CS.crosshairMetrics(baseModel, { viewHeight: 1080 });
const at720 = CS.crosshairMetrics(baseModel, { viewHeight: 720 });
const at2160 = CS.crosshairMetrics(baseModel, { viewHeight: 2160 });
ok(at1080.f === 2 && at1080.b === 8 && at1080.x === 3, "1080p 下 1:1（x = gap4 - ceil(2/2) = 3）");
ok(at720.b === 5 && at2160.b === 16, "720p→5 / 2160p→16");
ok(Math.abs(CS.displayScale(baseModel, { viewHeight: 720 }) - 2 / 3) < 1e-9, "缩放因子 720/1080");
console.log("  1080:", JSON.stringify({ f: at1080.f, b: at1080.b, x: at1080.x }), " 720:", JSON.stringify({ f: at720.f, b: at720.b, x: at720.x }), " 2160:", JSON.stringify({ f: at2160.f, b: at2160.b, x: at2160.x }));

/* ============ H. 10 样式渲染冒烟 ============ */
console.log("\n⑧ 10 样式渲染冒烟");
let styleOk = 0;
for (let style = 0; style <= 9; style++) {
  const m = CS.normalizeModel({ style: style, length: 8, thickness: 2, gap: 6, centerDotEnabled: true });
  const c = makeCtx();
  oursDraw(c, m, false);
  const g = CS.crosshairRects(m, { recoil: false });
  const n = g.layers.reduce((a, l) => a + l.rects.length + (l.rings || []).length + (l.arcs || []).length, 0);
  if (n > 0) styleOk++; else console.log("  ✗ style " + style + " 无几何");
  console.log("  style " + style + " " + CS.STYLE_NAMES[style] + "（" + CS.styleShape(style) + "）几何 " + n + " 项");
}
ok(styleOk === 10, "10 个样式都必须产生几何");

/* ============ I. 分享码往返（迁移后 → cs2） ============ */
console.log("\n⑨ 分享码往返（旧码 → 新模型 → cs2 码 → 新模型）");
let rt = 0, rtBad = 0;
const sig = (m) => JSON.stringify([m.style, m.thickness, m.length, m.gap, m.outlineMode, m.red, m.green, m.blue, m.alpha, m.screenHeight, m.scopeDotScale]);
for (const item of ALL_CODES) {
  try {
    const a = CS.decodeInfo(item.code).model;
    const b = CS.decodeShareCode(CS.encodeShareCode(a));
    if (sig(a) === sig(b)) rt++; else { rtBad++; if (rtBad < 4) console.log("  ✗ " + item.code + " " + sig(a) + " vs " + sig(b)); }
  } catch (e) { rtBad++; if (rtBad < 4) console.log("  ✗ " + item.code + " " + e.message); }
}
console.log("  " + rt + "/" + ALL_CODES.length + " 语义一致 / " + rtBad + " 不一致");
ok(rtBad === 0, "旧码迁移后必须能无损往返 cs2 容器");

/* ============ J. 渲染冒烟（全库） ============ */
console.log("\n⑩ 渲染冒烟");
let smoke = 0;
for (const item of ALL_CODES) {
  const m = CS.decodeShareCode(item.code);
  const c = makeCtx();
  oursDraw(c, m, false);
  // 判定用「几何项数（矩形 + 圆环）」而非光栅像素：测试桩的 rasterize 只处理矩形，
  // 圆/四分样式（1/3/7/9）的几何是 ring，桩光栅化不出来——这是桩的局限，不是产品缺陷
  // （真实 canvas 渲染走 render-canvas 的 ring 路径，见 test/check-page.js 的浏览器回归）。
  const g = CS.crosshairRects(m, { recoil: false });
  const n = g.layers.reduce((a, l) => a + l.rects.length + (l.rings || []).length + (l.arcs || []).length, 0);
  if (n > 0) smoke++;
}
console.log("  " + smoke + "/" + ALL_CODES.length + " 全部产生几何");
ok(smoke === ALL_CODES.length, "全库码都必须渲染出几何");

console.log("\n" + (fail ? "✗ 有 " + fail + " 项未通过" : "✓ 全部通过"));
process.exit(fail ? 1 : 0);
