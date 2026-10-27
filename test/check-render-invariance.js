/* =========================================================================
 * check-render-invariance.js — 渲染几何的分辨率 / 比例 / DPR 无关性（任务三验收）
 *
 * 核心定义：**几何的唯一真源是模型里的像素值 @ screenHeight**。
 *   canvas 尺寸 / devicePixelRatio / 窗口大小 / CSS 缩放 只影响「展示缩放」，
 *   绝不能反作用于 f/b/x 几何。
 *
 * 断言：
 *   ① 几何是模型的纯函数：绘制环境参数（画布宽高、DPR、画幅、zoom）不参与计算
 *   ② 整数倍展示缩放下，栅格恰好是 1 倍栅格的精确放大（逐格对应）
 *   ③ 分数 DPR 不产生形变（换算回游戏像素后与整数倍一致，容差 1 游戏像素）
 *   ④ 同一屏幕高度、不同画幅（16:9 / 4:3 / 21:9）几何完全相同
 *   ⑤ 高度缩放严格等于 viewHeight / screenHeight
 *   ⑥ canonical PNG 导出尺寸与窗口/DPR 无关（且不读取 window/document）
 *
 * 用法: node test/check-render-invariance.js
 * ========================================================================= */
"use strict";
const CS = require("../js/codec.js");
const { makeCtx, rasterize } = require("./lib/rasterize.js");

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("  ✗ " + msg); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- ① 几何是模型的纯函数 ---------- */
console.log("① 几何与绘制环境无关");
const model = CS.normalizeModel({ style: 2, thickness: 2, length: 10, gap: 5, centerDotEnabled: true,
  outlineMode: 1, splitDistance: 20, splitSizeRatio: 0.6, innerSplitAlpha: 0.7, outerSplitAlpha: 0.4 });
const g0 = CS.crosshairRects(model, { recoil: false, viewHeight: 1080 });
const g1 = CS.crosshairRects(model, { recoil: false, viewHeight: 1080 });
ok(eq(g0, g1), "重复调用结果完全相同");
// 传一堆与几何无关的环境参数，结果必须一字不差
const envNoise = {
  recoil: false, viewHeight: 1080,
  dpr: 2, devicePixelRatio: 3, canvasWidth: 3840, canvasHeight: 2160,
  aspect: "21:9", zoom: 4, cssScale: 1.25, viewportWidth: 800, viewportHeight: 600,
};
const g2 = CS.crosshairRects(model, envNoise);
ok(eq(g0, g2), "画布宽高 / DPR / 画幅 / zoom 一律不影响几何");
// 画幅本身不在 API 里：不同 aspect 传参不改变几何
for (const aspect of ["4:3", "16:9", "16:10", "21:9", "5:4"]) {
  ok(eq(g0, CS.crosshairRects(model, { recoil: false, viewHeight: 1080, aspect: aspect })), "画幅 " + aspect + " 下几何相同");
}
// 注意：渲染内部 x = gap - ceil(f/2)（中心起算的 gap 转边沿起算，见 render-model 文件头）
ok(g0.f === 2 && g0.b === 10 && g0.x === 4, "1080 高度下 f/b/x = 2/10/4（gap5 - ceil(2/2)，实得 " + g0.f + "/" + g0.b + "/" + g0.x + "）");
console.log("  f=" + g0.f + " b=" + g0.b + " x=" + g0.x + " span=" + g0.span);

/* ---------- 栅格工具 ---------- */
function fakeCanvas(w, h) {
  const ctx = makeCtx();
  return { width: w, height: h, _ctx: ctx, getContext() { return ctx; }, getBoundingClientRect() { return { width: w, height: h }; } };
}
function renderAt(model, unit, cx, cy, w, h) {
  const cv = fakeCanvas(w, h);
  CS.renderOpsSnapped(cv._ctx, CS.buildDrawOps(model, { recoil: false, viewHeight: model.screenHeight }), cx, cy, unit);
  return rasterize(cv._ctx);
}
// 断言 mapK 恰好是 map1 以 k 倍放大（中心分别为 c1 / cK）
function assertScaled(label, map1, c1, mapK, cK, k) {
  let bad = 0, firstBad = null;
  const expected = new Set();
  for (const key of map1.keys()) {
    const p = key.split(",");
    const gx = Number(p[0]) - c1, gy = Number(p[1]) - c1;
    for (let di = 0; di < k; di++) for (let dj = 0; dj < k; dj++) {
      expected.add((cK + gx * k + di) + "," + (cK + gy * k + dj));
    }
  }
  for (const key of expected) if (!mapK.has(key)) { bad++; if (!firstBad) firstBad = key + " 缺失"; }
  for (const key of mapK.keys()) if (!expected.has(key)) { bad++; if (!firstBad) firstBad = key + " 多出"; }
  ok(bad === 0, label + " 栅格不是 " + k + " 倍精确放大（" + bad + " 格不符，" + firstBad + "）");
  return bad === 0;
}

/* ---------- ② 整数倍放大逐格一致 ---------- */
console.log("\n② 整数倍展示缩放 = 1 倍栅格的精确放大");
const base = renderAt(model, 1, 100, 100, 200, 200);
for (const k of [2, 3, 4]) {
  const m = renderAt(model, k, 100, 100, 200 * k, 200 * k);
  assertScaled("unit=" + k, base, 100, m, 100, k);
}
console.log("  unit 1/2/3/4 逐格对应 ✓（" + base.size + " 个像素格）");

/* ---------- ③ 分数 DPR 不形变 ---------- */
console.log("\n③ 分数 DPR 不产生形变");
function bboxInGamePx(map, unit, c) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const key of map.keys()) {
    const p = key.split(",").map(Number);
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  return { x0: (x0 - c) / unit, x1: (x1 + 1 - c) / unit, y0: (y0 - c) / unit, y1: (y1 + 1 - c) / unit };
}
const refBox = bboxInGamePx(base, 1, 100);
for (const u of [1.25, 1.5, 1.75, 2.5]) {
  const m = renderAt(model, u, 100, 100, 400, 400);
  const b = bboxInGamePx(m, u, 100);
  const dev = Math.max(Math.abs(b.x0 - refBox.x0), Math.abs(b.x1 - refBox.x1), Math.abs(b.y0 - refBox.y0), Math.abs(b.y1 - refBox.y1));
  ok(dev <= 1, "unit=" + u + " 换算回游戏像素后外沿偏差 " + dev.toFixed(2) + " > 1");
  console.log("  unit=" + u + " 外沿偏差 " + dev.toFixed(2) + " 游戏像素");
}

/* ---------- ④ 画布尺寸不影响几何 ---------- */
console.log("\n④ 画布尺寸不影响几何");
const small = renderAt(model, 1, 200, 200, 400, 400);
const big = renderAt(model, 1, 400, 400, 800, 800);
assertScaled("画布 400 → 800（1 倍）", small, 200, big, 400, 1);
console.log("  400×400 与 800×800 画布上，相对中心的像素布局完全一致");

/* ---------- ⑤ 高度缩放 ---------- */
console.log("\n⑤ 高度缩放 = viewHeight / screenHeight");
// x = round(gap × 高度比) - ceil(f/2)：gap 与臂厚同步缩放，锚点项也随之缩放
const m1080 = CS.normalizeModel({ thickness: 2, length: 8, gap: 4, screenHeight: 1080 });
const cases = [[1080, 2, 8, 3], [2160, 4, 16, 6], [540, 1, 4, 1], [1440, 3, 11, 3], [720, 1, 5, 2]];
for (const c of cases) {
  const m = CS.crosshairMetrics(m1080, { viewHeight: c[0] });
  ok(m.f === c[1] && m.b === c[2] && m.x === c[3],
    "viewHeight " + c[0] + " 期望 f/b/x = " + c.slice(1).join("/") + "，实得 " + m.f + "/" + m.b + "/" + m.x);
}
ok(eq(CS.crosshairRects(m1080, { viewHeight: 1080 }), CS.crosshairRects(m1080, { viewHeight: 1080 })), "缩放结果稳定");
console.log("  1080→2/8/3 · 2160→4/16/6 · 540→1/4/1 · 1440→3/11/3 · 720→1/5/2");

// 注：PNG 导出功能已整体移除（2026-10-24），原 ⑥ canonical 导出尺寸断言随之删除。

console.log("\n" + (fail ? "✗ 有 " + fail + " 项未通过" : "✓ 全部通过"));
process.exit(fail ? 1 : 0);
