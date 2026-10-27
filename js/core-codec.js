/* =========================================================================
 * core-codec.js — 新像素刻度模型（CrosshairV2） + cs2-v1 读写的唯一入口
 *
 * 内部模型 = CS2 新版准星系统的**像素刻度**：
 *   thickness / length / gap 均为「屏幕像素」，screenHeight 记录制作时的屏幕高度，
 *   游戏按 当前高度 / screenHeight 自动等比缩放。
 *   描边是 outlineMode(0 无 / 1 全 / 2 半) + 独立 RGBA，
 *   另有 dynamicSpreadLimit、scope dot（scale + 随准星色）。
 *
 * 旧刻度（0.1 步进）**只存在于 core-legacy.js 与 core-convert.js 内部**，
 * 全工程其它地方一律使用本模型。
 *
 * 生成：永远是 cs2-v1；解析：cs2-v1 精确往返。
 * 格式基准：akiver/csgo-sharecode 7.0.1
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({ alphabet: require("./core-alphabet.js"), layouts: require("./core-layouts.js") });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2XH.codec = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var A = NS.alphabet;
  var L = NS.layouts;

  var FORMAT = "cs2-v1";

  /* ---------------- 样式表（0-9，编号语义与旧系统完全不同） ----------------
   * zh 名称与游戏内「样式」下拉完全一致（2026-10 游戏内实读）：
   *   静态十字 / 静态圆形 / 静态方形 / 仅限圆点 / 静态象限 /
   *   动态十字 / 动态圆形 / 动态十字（经典）/ 动态十字[旧版/射击反馈] / 动态象限
   * 注意：游戏下拉按「静态在前、动态在后」排列，**不是**枚举值顺序，这里保持枚举顺序。
   */
  var STYLES = [
    { value: 0, en: "Dynamic Cross", zh: "动态十字", dynamic: true, quad: false },
    { value: 1, en: "Dynamic Circle", zh: "动态圆形", dynamic: true, quad: false },
    { value: 2, en: "Dynamic Cross (Legacy)", zh: "动态十字（经典）", dynamic: true, quad: false, split: true },
    { value: 3, en: "Static Circle", zh: "静态圆形", dynamic: false, quad: false },
    { value: 4, en: "Static Cross", zh: "静态十字", dynamic: false, quad: false },
    /* style 5 = 单套四臂（游戏 0xDA6B60 实读）：不分裂、不走两套 ARMS，也不吃 spread_limit
     * （设置页里不显示 Dynamic Spread Dist）；但它吃「开火反馈量」k：
     *   r = round(max(0,gap) + screenH × k / 1200)，k = clamp(k + 开火增量, 0, 25)，每秒衰减 42。
     * 所以它是「静态形状 + 动态反馈」，dynamic:false（不是散布样式）但 feedback:true（可演示）；
     * 游戏内名称为「动态十字[旧版/射击反馈]」（旧版动态十字，靠射击反馈而非扩散驱动）。
     */
    { value: 5, en: "Dynamic Cross (Legacy / Shot Feedback)", zh: "动态十字[旧版/射击反馈]", dynamic: false, feedback: true, quad: false },
    { value: 6, en: "Dot Only", zh: "仅限圆点", dynamic: false, quad: false, dotOnly: true },
    { value: 7, en: "Dynamic Quad", zh: "动态象限", dynamic: true, quad: true },
    { value: 8, en: "Static Square", zh: "静态方形", dynamic: false, quad: false },
    { value: 9, en: "Static Quad", zh: "静态象限", dynamic: false, quad: true },
  ];
  var STYLE_NAMES = {};
  var STYLE_NAMES_EN = {};
  STYLES.forEach(function (s) { STYLE_NAMES[s.value] = s.zh; STYLE_NAMES_EN[s.value] = s.en; });

  function styleInfo(style) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].value === style) return STYLES[i];
    return STYLES[4];
  }

  var OUTLINE_MODES = [
    { value: 0, zh: "无描边", en: "No outline" },
    { value: 1, zh: "全描边", en: "Full outline" },
    { value: 2, zh: "半描边（只描左上）", en: "Half outline" },
  ];

  /* ---------------- 默认模型 ----------------
   * 默认样式取 4（Static Cross）——职业选手中 92% 在用（详见重构计划 D4）；
   * 游戏全新安装的默认是 7（Dynamic Quad），UI 下拉里会注明。
   * 默认几何取旧版默认准星（length 5 / thickness 1 / gap 3 旧刻度）换算后的像素值，
   * 保证老用户升级后看到的形状不变。
   */
  function defaultModel() {
    return {
      format: FORMAT,
      style: 4,
      followRecoil: false,
      centerDotEnabled: false,
      tStyleEnabled: false,
      outlineMode: 0,
      red: 0, green: 255, blue: 0, alpha: 255,
      outlineRed: 0, outlineGreen: 0, outlineBlue: 0, outlineAlpha: 255,
      gap: 7,                       // px，臂根内沿到屏幕中心的距离（新系统 gap：中心起算）
      length: 11,                   // px，单臂长度
      thickness: 2,                 // px，臂厚（绘制最小 1px）
      dynamicSpreadLimit: 255,
      splitDistance: 7,
      innerSplitAlpha: 1,
      outerSplitAlpha: 0.5,
      splitSizeRatio: 1,
      screenHeight: 1080,
      scopeDotScale: 1,
      scopeDotUseCrosshairColor: false,
      // 镜内准星线宽 —— 客户端仍在写（vcfg 实读默认 0）；是否仍影响渲染未实测，
      // 因此只进 .cfg 与导入解析，不进分享码、不进单行粘贴命令
      sniperWidth: 0,
    };
  }

  var LAYOUT_FIELDS = L.LAYOUTS[FORMAT].fields.filter(function (f) {
    return f.name !== "checksum" && f.name !== "version";
  });

  // 按布局表裁剪到合法范围；未知字段原样保留（附加项）
  function normalizeModel(model) {
    var out = Object.assign(defaultModel(), model || {});
    out.format = FORMAT;
    for (var i = 0; i < LAYOUT_FIELDS.length; i++) {
      var f = LAYOUT_FIELDS[i];
      var v = out[f.name];
      if (f.bool) { out[f.name] = !!v; continue; }
      var n = Number(v);
      if (!isFinite(n)) n = f.def != null ? f.def : 0;
      if (f.min != null) n = Math.max(n, f.min);
      if (f.max != null) n = Math.min(n, f.max);
      if (f.rejectZero && n === 0) n = 240;
      var step = f.scale == null ? 1 : f.scale;
      if (step < 1) n = Math.round(n / step) * step;
      var digits = step >= 0.1 ? 1 : 2;
      var p = Math.pow(10, digits);
      out[f.name] = Math.round(n * p) / p;
    }
    return out;
  }

  /* ---------------- cs2-v1 编解码 ---------------- */

  function isCs2ShareCode(shareCode) {
    return A.CS2_PATTERN.test(String(shareCode == null ? "" : shareCode).trim());
  }

  function decodeBytes(bytes) {
    A.assertChecksum(bytes);
    var layout = L.resolveLayout(bytes, "cs2");
    if (!layout) {
      var e = new Error("不支持的 CS2 分享码版本号: " + bytes[1]);
      e.name = "CrosshairShareCodeError";
      throw e;
    }
    var model = Object.assign(defaultModel(), L.decodeWithLayout(bytes, layout));
    model.format = FORMAT;
    return model;
  }

  function decodeShareCode(shareCode) {
    return decodeBytes(A.cs2ShareCodeToBytes(String(shareCode).trim()));
  }

  function encodeBytes(model) {
    var normalized = normalizeModel(model);
    return L.encodeWithLayout(normalized, L.LAYOUTS[FORMAT]);
  }

  function encodeShareCode(model) {
    return A.bytesToCs2ShareCode(encodeBytes(model));
  }

  /* ---------------- 样式行为查询 ---------------- */
  function isStaticStyle(model) { return !styleInfo(model.style).dynamic; }
  /* 有开火反馈（k 脉冲）的样式：与「动态散布」区分——它不吃 spread_limit，预览仍可演示。 */
  function hasFireFeedback(model) { return !!styleInfo(model.style).feedback; }
  function isSplitStyle(model) { return !!styleInfo(model.style).split; }
  function isQuadStyle(model) { return !!styleInfo(model.style).quad; }
  function isDotOnlyStyle(model) { return !!styleInfo(model.style).dotOnly; }

  return {
    FORMAT: FORMAT,
    STYLES: STYLES,
    STYLE_NAMES: STYLE_NAMES,
    STYLE_NAMES_EN: STYLE_NAMES_EN,
    OUTLINE_MODES: OUTLINE_MODES,
    styleInfo: styleInfo,
    defaultModel: defaultModel,
    normalizeModel: normalizeModel,
    layoutFields: LAYOUT_FIELDS,
    isCs2ShareCode: isCs2ShareCode,
    decode: decodeShareCode,
    decodeBytes: decodeBytes,
    encode: encodeShareCode,
    encodeBytes: encodeBytes,
    isStaticStyle: isStaticStyle,
    hasFireFeedback: hasFireFeedback,
    isSplitStyle: isSplitStyle,
    isQuadStyle: isQuadStyle,
    isDotOnlyStyle: isDotOnlyStyle,
  };
});
