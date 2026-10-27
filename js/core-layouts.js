/* =========================================================================
 * core-layouts.js — 四种分享码布局的声明式字节表 + 位域读写引擎
 *
 * 布局以数据描述（字段名 / 字节偏移 / 位偏移 / 位宽 / 单位 / 取值范围），
 * 解码与编码由同一张表驱动，因此：
 *   · 新增布局（例如未来的 cs2-v2）只需在 LAYOUTS 里加一张表；
 *   · 字段的取值范围只写一次，编码裁剪与解码规范化自动一致。
 *
 * 位域一律为**小端位序**：bit0 = 该字节最低位，跨字节时按 bit 序号递增。
 * 整数字段：u8 / i8 / u16le / i16le / bits。
 * 浮点字段用 scale 表达步进（0.1 / 0.01），用 base 表达存储偏移
 * （例：outerSplitAlpha 存的是 ≥0.3 的 0.01 步数）。
 *
 * 格式基准：akiver/csgo-sharecode 7.0.1 src/{crosshair,legacy-crosshair}.ts
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { root.CS2XH = root.CS2XH || {}; root.CS2XH.layouts = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function uint8ToInt8(v) { return (v << 24) >> 24; }

  /* ---------------- 位域 ---------------- */

  function readBits(bytes, byteOffset, bitOffset, width) {
    var value = 0;
    for (var i = 0; i < width; i++) {
      var b = bitOffset + i;
      var byteIndex = byteOffset + (b >> 3);
      var raw = bytes[byteIndex] || 0;
      if ((raw >> (b & 7)) & 1) value |= 1 << i;
    }
    return value >>> 0;
  }

  function writeBits(bytes, byteOffset, bitOffset, width, value) {
    var v = value >>> 0;
    for (var i = 0; i < width; i++) {
      var b = bitOffset + i;
      var byteIndex = byteOffset + (b >> 3);
      var mask = 1 << (b & 7);
      if ((v >>> i) & 1) bytes[byteIndex] = (bytes[byteIndex] | mask) & 0xff;
      else bytes[byteIndex] = bytes[byteIndex] & ~mask & 0xff;
    }
  }

  /* ---------------- 字段读写 ---------------- */

  function rawValue(f) { return f.scale == null ? 1 : f.scale; }

  function readField(bytes, f) {
    var raw;
    switch (f.kind) {
      case "u8": raw = bytes[f.off] & 0xff; break;
      case "i8": raw = uint8ToInt8(bytes[f.off] & 0xff); break;
      case "u16le": raw = (bytes[f.off] & 0xff) | ((bytes[f.off + 1] & 0xff) << 8); break;
      case "i16le": raw = (((bytes[f.off] & 0xff) | ((bytes[f.off + 1] & 0xff) << 8)) << 16) >> 16; break;
      case "bits": raw = readBits(bytes, f.off, f.bit || 0, f.width); break;
      default: throw new Error("未支持的字段类型: " + f.kind);
    }
    if (f.rejectZero && raw === 0) {
      var e = new Error("字段 " + f.name + " 为 0，游戏会拒绝该分享码");
      e.name = "CrosshairShareCodeError";
      throw e;
    }
    if (f.bool) return raw !== 0;
    var value = (raw + (f.base || 0)) * rawValue(f);
    var lo = f.decodeMin != null ? f.decodeMin : f.min;
    var hi = f.decodeMax != null ? f.decodeMax : f.max;
    if (lo != null) value = Math.max(value, lo);
    if (hi != null) value = Math.min(value, hi);
    return roundFloat(value, f);
  }

  function writeField(bytes, f, input) {
    var value = f.bool ? (input ? 1 : 0) : Number(input);
    if (!isFinite(value)) value = f.def != null ? f.def : 0;
    if (!f.bool && f.min != null) value = Math.max(value, f.min);
    if (!f.bool && f.max != null) value = Math.min(value, f.max);
    var raw = Math.round(value / rawValue(f)) - (f.base || 0);
    switch (f.kind) {
      case "u8":
      case "i8":
        bytes[f.off] = raw & 0xff;
        break;
      case "u16le":
      case "i16le":
        bytes[f.off] = raw & 0xff;
        bytes[f.off + 1] = (raw >> 8) & 0xff;
        break;
      case "bits":
        writeBits(bytes, f.off, f.bit || 0, f.width, raw & ((1 << f.width) - 1));
        break;
      default:
        throw new Error("未支持的字段类型: " + f.kind);
    }
    return value;
  }

  // 0.01 / 0.1 步进在浮点下会产生 0.30000000000000004 之类噪声，统一收敛到 2 位小数
  function roundFloat(value, f) {
    var step = rawValue(f);
    if (step >= 1) return value;
    var digits = step >= 0.1 ? 1 : 2;
    var p = Math.pow(10, digits);
    return Math.round(value * p) / p;
  }

  /* ---------------- 布局表 ---------------- */

  // 公共字段：所有布局都以 byte0 = 校验和、byte1 = 版本号开头
  var HEADER = [
    { name: "checksum", kind: "u8", off: 0, min: 0, max: 255, zh: "校验和", doc: "sum(bytes[1:]) % 256" },
    { name: "version", kind: "u8", off: 1, min: 0, max: 255, zh: "版本号", doc: "按容器独立编号" },
  ];

  var LEGACY_V1 = {
    format: "legacy-v1",
    container: "legacy",
    version: 1,
    byteLength: 18,
    zh: "CS:GO 旧刻度（~2026-09-21）",
    doc: "厚/长/间隙为 0.1 步进任意刻度；无 screenHeight",
    fields: HEADER.concat([
      { name: "gap", kind: "i8", off: 2, scale: 0.1, zh: "间距", ui: { min: -12.8, max: 12.7, step: 0.1 } },
      { name: "outline", kind: "u8", off: 3, scale: 0.5, min: 0, zh: "描边粗细", ui: { min: 0, max: 3, step: 0.5 } },
      { name: "red", kind: "u8", off: 4, min: 0, max: 255, zh: "红" },
      { name: "green", kind: "u8", off: 5, min: 0, max: 255, zh: "绿" },
      { name: "blue", kind: "u8", off: 6, min: 0, max: 255, zh: "蓝" },
      { name: "alpha", kind: "u8", off: 7, min: 0, max: 255, zh: "不透明度" },
      { name: "splitDistance", kind: "bits", off: 8, bit: 0, width: 3, min: 0, max: 7, zh: "分裂距离" },
      { name: "followRecoil", kind: "bits", off: 8, bit: 7, width: 1, bool: true, zh: "跟随后坐力", doc: "仅 CS2" },
      { name: "fixedCrosshairGap", kind: "i8", off: 9, scale: 0.1, zh: "固定间距", doc: "新系统已删除" },
      { name: "color", kind: "bits", off: 10, bit: 0, width: 3, min: 0, max: 7, zh: "颜色预设" },
      { name: "outlineEnabled", kind: "bits", off: 10, bit: 3, width: 1, bool: true, zh: "描边开关" },
      { name: "innerSplitAlpha", kind: "bits", off: 10, bit: 4, width: 4, scale: 0.1, min: 0, max: 1.5, zh: "内分裂透明度" },
      { name: "outerSplitAlpha", kind: "bits", off: 11, bit: 0, width: 4, scale: 0.1, min: 0, max: 1.5, zh: "外分裂透明度" },
      { name: "splitSizeRatio", kind: "bits", off: 11, bit: 4, width: 4, scale: 0.1, min: 0, max: 1.5, zh: "分裂长度比例" },
      { name: "thickness", kind: "u8", off: 12, scale: 0.1, min: 0, max: 25.5, zh: "粗细" },
      { name: "style", kind: "bits", off: 13, bit: 1, width: 3, min: 0, max: 7, zh: "样式" },
      { name: "centerDotEnabled", kind: "bits", off: 13, bit: 4, width: 1, bool: true, zh: "中心点" },
      { name: "deployedWeaponGapEnabled", kind: "bits", off: 13, bit: 5, width: 1, bool: true, zh: "拉枪间距", doc: "新系统已删除" },
      { name: "alphaEnabled", kind: "bits", off: 13, bit: 6, width: 1, bool: true, zh: "启用透明度", doc: "新系统已删除" },
      { name: "tStyleEnabled", kind: "bits", off: 13, bit: 7, width: 1, bool: true, zh: "T 型" },
      { name: "length", kind: "u8", off: 14, scale: 0.1, min: 0, max: 25.5, zh: "长度" },
    ]),
  };

  // legacy-v3 / legacy-v4 共用像素段（byte2..byte17）
  var PIXEL_FIELDS = [
    { name: "style", kind: "bits", off: 2, bit: 0, width: 4, min: 0, max: 7, zh: "样式" },
    { name: "followRecoil", kind: "bits", off: 2, bit: 4, width: 1, bool: true, zh: "跟随后坐力" },
    { name: "centerDotEnabled", kind: "bits", off: 2, bit: 6, width: 1, bool: true, zh: "中心点" },
    { name: "tStyleEnabled", kind: "bits", off: 2, bit: 7, width: 1, bool: true, zh: "T 型" },
    { name: "red", kind: "u8", off: 3, min: 0, max: 255, zh: "红" },
    { name: "green", kind: "u8", off: 4, min: 0, max: 255, zh: "绿" },
    { name: "blue", kind: "u8", off: 5, min: 0, max: 255, zh: "蓝" },
    { name: "alpha", kind: "u8", off: 6, min: 0, max: 255, zh: "不透明度" },
    { name: "gap", kind: "u8", off: 7, min: 0, max: 255, zh: "间距", doc: "像素，非负" },
    { name: "length", kind: "u8", off: 8, min: 0, max: 255, zh: "长度", doc: "像素" },
    { name: "dynamicSpreadLimit", kind: "u8", off: 9, min: 0, max: 255, zh: "散布上限" },
    { name: "splitDistance", kind: "bits", off: 10, bit: 0, width: 7, min: 0, max: 127, zh: "分裂距离" },
    { name: "innerSplitAlpha", kind: "bits", off: 10, bit: 7, width: 5, scale: 0.05, min: 0, max: 1, zh: "内分裂透明度" },
    { name: "outerSplitAlpha", kind: "bits", off: 10, bit: 12, width: 4, scale: 0.05, base: 6, min: 0.3, max: 1, zh: "外分裂透明度" },
    { name: "splitSizeRatio", kind: "bits", off: 10, bit: 16, width: 7, scale: 0.01, min: 0, max: 1, zh: "分裂长度比例" },
    { name: "thickness", kind: "bits", off: 10, bit: 23, width: 5, min: 0, max: 31, zh: "粗细", doc: "像素" },
    { name: "screenHeight", kind: "u16le", off: 14, min: 0, max: 65535, zh: "屏幕高度" },
  ];

  var LEGACY_V3 = {
    format: "legacy-v3",
    container: "legacy",
    version: 3,
    byteLength: 18,
    zh: "过渡版像素刻度（2026-09-22 ~ 09-23）",
    doc: "像素单位 + screenHeight；outlineEnabled 布尔",
    fields: HEADER.concat([
      { name: "style", kind: "bits", off: 2, bit: 0, width: 4, min: 0, max: 7, zh: "样式" },
      { name: "followRecoil", kind: "bits", off: 2, bit: 4, width: 1, bool: true, zh: "跟随后坐力" },
      { name: "outlineEnabled", kind: "bits", off: 2, bit: 5, width: 1, bool: true, zh: "描边开关" },
      { name: "centerDotEnabled", kind: "bits", off: 2, bit: 6, width: 1, bool: true, zh: "中心点" },
      { name: "tStyleEnabled", kind: "bits", off: 2, bit: 7, width: 1, bool: true, zh: "T 型" },
    ]).concat(PIXEL_FIELDS.slice(4)),
  };

  var LEGACY_V4 = {
    format: "legacy-v4",
    container: "legacy",
    version: 4,
    byteLength: 18,
    zh: "过渡版像素刻度（2026-09-23 ~ 09-29）",
    doc: "= v3，样式扩到 0-8，描边改为 outlineMode 0/1/2",
    fields: HEADER.concat([
      { name: "style", kind: "bits", off: 2, bit: 0, width: 4, min: 0, max: 8, zh: "样式" },
      { name: "followRecoil", kind: "bits", off: 2, bit: 4, width: 1, bool: true, zh: "跟随后坐力" },
      { name: "centerDotEnabled", kind: "bits", off: 2, bit: 6, width: 1, bool: true, zh: "中心点" },
      { name: "tStyleEnabled", kind: "bits", off: 2, bit: 7, width: 1, bool: true, zh: "T 型" },
    ]).concat(PIXEL_FIELDS.slice(4)).concat([
      { name: "outlineMode", kind: "bits", off: 13, bit: 4, width: 2, min: 0, max: 2, zh: "描边模式", doc: "0 无 / 1 全 / 2 半" },
    ]),
  };

  var CS2_V1 = {
    format: "cs2-v1",
    container: "cs2",
    version: 1,
    byteLength: 32,
    zh: "CS2 当前格式（2026-09-30 起）",
    doc: "32 字节；像素刻度 + 描边 RGBA + scope dot；gap 为 int16",
    fields: HEADER.concat([
      { name: "screenHeight", kind: "u16le", off: 2, min: 0, max: 65535, decodeMin: 240, rejectZero: true, zh: "制作屏幕高度" },
      { name: "style", kind: "bits", off: 4, bit: 0, width: 5, min: 0, max: 9, zh: "样式" },
      { name: "followRecoil", kind: "bits", off: 4, bit: 5, width: 1, bool: true, zh: "跟随后坐力" },
      { name: "centerDotEnabled", kind: "bits", off: 4, bit: 6, width: 1, bool: true, zh: "中心点" },
      { name: "tStyleEnabled", kind: "bits", off: 4, bit: 7, width: 1, bool: true, zh: "T 型" },
      { name: "red", kind: "u8", off: 5, min: 0, max: 255, zh: "红" },
      { name: "green", kind: "u8", off: 6, min: 0, max: 255, zh: "绿" },
      { name: "blue", kind: "u8", off: 7, min: 0, max: 255, zh: "蓝" },
      { name: "alpha", kind: "u8", off: 8, min: 0, max: 255, zh: "不透明度" },
      { name: "outlineRed", kind: "u8", off: 9, min: 0, max: 255, zh: "描边红" },
      { name: "outlineGreen", kind: "u8", off: 10, min: 0, max: 255, zh: "描边绿" },
      { name: "outlineBlue", kind: "u8", off: 11, min: 0, max: 255, zh: "描边蓝" },
      { name: "outlineAlpha", kind: "u8", off: 12, min: 0, max: 255, zh: "描边不透明度" },
      { name: "thickness", kind: "bits", off: 13, bit: 0, width: 6, min: 0, max: 32, zh: "粗细", doc: "像素，绘制最小 1px", ui: { min: 0, max: 32, step: 1 } },
      { name: "outlineMode", kind: "bits", off: 13, bit: 6, width: 2, min: 0, max: 2, zh: "描边模式", doc: "0 无 / 1 全 / 2 半" },
      { name: "gap", kind: "i16le", off: 14, min: -3840, max: 3840, zh: "间距", doc: "像素，int16；菜单仅 style 2 可负", ui: { min: 0, max: 128, step: 1 } },
      { name: "length", kind: "u8", off: 16, min: 0, max: 255, zh: "长度", doc: "像素", ui: { min: 0, max: 255, step: 1 } },
      { name: "dynamicSpreadLimit", kind: "u8", off: 17, min: 0, max: 255, zh: "散布上限", ui: { min: 0, max: 255, step: 1 } },
      { name: "splitDistance", kind: "bits", off: 18, bit: 0, width: 7, min: 0, max: 127, zh: "分裂距离" },
      { name: "innerSplitAlpha", kind: "bits", off: 18, bit: 7, width: 7, scale: 0.01, min: 0, max: 1, zh: "内分裂透明度" },
      { name: "outerSplitAlpha", kind: "bits", off: 18, bit: 14, width: 7, scale: 0.01, base: 30, min: 0.3, max: 1, zh: "外分裂透明度" },
      { name: "splitSizeRatio", kind: "bits", off: 18, bit: 21, width: 7, scale: 0.01, min: 0, max: 1, zh: "分裂长度比例" },
      { name: "scopeDotUseCrosshairColor", kind: "bits", off: 18, bit: 28, width: 1, bool: true, zh: "镜内准星点随准星色" },
      { name: "scopeDotScale", kind: "u8", off: 22, scale: 0.01, base: 10, min: 0.1, max: 2, zh: "镜内准星点缩放", ui: { min: 0.1, max: 2, step: 0.01 } },
    ]),
  };

  var LAYOUTS = {};
  [LEGACY_V1, LEGACY_V3, LEGACY_V4, CS2_V1].forEach(function (l) { LAYOUTS[l.format] = l; });

  function layoutFor(container, version) {
    for (var k in LAYOUTS) {
      var l = LAYOUTS[k];
      if (l.container === container && l.version === version) return l;
    }
    return null;
  }

  // 从字节数组解析布局：容器已由容器识别决定，再读版本字节
  function resolveLayout(bytes, container) {
    return layoutFor(container, bytes[1]);
  }

  // 通用解码：按布局表读取全部字段
  function decodeWithLayout(bytes, layout) {
    var out = {};
    for (var i = 0; i < layout.fields.length; i++) {
      var f = layout.fields[i];
      if (f.name === "checksum") continue;
      out[f.name] = readField(bytes, f);
    }
    return out;
  }

  // 通用编码：按布局表写字段，最后补校验和
  function encodeWithLayout(values, layout) {
    var bytes = new Array(layout.byteLength).fill(0);
    for (var i = 0; i < layout.fields.length; i++) {
      var f = layout.fields[i];
      if (f.name === "checksum") continue;
      if (f.name === "version") { bytes[f.off] = layout.version; continue; }
      var v = values[f.name];
      if (v === undefined) v = f.bool ? false : (f.def != null ? f.def : 0);
      writeField(bytes, f, v);
    }
    var sum = 0;
    for (var j = 1; j < bytes.length; j++) sum += bytes[j];
    bytes[0] = sum & 0xff;
    return bytes;
  }

  // 供 UI / 文档使用的字段范围（含中文名与滑杆刻度）
  function fieldMeta(format) {
    var layout = LAYOUTS[format];
    if (!layout) return null;
    return layout.fields.map(function (f) {
      return {
        name: f.name, kind: f.kind, zh: f.zh || f.name, doc: f.doc || "",
        min: f.min, max: f.max, step: f.scale == null ? 1 : f.scale, ui: f.ui || null,
      };
    });
  }

  return {
    readBits: readBits,
    writeBits: writeBits,
    readField: readField,
    writeField: writeField,
    LAYOUTS: LAYOUTS,
    layoutFor: layoutFor,
    resolveLayout: resolveLayout,
    decodeWithLayout: decodeWithLayout,
    encodeWithLayout: encodeWithLayout,
    fieldMeta: fieldMeta,
  };
});
