/* =========================================================================
 * CS2 准星分享码编解码器 / 绘制 / cfg 转换
 * 格式兼容 CS2 官方分享码 (Base58 + 18字节校验负载)
 * ========================================================================= */
(function (global) {
  "use strict";

  var ALPHABET = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";
  var ALPHABET_LEN = BigInt(ALPHABET.length);
  var SHARECODE_PATTERN = /^CSGO(-?[\w]{5}){5}$/;
  // 官方颜色索引 -> RGB (0红 1绿 2黄 3蓝 4青, 5=自定义RGB)
  var PALETTE = [
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [0, 255, 255],
  ];

  var STYLES = [
    { value: 0, label: "Classic", zh: "经典" },
    { value: 1, label: "Legacy", zh: "传统" },
    { value: 2, label: "Classic Static", zh: "经典静态" },
  ];

  var COLOR_NAMES = ["红", "绿", "黄", "蓝", "青", "自定义"];

  function int8(v) {
    return v > 127 ? v - 256 : v;
  }
  function uint8(v) {
    return v < 0 ? v + 256 : v;
  }

  /* ---------------- 分享码 <-> 字节 ---------------- */

  function shareCodeToBytes(shareCode) {
    if (!SHARECODE_PATTERN.test(shareCode)) {
      throw new Error("无效的分享码格式，应为 CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX");
    }
    var chars = Array.from(shareCode.replace(/CSGO|-/g, "")).reverse();
    var big = 0n;
    for (var i = 0; i < chars.length; i++) {
      var idx = ALPHABET.indexOf(chars[i]);
      if (idx === -1) throw new Error("分享码包含无效字符: " + chars[i]);
      big = big * ALPHABET_LEN + BigInt(idx);
    }
    var bytes = new Uint8Array(18);
    for (var j = 17; j >= 0; j--) {
      bytes[j] = Number(big & 255n);
      big >>= 8n;
    }
    return bytes;
  }

  function bytesToShareCode(bytes) {
    var total = 0n;
    for (var i = 0; i < bytes.length; i++) {
      total = (total << 8n) | BigInt(bytes[i]);
    }
    var chars = "";
    for (var k = 0; k < 25; k++) {
      var rem = Number(total % ALPHABET_LEN);
      chars += ALPHABET[rem];
      total /= ALPHABET_LEN;
    }
    return (
      "CSGO-" +
      chars.slice(0, 5) +
      "-" +
      chars.slice(5, 10) +
      "-" +
      chars.slice(10, 15) +
      "-" +
      chars.slice(15, 20) +
      "-" +
      chars.slice(20, 25)
    );
  }

  /* ---------------- 编解码 ---------------- */

  function defaultSettings() {
    return {
      style: 2,
      centerDotEnabled: false,
      length: 5,
      thickness: 1,
      gap: 3,
      outlineEnabled: false,
      outline: 0.5,
      red: 0,
      green: 255,
      blue: 0,
      alphaEnabled: true,
      alpha: 200,
      tStyleEnabled: false,
      followRecoil: false,
      fixedCrosshairGap: 0,
      innerSplitAlpha: 1,
      outerSplitAlpha: 0.5,
      splitSizeRatio: 1,
      splitDistance: 7,
      deployedWeaponGapEnabled: false,
      color: 1,
    };
  }

  /* ---------------- 准星度量（CS2 官方像素换算） ---------------- */
  // 臂厚 f / 臂长 b / 间距 x 换算与 CS2 游戏内完全一致
  function crosshairMetrics(s, recoil) {
    var f = Math.max(1, Math.floor((s.thickness + 0.2222) / 0.4444));
    var b = Math.floor((s.length + 0.2222) / 0.4445);
    var gap = s.gap;
    var x = (gap < 0 ? -Math.floor(-gap) : Math.floor(gap)) + 4;
    if (s.style !== 2 || recoil) {
      x = (gap < -4 ? -Math.floor(-gap) : Math.floor(gap)) + 4;
      if (recoil && s.deployedWeaponGapEnabled) x += 3;
    } else {
      x += 1;
    }
    return { f: f, b: b, x: x, span: Math.max((x + b) * 2 + f, 1) };
  }

  function decodeShareCode(shareCode) {
    var bytes = shareCodeToBytes(shareCode);
    var checksum = 0;
    for (var i = 1; i < bytes.length; i++) checksum += bytes[i];
    checksum %= 256;
    if (bytes[0] !== checksum) {
      console.warn("校验和不匹配，继续解码");
    }
    var colorIdx = bytes[10] & 7;
    var r = bytes[4];
    var g = bytes[5];
    var b = bytes[6];
    if (colorIdx !== 5) {
      if (colorIdx >= 0 && colorIdx < PALETTE.length) {
        r = PALETTE[colorIdx][0];
        g = PALETTE[colorIdx][1];
        b = PALETTE[colorIdx][2];
      } else {
        r = 0;
        g = 255;
        b = 0;
      }
    }
    return {
      gap: int8(bytes[2]) / 10,
      outline: bytes[3] / 2,
      red: r,
      green: g,
      blue: b,
      alpha: bytes[7],
      splitDistance: bytes[8] & 127,
      followRecoil: (bytes[8] & 128) === 128,
      fixedCrosshairGap: int8(bytes[9]) / 10,
      color: colorIdx,
      outlineEnabled: (bytes[10] & 8) === 8,
      innerSplitAlpha: ((bytes[10] >> 4) & 15) / 10,
      outerSplitAlpha: (bytes[11] & 15) / 10,
      splitSizeRatio: ((bytes[11] >> 4) & 15) / 10,
      thickness: (bytes[12] & 63) / 10,
      style: (bytes[13] & 14) >> 1,
      centerDotEnabled: (bytes[13] & 16) === 16,
      deployedWeaponGapEnabled: (bytes[13] & 32) === 32,
      alphaEnabled: (bytes[13] & 64) === 64,
      tStyleEnabled: (bytes[13] & 128) === 128,
      length: (((bytes[15] & 31) << 8) + bytes[14]) / 10,
    };
  }

  function encodeShareCode(s) {
    var bytes = [0, 1];
    bytes.push(uint8(Math.round(10 * s.gap)));
    bytes.push(Math.floor(2 * s.outline));
    bytes.push(s.red & 255);
    bytes.push(s.green & 255);
    bytes.push(s.blue & 255);
    bytes.push(s.alpha & 255);
    bytes.push((s.splitDistance & 127) | (s.followRecoil ? 128 : 0));
    bytes.push(uint8(Math.round(10 * s.fixedCrosshairGap)));
    bytes.push(
      (s.color & 7) |
        (s.outlineEnabled ? 8 : 0) |
        ((Math.round(10 * s.innerSplitAlpha) & 15) << 4)
    );
    bytes.push(
      (Math.round(10 * s.outerSplitAlpha) & 15) |
        ((Math.round(10 * s.splitSizeRatio) & 15) << 4)
    );
    bytes.push(Math.round(10 * s.thickness));
    bytes.push(
      ((s.style & 7) << 1) |
        (s.centerDotEnabled ? 16 : 0) |
        (s.deployedWeaponGapEnabled ? 32 : 0) |
        (s.alphaEnabled ? 64 : 0) |
        (s.tStyleEnabled ? 128 : 0)
    );
    var len10 = Math.round(10 * s.length);
    bytes.push(len10 % 256);
    bytes.push(Math.floor(len10 / 256));
    bytes.push(0);
    bytes.push(0);
    var sum = 0;
    for (var i = 1; i < bytes.length; i++) sum += bytes[i];
    bytes[0] = sum % 256;
    return bytesToShareCode(new Uint8Array(bytes));
  }

  /* ---------------- 控制台命令 / cfg ---------------- */

  var CONVAR_MAP = [
    ["cl_crosshairgap", "gap"],
    ["cl_crosshair_outlinethickness", "outline"],
    ["cl_crosshaircolor_r", "red"],
    ["cl_crosshaircolor_g", "green"],
    ["cl_crosshaircolor_b", "blue"],
    ["cl_crosshairalpha", "alpha"],
    ["cl_crosshair_dynamic_splitdist", "splitDistance"],
    ["cl_crosshair_recoil", "followRecoil"],
    ["cl_fixedcrosshairgap", "fixedCrosshairGap"],
    ["cl_crosshaircolor", "color"],
    ["cl_crosshair_drawoutline", "outlineEnabled"],
    ["cl_crosshair_dynamic_splitalpha_innermod", "innerSplitAlpha"],
    ["cl_crosshair_dynamic_splitalpha_outermod", "outerSplitAlpha"],
    ["cl_crosshair_dynamic_maxdist_splitratio", "splitSizeRatio"],
    ["cl_crosshairthickness", "thickness"],
    ["cl_crosshairdot", "centerDotEnabled"],
    ["cl_crosshairgap_useweaponvalue", "deployedWeaponGapEnabled"],
    ["cl_crosshairusealpha", "alphaEnabled"],
    ["cl_crosshair_t", "tStyleEnabled"],
    ["cl_crosshairstyle", "style"],
    ["cl_crosshairsize", "length"],
  ];

  function settingsToConVars(s) {
    return CONVAR_MAP.map(function (pair) {
      return pair[0] + ' "' + s[pair[1]] + '"';
    });
  }

  function settingsToCfg(s) {
    return settingsToConVars(s).join("\n");
  }

  function settingsToConsoleLine(s) {
    return settingsToConVars(s).join(";");
  }

  function parseConVars(text) {
    var out = {};
    var num = function (v) {
      var n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    var bool = function (v) {
      var s = String(v).toLowerCase();
      if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
      if (s === "0" || s === "false" || s === "no" || s === "off") return false;
      return null;
    };
    var lines = String(text)
      .split(/[;\n\r]+/)
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^\s*(cl_[a-z0-9_]+)\s*[= ]\s*(.+?)\s*$/i);
      if (!m) continue;
      var key = m[1].toLowerCase();
      var val = m[2].trim().replace(/^["']|["']$/g, "");
      var setting = null;
      for (var j = 0; j < CONVAR_MAP.length; j++) {
        if (CONVAR_MAP[j][0] === key) {
          setting = CONVAR_MAP[j][1];
          break;
        }
      }
      if (!setting) continue;
      if (setting === "outlineEnabled" || setting === "centerDotEnabled" ||
          setting === "deployedWeaponGapEnabled" || setting === "alphaEnabled" ||
          setting === "tStyleEnabled" || setting === "followRecoil") {
        var b = bool(val);
        if (b !== null) out[setting] = b;
      } else {
        var n = num(val);
        if (n !== null) out[setting] = n;
      }
    }
    var merged = defaultSettings();
    for (var k in out) merged[k] = out[k];
    return merged;
  }

  /* ---------------- 随机准星 ---------------- */

  function randomSettings() {
    var s = defaultSettings();
    s.style = Math.floor(Math.random() * 3);
    s.length = Math.round((1 + Math.random() * 5) * 10) / 10;
    s.thickness = Math.round((0.5 + Math.random() * 2.5) * 10) / 10;
    s.gap = Math.round((Math.random() * 8 - 3) * 10) / 10;
    s.outlineEnabled = Math.random() < 0.3;
    s.outline = [0.5, 1, 1.5, 2][Math.floor(Math.random() * 4)];
    s.alpha = Math.floor(150 + Math.random() * 105);
    s.alphaEnabled = Math.random() < 0.9;
    s.centerDotEnabled = Math.random() < 0.35;
    s.tStyleEnabled = Math.random() < 0.15;
    s.followRecoil = Math.random() < 0.25;
    s.fixedCrosshairGap = Math.round(Math.random() * 10 * 10) / 10;
    s.deployedWeaponGapEnabled = Math.random() < 0.3;
    s.color = Math.floor(Math.random() * 6);
    if (s.color === 5) {
      var hue = Math.floor(Math.random() * 360);
      var c = hslToRgb(hue / 360, 1, 0.5);
      s.red = c[0];
      s.green = c[1];
      s.blue = c[2];
    } else {
      var p = PALETTE[s.color];
      s.red = p[0];
      s.green = p[1];
      s.blue = p[2];
    }
    s.splitDistance = Math.floor(1 + Math.random() * 20);
    s.splitSizeRatio = Math.round((0.3 + Math.random() * 0.7) * 10) / 10;
    s.innerSplitAlpha = Math.round((0.5 + Math.random() * 0.5) * 10) / 10;
    s.outerSplitAlpha = Math.round((0.2 + Math.random() * 0.8) * 10) / 10;
    return s;
  }

  function hslToRgb(h, s, l) {
    var r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  /* ---------------- Canvas 准星绘制（CS2 官方像素级） ---------------- */

  function drawCrosshair(canvas, settings, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var rect = parent ? parent.getBoundingClientRect() : null;
    var w, h;
    if (rect && rect.width > 0 && rect.height > 0) {
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
    } else {
      w = parseInt(canvas.style.width, 10) || canvas.width || 100;
      h = parseInt(canvas.style.height, 10) || canvas.height || 100;
    }
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    var cx = w / 2, cy = h / 2;
    var m = crosshairMetrics(settings);
    var f = m.f, b = m.b, x = m.x;
    var hw = f / 2;
    var alpha = (settings.alphaEnabled ? settings.alpha : 200) / 255;

    // 彩色准星各臂矩形 [x, y, w, h]
    var rects = [
      [cx + x, cy - hw, b, f],       // 右臂
      [cx - x - b, cy - hw, b, f],   // 左臂
      [cx - hw, cy + x, f, b],       // 下臂
    ];
    if (!settings.tStyleEnabled) rects.push([cx - hw, cy - x - b, f, b]); // 上臂
    if (settings.centerDotEnabled) rects.push([cx - hw, cy - hw, f, f]);   // 中心点

    // 黑色描边底层：每侧外扩 outline 像素（CS2 官方方式，仅外侧有描边）
    if (settings.outlineEnabled && settings.outline > 0) {
      var ou = settings.outline;
      ctx.fillStyle = "#000";
      ctx.globalAlpha = 1;
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        ctx.fillRect(r[0] - ou, r[1] - ou, r[2] + ou * 2, r[3] + ou * 2);
      }
    }

    // 彩色准星上层
    ctx.fillStyle = "rgb(" + settings.red + "," + settings.green + "," + settings.blue + ")";
    ctx.globalAlpha = alpha;
    for (var j = 0; j < rects.length; j++) {
      ctx.fillRect(rects[j][0], rects[j][1], rects[j][2], rects[j][3]);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- 导出 ---------------- */

  var api = {
    ALPHABET: ALPHABET,
    STYLES: STYLES,
    COLOR_NAMES: COLOR_NAMES,
    PALETTE: PALETTE,
    defaultSettings: defaultSettings,
    crosshairMetrics: crosshairMetrics,
    randomSettings: randomSettings,
    decodeShareCode: decodeShareCode,
    encodeShareCode: encodeShareCode,
    shareCodeToBytes: shareCodeToBytes,
    bytesToShareCode: bytesToShareCode,
    settingsToConVars: settingsToConVars,
    settingsToCfg: settingsToCfg,
    settingsToConsoleLine: settingsToConsoleLine,
    parseConVars: parseConVars,
    drawCrosshair: drawCrosshair,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.CS2Crosshair = api;
})(typeof window !== "undefined" ? window : globalThis);