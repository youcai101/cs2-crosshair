/* =========================================================================
 * core-convert.js — 旧布局 → 新像素模型（单向）
 *
 * 只做「旧 → 新」。游戏已不接受 CSGO- 容器，生成旧码没有任何意义，
 * 因此这里不提供反向转换。
 *
 * legacy-v3 / v4（已经是像素刻度）：字段直搬，精确。
 * legacy-v1（旧刻度，无 screenHeight，有损）：按参考屏幕高度把旧刻度
 *   换算成该高度下的像素值（1080p 公式已被 306 份 prosettings 官方矩形全量验证）。
 *
 * 换算（§3.4）：
 *   f = max(1, floor((T + 0.2222) / 0.4444))      厚度像素
 *   b = floor((L + 0.2222) / 0.4445)              臂长像素
 *   x = trunc(G) + 5  (旧 style 2 静止) / gapRound(G) + 4 (其余)
 *   gap = x + ceil(f / 2)      候选 B（新 gap 从屏幕中心起算）—— **默认，2026-10-16 已裁决**
 *   gap = x                    候选 A（几何直搬，边沿起算；opts.gapOrigin === "arm" 时启用）
 *
 * R3 裁决依据（离线实验，2026-10-16）：prosettings 258 个新格式页面样本中 255 个的官方矩形
 * 满足「臂根内沿 = 屏幕中心 + gap」；82 个旧格式页面仍是「边沿起算」。即游戏在新系统里把
 * gap 锚点从中心块边缘改成了屏幕中心。迁移取候选 B 可保证「臂根内沿距中心」守恒，
 * 旧准星迁移后视觉位置不变；候选 A 只作为应急出口保留。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({ codec: require("./core-codec.js"), legacy: require("./core-legacy.js") });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2XH.convert = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var Codec = NS.codec;

  var DEFAULT_SCREEN_HEIGHT = 1080;

  // 旧样式 → 新样式。按「渲染行为」而非编号直搬：
  //   4（经典静态 / Classic Static）→ 4（Static Cross）1:1
  //   5（传统 Legacy）              → 5（Static Cross Shot Feedback）1:1
  //   2（经典）                     → 2（Dynamic Cross Legacy）1:1
  //   0 / 1 / 3                     → 2（近似：新系统无对应编号）
  var LEGACY_V1_STYLE_MAP = { 0: 2, 1: 2, 2: 2, 3: 2, 4: 4, 5: 5, 6: 2, 7: 2 };

  // 旧颜色预设（索引 0-4），5 = 自定义 RGB
  var PALETTE = [
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [0, 255, 255],
  ];

  function trunc(v) { return v < 0 ? -Math.floor(-v) : Math.floor(v); }

  // 旧渲染器的间距取整（游戏 HUD 的 (int)(gap + 4.0f) 语义）
  function legacyGapRound(g) { return g < -4 ? trunc(g) : Math.floor(g); }

  // 旧系统 → 该屏幕高度下的像素度量
  function legacyV1ToPixels(v1, screenHeight) {
    var T = Number(v1.thickness) || 0;
    var L = Number(v1.length) || 0;
    var G = Number(v1.gap) || 0;
    var f = Math.max(1, Math.floor((T + 0.2222) / 0.4444));
    var b = Math.floor((L + 0.2222) / 0.4445);
    var x = v1.style === 2 ? trunc(G) + 5 : legacyGapRound(G) + 4;
    return { f: f, b: b, x: x, screenHeight: screenHeight };
  }

  // 旧描边 → 新描边模式（旧 0.5 步进：<1 只描左上 = 新「半描边」，≥1 = 全描边）
  function outlineFromLegacy(enabled, outline) {
    if (!enabled || !(outline > 0)) return 0;
    return outline < 1 ? 2 : 1;
  }

  function legacyV1ToModel(v1, opts) {
    opts = opts || {};
    var H = Math.max(240, Number(opts.screenHeight || opts.refHeight) || DEFAULT_SCREEN_HEIGHT);
    var px = legacyV1ToPixels(v1, H);
    var newStyle = LEGACY_V1_STYLE_MAP[v1.style] != null ? LEGACY_V1_STYLE_MAP[v1.style] : 2;
    // 新 gap 从屏幕中心起算（R3 已裁决，见文件头）：补上半个臂厚，保证臂根内沿距中心守恒。
    // 应急出口：opts.gapOrigin === "arm" 时回到候选 A（边沿起算，几何直搬）。
    var gap = opts.gapOrigin === "arm" ? px.x : px.x + Math.ceil(px.f / 2);

    // 与旧实现一致：索引 0-4 展开为预设色，5 = 自定义 RGB，其余（6/7）回落为绿色
    var preset = v1.color === 5 ? null : (PALETTE[v1.color] || [0, 255, 0]);
    var model = Codec.normalizeModel({
      style: newStyle,
      followRecoil: !!v1.followRecoil,
      centerDotEnabled: !!v1.centerDotEnabled,
      tStyleEnabled: !!v1.tStyleEnabled,
      outlineMode: outlineFromLegacy(v1.outlineEnabled, v1.outline),
      red: preset ? preset[0] : v1.red,
      green: preset ? preset[1] : v1.green,
      blue: preset ? preset[2] : v1.blue,
      alpha: v1.alphaEnabled ? v1.alpha : 255,
      outlineRed: 0, outlineGreen: 0, outlineBlue: 0, outlineAlpha: 255,
      gap: gap,
      length: px.b,
      thickness: px.f,
      dynamicSpreadLimit: 255,
      splitDistance: v1.splitDistance,
      innerSplitAlpha: Math.min(1, v1.innerSplitAlpha),
      outerSplitAlpha: Math.min(1, Math.max(0.3, v1.outerSplitAlpha)),
      splitSizeRatio: Math.min(1, v1.splitSizeRatio),
      screenHeight: H,
      scopeDotScale: 1,
      scopeDotUseCrosshairColor: false,
    });

    var dropped = [];
    if (v1.fixedCrosshairGap) dropped.push("fixedCrosshairGap");
    if (v1.deployedWeaponGapEnabled) dropped.push("deployedWeaponGapEnabled");
    if (v1.alphaEnabled === false) dropped.push("cl_crosshairusealpha");

    var notes = [];
    if (newStyle !== v1.style) notes.push("样式 " + v1.style + " → " + newStyle + "（新系统无对应编号，已映射到最接近的样式）");
    // 真正无法在菜单里复现的只有「换算后 gap 为负」：新菜单的 gap 最小 0（仅 style 2 可负）
    if (px.x < 0) notes.push("换算后 gap 为 " + px.x + "px（原准星把四臂拉向中心），新菜单 gap 最小 0，仅控制台可设负值 —— 当前为近似效果");
    if (v1.outlineEnabled && v1.outline > 0 && v1.outline < 1) notes.push("原细描边（" + v1.outline + "）→ 半描边：新系统只绘制轮廓左上部分，视觉不完全等价");
    if (v1.outlineEnabled && v1.outline >= 1.5) notes.push("原描边宽度 " + v1.outline + "px → 新系统描边宽度固定 1px，无法再调");
    if (px.b > 255) notes.push("臂长 " + px.b + "px 超出新系统上限 255px，已裁剪");
    if (px.f > 32) notes.push("臂厚 " + px.f + "px 超出新系统上限 32px，已裁剪");
    if (gap > 128) notes.push("间距 " + gap + "px 超出菜单范围（0-128），仅控制台可设");

    var migration = {
      fmt: "cs2-v1",
      from: "legacy-v1",
      h: H,
      lossy: true,
      gapOrigin: opts.gapOrigin === "arm" ? "arm" : "center",
      scale: { f: px.f, b: px.b, x: px.x },
      styleFrom: v1.style,
      styleTo: newStyle,
      dropped: dropped,
      notes: notes,
    };
    model.migration = migration;
    return model;
  }

  function pixelLegacyToModel(v, opts) {
    opts = opts || {};
    var H = Number(v.screenHeight) > 0 ? Number(v.screenHeight) : Math.max(240, Number(opts.screenHeight || opts.refHeight) || DEFAULT_SCREEN_HEIGHT);
    var model = Codec.normalizeModel({
      style: v.style,
      followRecoil: !!v.followRecoil,
      centerDotEnabled: !!v.centerDotEnabled,
      tStyleEnabled: !!v.tStyleEnabled,
      // v4 自带 outlineMode；v3 只有布尔
      outlineMode: v.format === "legacy-v4" ? v.outlineMode : (v.outlineEnabled ? 1 : 0),
      red: v.red, green: v.green, blue: v.blue, alpha: v.alpha,
      outlineRed: 0, outlineGreen: 0, outlineBlue: 0, outlineAlpha: 255,
      gap: v.gap,
      length: v.length,
      thickness: v.thickness,
      dynamicSpreadLimit: v.dynamicSpreadLimit,
      splitDistance: v.splitDistance,
      innerSplitAlpha: v.innerSplitAlpha,
      outerSplitAlpha: v.outerSplitAlpha,
      splitSizeRatio: v.splitSizeRatio,
      screenHeight: H,
      scopeDotScale: 1,
      scopeDotUseCrosshairColor: false,
    });
    var notes = [];
    if (v.format === "legacy-v3" && v.outlineEnabled) notes.push("legacy-v3 只有描边开关，已按「全描边」迁移");
    if (Number(v.screenHeight) === 0) notes.push("旧码未记录屏幕高度，按 " + H + " 处理");
    var migration = {
      fmt: "cs2-v1",
      from: v.format,
      h: H,
      lossy: false,
      dropped: [],
      notes: notes,
    };
    model.migration = migration;
    return model;
  }

  // 统一入口：任何 legacy 对象 → 新模型
  function toModel(legacy, opts) {
    if (!legacy) throw new Error("缺少 legacy 准星对象");
    if (legacy.format === "legacy-v1") return legacyV1ToModel(legacy, opts);
    if (legacy.format === "legacy-v3" || legacy.format === "legacy-v4") return pixelLegacyToModel(legacy, opts);
    throw new Error("不支持的旧格式: " + legacy.format);
  }

  return {
    DEFAULT_SCREEN_HEIGHT: DEFAULT_SCREEN_HEIGHT,
    LEGACY_V1_STYLE_MAP: LEGACY_V1_STYLE_MAP,
    PALETTE: PALETTE,
    legacyV1ToPixels: legacyV1ToPixels,
    legacyGapRound: legacyGapRound,
    outlineFromLegacy: outlineFromLegacy,
    legacyV1ToModel: legacyV1ToModel,
    pixelLegacyToModel: pixelLegacyToModel,
    toModel: toModel,
  };
});
