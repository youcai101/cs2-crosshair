/* =========================================================================
 * test/lib/rasterize.js — 测试共用的「记录型 ctx + 光栅化」
 *
 * 把 canvas 指令流（rect / fill / stroke / path）落成"设备像素 -> 标签"的 Map，
 * 使「两套渲染器的输出是否逐像素一致」可以用集合比较来断言。
 * verify.js 与 check-render-invariance.js 共用。
 * ========================================================================= */
"use strict";

function makeCtx() {
  const ops = [];
  let subs = null;
  const ctx = {
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    imageSmoothingEnabled: true,
    beginPath() { subs = []; ops.push({ type: "path", subs }); },
    rect(x, y, w, h) { subs.push({ kind: "rect", x, y, w, h }); },
    moveTo(x, y) { subs.push({ kind: "poly", pts: [[x, y]] }); },
    lineTo(x, y) { const p = subs[subs.length - 1]; if (p && p.kind === "poly") p.pts.push([x, y]); },
    arc() {},
    fill() { ops[ops.length - 1].op = { kind: "fill", style: ctx.fillStyle, alpha: ctx.globalAlpha }; },
    stroke() { ops[ops.length - 1].op = { kind: "stroke", style: ctx.strokeStyle, alpha: ctx.globalAlpha, lw: ctx.lineWidth }; },
    fillRect(x, y, w, h) { ops.push({ type: "path", subs: [{ kind: "rect", x, y, w, h }], op: { kind: "fill", style: ctx.fillStyle, alpha: ctx.globalAlpha } }); },
    save() {}, restore() {}, clearRect() {}, setTransform() {}, scale() {},
    _ops: ops,
  };
  return ctx;
}

function spanCells(a, b) { return [Math.ceil(a - 0.5), Math.ceil(b - 0.5)]; }
function rasterRect(map, x, y, w, h, tag) {
  const [i0, i1] = spanCells(x, x + w);
  const [j0, j1] = spanCells(y, y + h);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) map.set(i + "," + j, tag);
}
function rasterRing(map, x, y, w, h, lw, tag) {
  const [ox0, ox1] = spanCells(x - lw / 2, x + w + lw / 2);
  const [oy0, oy1] = spanCells(y - lw / 2, y + h + lw / 2);
  const [ix0, ix1] = spanCells(x + lw / 2, x + w - lw / 2);
  const [iy0, iy1] = spanCells(y + lw / 2, y + h - lw / 2);
  for (let j = oy0; j < oy1; j++) for (let i = ox0; i < ox1; i++) {
    const inner = i >= ix0 && i < ix1 && j >= iy0 && j < iy1;
    if (!inner) map.set(i + "," + j, tag);
  }
}
function rasterSeg(map, x1, y1, x2, y2, lw, tag) {
  if (Math.abs(y1 - y2) < 1e-9) rasterRect(map, Math.min(x1, x2), y1 - lw / 2, Math.abs(x2 - x1), lw, tag);
  else rasterRect(map, x1 - lw / 2, Math.min(y1, y2), lw, Math.abs(y2 - y1), tag);
}
function rasterize(ctx) {
  const map = new Map();
  for (const e of ctx._ops) {
    if (!e.op) continue;
    const tag = JSON.stringify([e.op.style, e.op.alpha]);
    for (const sub of e.subs) {
      if (sub.kind === "rect") {
        if (sub.w <= 0 || sub.h <= 0) continue;
        if (e.op.kind === "fill") rasterRect(map, sub.x, sub.y, sub.w, sub.h, tag);
        else rasterRing(map, sub.x, sub.y, sub.w, sub.h, e.op.lw, tag);
      } else {
        for (let s = 0; s + 1 < sub.pts.length; s++) {
          rasterSeg(map, sub.pts[s][0], sub.pts[s][1], sub.pts[s + 1][0], sub.pts[s + 1][1], e.op.lw, tag);
        }
      }
    }
  }
  return map;
}

function normTag(tag) {
  const [style, alpha] = JSON.parse(tag);
  let m;
  if ((m = style.match(/^rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/))) {
    if (+m[1] === 0 && +m[2] === 0 && +m[3] === 0) return JSON.stringify(["black", +alpha * +m[4]]);
    return JSON.stringify(["rgb", +m[1], +m[2], +m[3], +alpha * +m[4]]);
  }
  if ((m = style.match(/^rgb\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/))) {
    if (+m[1] === 0 && +m[2] === 0 && +m[3] === 0) return JSON.stringify(["black", +alpha]);
    return JSON.stringify(["rgb", +m[1], +m[2], +m[3], +alpha]);
  }
  if (style === "#000" || style === "#000000") return JSON.stringify(["black", +alpha]);
  return JSON.stringify([style, +alpha]);
}

function diffMaps(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let diffs = 0, first = null;
  for (const k of keys) {
    const x = a.has(k) ? normTag(a.get(k)) : "-";
    const y = b.has(k) ? normTag(b.get(k)) : "-";
    if (x !== y) { diffs++; if (!first) first = { k, x, y }; }
  }
  return { diffs, first };
}

module.exports = { makeCtx, rasterize, normTag, diffMaps };
