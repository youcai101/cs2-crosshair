/* =========================================================================
 * codec.js — 兼容门面（Facade）
 *
 * 旧版 codec.js 是 828 行单体；现已拆分为：
 *   core-alphabet.js   Base57 容器（码 ↔ 字节 ↔ 大整数、校验和）
 *   core-layouts.js    四种布局的声明式字节表 + 位域读写引擎
 *   core-codec.js      新像素模型 CrosshairV2 + cs2-v1 读写
 *   core-legacy.js     legacy-v1 / v3 / v4 读写（仅供导入与对拍）
 *   core-convert.js    旧刻度 → 新像素（单向，含近似标注）
 *   core-convars.js    新 convar 双向映射 + 512 字符单行
 *   render-model.js    新像素度量 + 10 样式行为表
 *   render-canvas.js   Canvas 像素吸附渲染
 *
 * 本文件只做两件事：① 把 8 个模块合成一个 CS2Crosshair 命名空间；
 * ② 统一 decodeShareCode 的容器分发（cs2 精确解析 / legacy 懒迁移）。
 * 业务逻辑一律不写在这里。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({
      alphabet: require("./core-alphabet.js"),
      layouts: require("./core-layouts.js"),
      codec: require("./core-codec.js"),
      legacy: require("./core-legacy.js"),
      convert: require("./core-convert.js"),
      convars: require("./core-convars.js"),
      renderModel: require("./render-model.js"),
      renderCanvas: require("./render-canvas.js"),
    });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2Crosshair = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var A = NS.alphabet;
  var L = NS.layouts;
  var Codec = NS.codec;
  var Legacy = NS.legacy;
  var Convert = NS.convert;
  var Convars = NS.convars;
  var RM = NS.renderModel;
  var RC = NS.renderCanvas;

  var COLOR_NAMES = ["红", "绿", "黄", "蓝", "青", "自定义"];

  /* ---------------- 分享码分发 ----------------
   * cs2-v1   → 直接解析（精确）
   * legacy   → 解析旧刻度 + 换算成新像素模型，并附 migration 说明（有损，UI 必须标注）
   */
  function decodeInfo(shareCode, opts) {
    var code = String(shareCode == null ? "" : shareCode).trim();
    var container = A.detectContainer(code);
    if (!container) {
      var e = new Error("无法识别的分享码（既不是 CS… 也不是 CSGO-…）");
      e.name = "CrosshairShareCodeError";
      throw e;
    }
    if (container === "cs2") {
      var model = Codec.decode(code);
      return { model: model, container: "cs2", format: Codec.FORMAT, migration: null };
    }
    var legacy = Legacy.decode(code);
    var converted = Convert.toModel(legacy, opts || {});
    return { model: converted, container: "legacy", format: legacy.format, migration: converted.migration };
  }

  function decodeShareCode(shareCode, opts) { return decodeInfo(shareCode, opts).model; }

  function encodeShareCode(model) { return Codec.encode(model); }

  /* ---------------- 随机准星（新刻度） ---------------- */
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function randomSettings() {
    var m = Codec.defaultModel();
    m.style = pick([4, 4, 4, 4, 2, 0, 7, 8, 3, 6]);
    m.thickness = randInt(0, 4);
    m.length = randInt(2, 20);
    m.gap = m.style === 2 ? randInt(-3, 12) : randInt(0, 12);
    m.outlineMode = pick([0, 0, 0, 1, 2]);
    m.outlineRed = 0; m.outlineGreen = 0; m.outlineBlue = 0; m.outlineAlpha = 255;
    m.alpha = randInt(150, 255);
    m.centerDotEnabled = Math.random() < 0.3;
    m.tStyleEnabled = Math.random() < 0.15;
    m.followRecoil = Math.random() < 0.25;
    m.dynamicSpreadLimit = pick([64, 128, 255]);
    m.splitDistance = randInt(1, 40);
    m.splitSizeRatio = Math.round(randInt(30, 100)) / 100;
    m.innerSplitAlpha = Math.round(randInt(50, 100)) / 100;
    m.outerSplitAlpha = Math.round(randInt(30, 100)) / 100;
    m.scopeDotScale = Math.round(randInt(50, 200)) / 100;
    m.scopeDotUseCrosshairColor = Math.random() < 0.4;
    var palette = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 255, 255], [255, 0, 255], [255, 255, 255]];
    var c = pick(palette);
    m.red = c[0]; m.green = c[1]; m.blue = c[2];
    return m;
  }

  var api = {
    /* --- 常量 / 枚举 --- */
    ALPHABET: A.ALPHABET,
    PALETTE: Convert.PALETTE,
    COLOR_NAMES: COLOR_NAMES,
    STYLES: Codec.STYLES,
    STYLE_NAMES: Codec.STYLE_NAMES,
    STYLE_NAMES_EN: Codec.STYLE_NAMES_EN,
    OUTLINE_MODES: Codec.OUTLINE_MODES,
    styleInfo: Codec.styleInfo,
    LEGACY_V1_STYLE_NAMES: Legacy.LEGACY_V1_STYLE_NAMES,
    LEGACY_PIXEL_STYLE_NAMES: Legacy.LEGACY_PIXEL_STYLE_NAMES,
    legacyStyleName: Legacy.styleName,

    /* --- 模型 --- */
    defaultSettings: Codec.defaultModel,
    defaultModel: Codec.defaultModel,
    normalizeModel: Codec.normalizeModel,
    isStaticStyle: Codec.isStaticStyle,
    hasFireFeedback: Codec.hasFireFeedback,
    isSplitStyle: Codec.isSplitStyle,
    isQuadStyle: Codec.isQuadStyle,
    isDotOnlyStyle: Codec.isDotOnlyStyle,

    /* --- 编解码 --- */
    decodeShareCode: decodeShareCode,
    decodeInfo: decodeInfo,
    encodeShareCode: encodeShareCode,
    detectContainer: A.detectContainer,
    shareCodeToBytes: A.shareCodeToBytes,
    bytesToShareCode: A.bytesToShareCode,
    verifyChecksum: A.verifyChecksum,
    decodeLegacy: Legacy.decode,
    encodeLegacy: Legacy.encode,
    layoutFieldMeta: L.fieldMeta,
    convertToModel: Convert.toModel,
    legacyV1ToPixels: Convert.legacyV1ToPixels,

    /* --- convar --- */
    settingsToCommands: Convars.toCommands,
    settingsToConVars: function (model) { return Convars.toCmdRows(model).map(function (r) { return r[0] + ' "' + r[1] + '"'; }); },
    settingsToPasteChunks: Convars.toPasteChunks,
    settingsToPasteLine: Convars.toPasteLine,
    settingsToConsoleChunks: Convars.toPasteChunks,
    settingsToConsoleLine: Convars.toPasteLine,
    parseConVars: Convars.parseConVars,
    parseConVarsInfo: Convars.parse,
    PASTE_LIMIT: Convars.PASTE_LIMIT,
    REMOVED_CONVARS: Convars.REMOVED_CONVARS,
    HIDDEN_LEGACY_CONVARS: Convars.HIDDEN_LEGACY_CONVARS,
    NEVER_OUTPUT: Convars.NEVER_OUTPUT,

    /* --- 渲染 --- */
    crosshairMetrics: RM.crosshairMetrics,
    crosshairRects: RM.crosshairRects,
    crosshairRectsFlat: RM.crosshairRectsFlat,
    crosshairSpan: RM.crosshairSpan,
    contentSpan: RM.contentSpan,
    buildDrawOps: RM.buildDrawOps,
    displayScale: RM.displayScale,
    MAX_SPREAD_PX: RM.MAX_SPREAD_PX,
    MAX_CLIMB_PX: RM.MAX_CLIMB_PX,
    RING_BASE_PX: RM.RING_BASE_PX,
    CIRCLE_BASE_PX: RM.CIRCLE_BASE_PX,
    RING_MAX_PX: RM.RING_MAX_PX,
    CIRCLE_MAX_PX: RM.CIRCLE_MAX_PX,
    ARC_SPAN_DEG: RM.ARC_SPAN_DEG,
    styleShape: RM.styleShape,
    scopeDot: RM.scopeDot,
    renderOpsSnapped: RC.renderOps,
    renderOpsTo: RC.renderOpsTo,
    drawCrosshair: RC.drawCrosshair,

    randomSettings: randomSettings,
  };

  return api;
});
