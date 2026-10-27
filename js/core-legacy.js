/* =========================================================================
 * core-legacy.js — legacy 容器三种布局（v1 / v3 / v4）的读写
 *
 * 为什么叫 legacy：CS2 自 2026-09-30 起**只接受** CS 容器（cs2-v1），
 * 旧 CSGO- 容器整体被游戏拒绝导入。因此本模块只用于两件事：
 *   1) 解析历史数据（players.js 的 1854 条旧码）供展示与迁移；
 *   2) 作为对拍 oracle 的回归基准（test/vectors）。
 * 这里**不参与**任何对外生成路径——生成一律走 cs2-v1（core-codec.js）。
 *
 * 解码后返回「旧刻度」字段，与分享码字节一一对应，不做任何换算；
 * 旧刻度 → 新像素模型的换算全部在 core-convert.js。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({ alphabet: require("./core-alphabet.js"), layouts: require("./core-layouts.js") });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2XH.legacy = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var A = NS.alphabet;
  var L = NS.layouts;

  // 旧样式编号含义随时代变化，两套表分开维护（新编号语义全变，禁止按编号直搬）
  // CS:GO 时代（legacy-v1）
  var LEGACY_V1_STYLE_NAMES = {
    0: "默认", 1: "默认静态", 2: "经典", 3: "经典动态", 4: "经典静态", 5: "传统 Legacy", 6: "样式 6", 7: "样式 7",
  };
  // CS2 过渡期（legacy-v3 / v4）已启用新语义编号
  var LEGACY_PIXEL_STYLE_NAMES = {
    0: "动态十字", 1: "动态圆形", 2: "动态十字（经典）", 3: "静态圆形", 4: "静态十字",
    5: "动态十字[旧版/射击反馈]", 6: "仅限圆点", 7: "动态象限", 8: "静态方形",
    9: "静态象限",
  };

  function styleName(format, style) {
    var table = format === "legacy-v1" ? LEGACY_V1_STYLE_NAMES : LEGACY_PIXEL_STYLE_NAMES;
    return table[style] || ("样式 " + style);
  }

  function decodeBytes(bytes) {
    A.assertChecksum(bytes);
    var layout = L.resolveLayout(bytes, "legacy");
    if (!layout) {
      var e = new Error("不支持的 legacy 版本号: " + bytes[1] + "（v2 不存在，客户端会直接拒绝）");
      e.name = "CrosshairShareCodeError";
      throw e;
    }
    var values = L.decodeWithLayout(bytes, layout);
    values.format = layout.format;
    values.version = layout.version;
    return values;
  }

  function decode(shareCode) {
    return decodeBytes(A.legacyShareCodeToBytes(String(shareCode).trim()));
  }

  function encodeBytes(crosshair) {
    var format = crosshair && crosshair.format ? crosshair.format : "legacy-v1";
    var layout = L.LAYOUTS[format];
    if (!layout || layout.container !== "legacy") {
      var e = new Error("不支持的 legacy 输出格式: " + format);
      e.name = "CrosshairShareCodeError";
      throw e;
    }
    return L.encodeWithLayout(crosshair, layout);
  }

  function encode(crosshair) {
    return A.bytesToLegacyShareCode(encodeBytes(crosshair));
  }

  // 用于 UI 的字段快照（含中文名与范围），不参与编解码
  function fieldMeta(format) { return L.fieldMeta(format); }

  return {
    LEGACY_V1_STYLE_NAMES: LEGACY_V1_STYLE_NAMES,
    LEGACY_PIXEL_STYLE_NAMES: LEGACY_PIXEL_STYLE_NAMES,
    styleName: styleName,
    decode: decode,
    decodeBytes: decodeBytes,
    encode: encode,
    encodeBytes: encodeBytes,
    fieldMeta: fieldMeta,
  };
});
