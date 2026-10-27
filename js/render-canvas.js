/* =========================================================================
 * render-canvas.js — Canvas 像素吸附渲染器（从旧 codec.js 迁出并改写）
 *
 * 所有几何都吸附到设备像素整数网格：任何 DPR 下都无虚边。
 * 绘制次序与官方 HUD 一致：
 *   ① 各层彩色矩形/圆环分别单次路径填充（alpha × 层乘数，重叠不叠色）
 *   ② 描边（outlineMode 1 全描边 / 2 半描边＝只描左上），使用描边 RGBA
 * 半描边不是「细描边」：新版只绘制轮廓的左上两条边，与旧的细描边语义不同。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({ renderModel: require("./render-model.js") });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2XH.renderCanvas = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var RM = NS.renderModel;

  function renderOps(ctx, ops, cxDev, cyDev, unit) {
    /* 展示缩放 < 1 时（等比缩小的场景预览），游戏里的 1px 准星只占不到 1 个设备像素。
     * 这时不能吸附到整数网格、也不能强制最小 1px —— 那会把准星画粗约 2 倍。
     * 改用浮点坐标交给 canvas 抗锯齿，得到与「游戏画面缩小」一致的视觉权重。
     * unit >= 1 时仍走整数吸附，保证卡片 / 导出 / 放大检视的硬像素风格。 */
    var subpixel = unit < 1;
    var cx = subpixel ? cxDev : Math.round(cxDev);
    var cy = subpixel ? cyDev + (ops.dy || 0) * unit : Math.round(cyDev + (ops.dy || 0) * unit);
    var i, r;

    function geo(rect) {
      if (subpixel) {
        return [cx + rect.x * unit, cy + rect.y * unit, rect.w * unit, rect.h * unit];
      }
      var x0 = cx + Math.round(rect.x * unit);
      var y0 = cy + Math.round(rect.y * unit);
      var x1 = cx + Math.round((rect.x + rect.w) * unit);
      var y1 = cy + Math.round((rect.y + rect.h) * unit);
      var gw = x1 - x0, gh = y1 - y0;
      // 游戏尺寸 >0 时至少保留 1 设备像素（抗分数 DPR 塌缩）；=0 保持 0（游戏也不画）
      if (rect.w > 0 && gw < 1) gw = 1;
      if (rect.h > 0 && gh < 1) gh = 1;
      return [x0, y0, gw, gh];
    }

    ctx.save();
    var geos = [];
    var rings = [];
    var arcs = [];
    var layers = ops.layers || [{ mul: 1, rects: ops.rects || [] }];

    for (var li = 0; li < layers.length; li++) {
      var layer = layers[li];
      var rects = layer.rects || [];
      var lrings = layer.rings || [];
      var larcs = layer.arcs || [];
      if (rects.length) {
        ctx.beginPath();
        var layerGeos = [];
        for (i = 0; i < rects.length; i++) {
          r = rects[i];
          if (r.w <= 0 || r.h <= 0) continue; // 退化臂：游戏整数填充不产生像素
          var g = geo(r);
          layerGeos.push(g);
          ctx.rect(g[0], g[1], g[2], g[3]);
        }
        if (layerGeos.length) {
          ctx.fillStyle = "rgb(" + ops.rgb + ")";
          ctx.globalAlpha = ops.alpha * (layer.mul == null ? 1 : layer.mul);
          ctx.fill();
          geos = geos.concat(layerGeos);
        }
      }
      for (i = 0; i < lrings.length; i++) {
        rings.push({ ring: lrings[i], mul: layer.mul == null ? 1 : layer.mul });
      }
      for (i = 0; i < larcs.length; i++) {
        arcs.push({ arc: larcs[i], mul: layer.mul == null ? 1 : layer.mul });
      }
    }

    // 圆环：先描边色（外扩）再上主体色
    for (i = 0; i < rings.length; i++) {
      var ring = rings[i].ring;
      var rad = subpixel ? Math.max(0.05, ring.r * unit) : Math.max(0.5, ring.r * unit);
      var w = subpixel ? Math.max(0.05, ring.w * unit) : Math.max(1, Math.round(ring.w * unit));
      if (ops.outlineEnabled) {
        var ow0 = subpixel ? ops.outlineWidth * unit : Math.max(1, Math.round(ops.outlineWidth * unit));
        ctx.globalAlpha = ops.outlineAlpha;
        ctx.strokeStyle = ops.outlineRgb;
        ctx.lineWidth = w + ow0 * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = ops.alpha * rings[i].mul;
      ctx.strokeStyle = "rgb(" + ops.rgb + ")";
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 象限弧环（style 7）：r 为圆心线半径、w 为描边宽，a0/a1 为弧度。
    // 游戏实测：4 段各约 45°（圆心落在斜 45° 方向），弧粗 = thickness，端点平头。
    ctx.lineCap = "butt";
    for (i = 0; i < arcs.length; i++) {
      var ac = arcs[i].arc;
      var ar = subpixel ? Math.max(0.05, ac.r * unit) : Math.max(0.5, ac.r * unit);
      var aw = subpixel ? Math.max(0.05, ac.w * unit) : Math.max(1, Math.round(ac.w * unit));
      if (ops.outlineEnabled) {
        var aow = subpixel ? ops.outlineWidth * unit : Math.max(1, Math.round(ops.outlineWidth * unit));
        ctx.globalAlpha = ops.outlineAlpha;
        ctx.strokeStyle = ops.outlineRgb;
        ctx.lineWidth = aw + aow * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, ar, ac.a0, ac.a1);
        ctx.stroke();
      }
      ctx.globalAlpha = ops.alpha * arcs[i].mul;
      ctx.strokeStyle = "rgb(" + ops.rgb + ")";
      ctx.lineWidth = aw;
      ctx.beginPath();
      ctx.arc(cx, cy, ar, ac.a0, ac.a1);
      ctx.stroke();
    }

    if (ops.outlineEnabled && geos.length) {
      ctx.globalAlpha = ops.outlineAlpha;
      ctx.fillStyle = ops.outlineRgb;
      var ow = subpixel ? ops.outlineWidth * unit : Math.max(1, Math.round(ops.outlineWidth * unit));
      for (i = 0; i < geos.length; i++) {
        var gg = geos[i];
        var x = gg[0], y = gg[1], gw2 = gg[2], gh2 = gg[3];
        if (ops.outlineMode === 2) {
          // 半描边：只描 上边 + 左边
          ctx.fillRect(x - ow, y - ow, gw2 + ow, ow);
          ctx.fillRect(x - ow, y, ow, gh2);
        } else {
          ctx.fillRect(x - ow, y - ow, gw2 + ow * 2, ow);
          ctx.fillRect(x - ow, y + gh2, gw2 + ow * 2, ow);
          ctx.fillRect(x - ow, y, ow, gh2);
          ctx.fillRect(x + gw2, y, ow, gh2);
        }
      }
    }

    ctx.restore();
  }

  // 兼容旧签名
  function renderOpsTo(ctx, ops, cx, cy, zoom) { renderOps(ctx, ops, cx, cy, zoom || 1); }

  /* 在 canvas 上绘制准星。
   * opts: { width, height, zoom, recoil, viewHeight, scopeDot, dpr } */
  function drawCrosshair(canvas, model, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var dpr = opts.dpr || (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    var w = opts.width, h = opts.height;
    if (!w || !h) {
      var rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
    }
    var dw = Math.max(2, Math.round(w * dpr));
    var dh = Math.max(2, Math.round(h * dpr));
    if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }

    var unit = (opts.zoom || 1) * dpr;
    var cx = dw / 2, cy = dh / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    if (opts.scopeDot) {
      var sd = RM.scopeDot(model, opts);
      var s = unit < 1 ? Math.max(0.05, sd.size * unit) : Math.max(1, Math.round(sd.size * unit));
      var sx = unit < 1 ? cx - s / 2 : Math.round(cx - s / 2);
      var sy = unit < 1 ? cy - s / 2 : Math.round(cy - s / 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgb(" + sd.rgb.join(",") + ")";
      ctx.fillRect(sx, sy, s, s);
    }
    ctx.globalAlpha = 1;
    renderOps(ctx, RM.buildDrawOps(model, {
      recoil: !!opts.recoil,
      viewHeight: opts.viewHeight,
      spreadPx: opts.spreadPx,
      climbPx: opts.climbPx,
      splitScale: opts.splitScale,
    }), cx, cy, unit);
  }

  return {
    renderOps: renderOps,
    renderOpsTo: renderOpsTo,
    renderOpsSnapped: renderOps,
    drawCrosshair: drawCrosshair,
  };
});
