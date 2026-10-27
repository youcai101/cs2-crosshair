/* =========================================================================
 * crosshair-verify.js — 从 CS2 截图反推准星几何，并与渲染模型对拍
 *
 * 用途：逆向验证 js/render-model.js 的几何是否与游戏 1:1。
 * 原理：截图中心就是准星中心。用「参考色投影」求每个像素的准星覆盖率
 *       （0 = 纯背景，1 = 纯准星色），再用 50% 阈值求亚像素边缘。
 *       JPEG 有损但亮度/色度在准星这种高对比块上仍可做到 ±0.05px。
 *
 * 用法:
 *   node tools/crosshair-verify.js <截图.png>              # 测一张
 *   node tools/crosshair-verify.js <截图.png> --json       # 机器可读
 *   node tools/crosshair-verify.js <截图.png> --model '{"style":4,"length":4,"thickness":2,"gap":2,"screenHeight":960}'
 *                                                          # 与模型对拍
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- 最小 PNG 解码（零依赖，只支持 8bit RGB/RGBA 非隔行） ---------- */
function pngDecode(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("只支持 8bit，当前 " + bitDepth);
  if (interlace) throw new Error("不支持隔行 PNG");
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error("不支持 colorType " + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    raw.copy(cur, 0, p, p + stride); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      out[o] = cur[s];
      out[o + 1] = ch >= 3 ? cur[s + 1] : cur[s];
      out[o + 2] = ch >= 3 ? cur[s + 2] : cur[s];
      out[o + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, data: out };
}

/* ---------- 覆盖率场 ---------- */
function coverageField(img, opts) {
  const { w, h, data } = img;
  opts = opts || {};
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const R = opts.radius || 40;
  const px = (x, y) => {
    const o = (y * w + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };

  // 1) 参考色 = 中心区「最像准星」的像素。默认按绿度，也支持自定义色。
  const want = opts.rgb || null;
  let ref = [0, 255, 0], best = -1e9;
  for (let y = cy - R; y <= cy + R; y++) {
    for (let x = cx - R; x <= cx + R; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = px(x, y);
      const sc = want
        ? -(Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]))
        : p[1] - (p[0] + p[2]) / 2;
      if (sc > best) { best = sc; ref = p; }
    }
  }

  // 2) 背景色 = 中心区里离参考色最远的一半像素的均值
  const list = [];
  for (let y = cy - R; y <= cy + R; y++) {
    for (let x = cx - R; x <= cx + R; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = px(x, y);
      list.push({ p, d: Math.hypot(p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]) });
    }
  }
  list.sort((a, b) => b.d - a.d);
  const keep = list.slice(0, Math.max(16, Math.floor(list.length * 0.55)));
  const bg = [0, 1, 2].map((i) => keep.reduce((s, e) => s + e.p[i], 0) / keep.length);

  // 3) 覆盖率 = 像素在 bg→ref 连线上的投影
  const d = [ref[0] - bg[0], ref[1] - bg[1], ref[2] - bg[2]];
  const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const cov = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const p = px(x, y);
    const v = (p[0] - bg[0]) * d[0] + (p[1] - bg[1]) * d[1] + (p[2] - bg[2]) * d[2];
    return Math.max(0, Math.min(1, v / d2));
  };
  return { w, h, cx, cy, cov, ref, bg };
}

/* ---------- 亚像素边缘 ---------- */
function halfCrossing(fn, from, step, n) {
  const out = [];
  let prev = fn(from);
  for (let k = 1; k <= n; k++) {
    const i = from + step * k;
    const cur = fn(i);
    if ((prev < 0.5) !== (cur < 0.5)) out.push(i - step * Math.abs((0.5 - prev) / (cur - prev)));
    prev = cur;
  }
  return out;
}

function integrate(fn, a, b) {
  let s = 0;
  for (let i = a; i <= b; i++) s += fn(i);
  return s;
}

/* ---------- 主测量 ---------- */
function measure(file, opts) {
  opts = opts || {};
  const img = pngDecode(fs.readFileSync(file));
  const F = coverageField(img, opts);
  const { w, h, cx, cy, cov } = F;

  // 中心：CS2 准星恒在画面几何中心。偶数宽时中心落在像素缝上（w/2 - 0.5）。
  // 不用质心——背景亮区会把质心拽偏（实测偏 2.9px）。
  const ccx = w / 2 - 0.5, ccy = h / 2 - 0.5;

  // 先确认中心附近真有准星
  let mass = 0;
  for (let y = Math.floor(ccy) - 6; y <= Math.floor(ccy) + 6; y++)
    for (let x = Math.floor(ccx) - 6; x <= Math.floor(ccx) + 6; x++) mass += cov(x, y);
  if (mass < 2) return { ok: false, reason: "中心没有准星像素（mass=" + mass.toFixed(2) + "）", w, h };

  // 四个方向的外/内边缘（从中心沿中心行/列往外扫）
  const rowY = Math.floor(ccy), colX = Math.floor(ccx);
  const rowFn = (x) => cov(x, rowY);
  const colFn = (y) => cov(colX, y);
  const left = halfCrossing(rowFn, Math.floor(ccx), -1, 40).map((v) => ccx - v);
  const right = halfCrossing(rowFn, Math.floor(ccx) + 1, +1, 40).map((v) => v - ccx);
  const up = halfCrossing(colFn, Math.floor(ccy), -1, 40).map((v) => ccy - v);
  const down = halfCrossing(colFn, Math.floor(ccy) + 1, +1, 40).map((v) => v - ccy);

  // 臂长与 gap（取四向中位数，抗单边干扰）
  const med = (a) => {
    const v = a.filter((n) => n != null && isFinite(n)).sort((p, q) => p - q);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const inner = med([left[0], right[0], up[0], down[0]]);
  const outer = med([left[1], right[1], up[1], down[1]]);
  const armLen = inner != null && outer != null ? outer - inner : null;

  // 厚度：在臂的中段（gap + 臂长/2 处）沿垂直方向积分，范围限制在 ±(臂厚上限)
  let thickH = null, thickV = null;
  if (inner != null && armLen != null && armLen > 0.5) {
    const mid = Math.round(ccx - (inner + armLen / 2));
    const midY = Math.round(ccy - (inner + armLen / 2));
    const lim = Math.max(4, Math.min(16, Math.ceil(inner + armLen)));
    thickH = integrate((y) => cov(mid, y), Math.floor(ccy) - lim, Math.floor(ccy) + lim);
    thickV = integrate((x) => cov(x, midY), Math.floor(ccx) - lim, Math.floor(ccx) + lim);
  }
  const thickness = thickH != null && thickV != null ? (thickH + thickV) / 2 : null;

  return {
    ok: true, file: path.basename(file), w, h,
    center: [+ccx.toFixed(3), +ccy.toFixed(3)],
    ref: F.ref, bg: F.bg.map((v) => Math.round(v)),
    edges: {
      left: left.map((v) => +v.toFixed(2)),
      right: right.map((v) => +v.toFixed(2)),
      up: up.map((v) => +v.toFixed(2)),
      down: down.map((v) => +v.toFixed(2)),
    },
    gap: inner != null ? +inner.toFixed(2) : null,
    armLength: armLen != null ? +armLen.toFixed(2) : null,
    thickness: thickness != null ? +thickness.toFixed(2) : null,
    span: outer != null ? +(outer * 2).toFixed(2) : null,
  };
}

/* ---------- CLI ---------- */
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && a !== "json");
  if (!file) {
    console.log("用法: node tools/crosshair-verify.js <截图.png> [--json] [--model '<json>']");
    process.exit(1);
  }
  const asJson = args.includes("--json");
  const mi = args.indexOf("--model");
  const mfi = args.indexOf("--model-file");
  const modelArg = mfi >= 0 ? fs.readFileSync(args[mfi + 1], "utf8") : (mi >= 0 ? args[mi + 1] : null);

  const r = measure(file);
  if (!r.ok) { console.log("✗ " + r.reason); process.exit(2); }

  if (asJson) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log("截图 " + r.file + "  " + r.w + "x" + r.h);
    console.log("  中心      = (" + r.center[0] + ", " + r.center[1] + ")");
    console.log("  准星色    = rgb(" + r.ref.join(",") + ")   背景 = rgb(" + r.bg.join(",") + ")");
    console.log("  内沿 gap  = " + r.gap + " px");
    console.log("  臂长      = " + r.armLength + " px");
    console.log("  臂厚      = " + r.thickness + " px");
    console.log("  外沿跨度  = " + r.span + " px");
    console.log("  四向边缘  = L" + JSON.stringify(r.edges.left) + " R" + JSON.stringify(r.edges.right) +
      " U" + JSON.stringify(r.edges.up) + " D" + JSON.stringify(r.edges.down));
  }

  if (modelArg) {
    let Codec, RM;
    try {
      Codec = require("../js/core-codec.js");
      RM = require("../js/render-model.js");
    } catch (e) {
      console.log("✗ 无法加载渲染模型: " + e.message);
      process.exit(3);
    }
    const model = Codec.normalizeModel(JSON.parse(modelArg));
    const g = RM.crosshairRects(model, { viewHeight: r.h });
    const rects = [];
    g.layers.forEach((L) => L.rects.forEach((q) => rects.push(q)));
    // 每条矩形沿自身长轴算内外沿
    let minIn = Infinity, maxOut = 0;
    rects.forEach((q) => {
      const horiz = Math.abs(q.w) >= Math.abs(q.h);
      const a = horiz ? [Math.abs(q.x), Math.abs(q.x + q.w)] : [Math.abs(q.y), Math.abs(q.y + q.h)];
      minIn = Math.min(minIn, Math.min(...a));
      maxOut = Math.max(maxOut, Math.max(...a));
    });
    console.log("");
    console.log("── 与渲染模型对拍 ──");
    console.log("  模型 f=" + g.f + " b=" + g.b + " x=" + g.x + " span=" + g.span);
    console.log("  模型 内沿=" + minIn + "  臂长=" + g.b + "  臂厚=" + g.f + "  外沿=" + maxOut);
    const dGap = r.gap == null ? NaN : Math.abs(minIn - r.gap);
    const dLen = r.armLength == null ? NaN : Math.abs(g.b - r.armLength);
    const dThk = r.thickness == null ? NaN : Math.abs(g.f - r.thickness);
    console.log("  偏差 gap=" + dGap.toFixed(2) + " length=" + dLen.toFixed(2) + " thickness=" + dThk.toFixed(2));
    const pass = dGap <= 0.7 && dLen <= 0.7 && dThk <= 0.9;
    console.log("  " + (pass ? "✓ 1:1 命中" : "✗ 不一致"));
    process.exit(pass ? 0 : 4);
  }
}

module.exports = { pngDecode, coverageField, measure, halfCrossing, integrate };
