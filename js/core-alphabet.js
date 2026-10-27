/* =========================================================================
 * core-alphabet.js — Base57 容器编解码（与布局无关）
 *
 * 分享码本质是一个大整数，用 Base57 字母表书写，**最低位字符在前**：
 *   legacy 容器: CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX   25 字符 → 18 字节
 *   cs2    容器: CS + 44 字符（无分隔符）              44 字符 → 32 字节
 * 两种容器的 version 字节各自从 1 独立编号，因此「版本」必须与容器一起看。
 *
 * 校验和：byte0 = sum(bytes[1:]) & 0xff
 *
 * 格式基准：akiver/csgo-sharecode 7.0.1（见 test/vectors/ 对拍向量）。
 * 本文件不依赖任何布局知识，只负责 码 <-> 字节 <-> 大整数。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { root.CS2XH = root.CS2XH || {}; root.CS2XH.alphabet = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ALPHABET = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";
  var ALPHABET_LEN = BigInt(ALPHABET.length);

  // 容器规格：新增容器只加一项，编解码逻辑不变
  var CONTAINERS = {
    legacy: { name: "legacy", prefix: "CSGO", byteLength: 18, charCount: 25, dashed: true, versions: [1, 3, 4] },
    cs2: { name: "cs2", prefix: "CS", byteLength: 32, charCount: 44, dashed: false, versions: [1] },
  };

  var LEGACY_PATTERN = new RegExp("^CSGO(-?[" + ALPHABET + "]{5}){5}$");
  var CS2_PATTERN = new RegExp("^CS[" + ALPHABET + "]{44}$");
  var LEGACY_LOOSE_PATTERN = /^CSGO(-?[\w]{5}){5}$/;

  function shareCodeError(message) {
    var e = new Error(message);
    e.name = "CrosshairShareCodeError";
    return e;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /* ---------------- 字节 <-> 大整数 ---------------- */

  function bytesToBigInt(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) hex += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
    return BigInt("0x" + (hex || "0"));
  }

  function bigIntToBytes(big) {
    var hex = big.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    var out = [];
    for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }

  /* ---------------- 字符 <-> 字节 ---------------- */

  // chars 为**不含前缀/分隔符**的纯字母表字符串
  function charsToBytes(chars, byteLength) {
    var reversed = Array.from(chars).reverse(); // 最低位字符在前
    var big = BigInt(0);
    for (var i = 0; i < reversed.length; i++) {
      var idx = ALPHABET.indexOf(reversed[i]);
      if (idx === -1) throw shareCodeError("分享码包含无效字符: " + reversed[i]);
      big = big * ALPHABET_LEN + BigInt(idx);
    }
    var hex = big.toString(16);
    // 与基准实现一致：不截断也不补零，交由调用方按 byteLength 解释
    if (hex.length % 2) hex = "0" + hex;
    var bytes = [];
    for (var j = 0; j < hex.length; j += 2) bytes.push(parseInt(hex.slice(j, j + 2), 16));
    while (bytes.length < byteLength) bytes.unshift(0);
    return bytes;
  }

  function bytesToChars(bytes, charCount) {
    var total = bytesToBigInt(bytes);
    var chars = "";
    for (var i = 0; i < charCount; i++) {
      chars += ALPHABET[Number(total % ALPHABET_LEN)];
      total = total / ALPHABET_LEN;
    }
    return chars;
  }

  /* ---------------- 容器识别 ---------------- */

  function detectContainer(shareCode) {
    var code = String(shareCode == null ? "" : shareCode).trim();
    if (CS2_PATTERN.test(code)) return "cs2";
    if (LEGACY_PATTERN.test(code)) return "legacy";
    return null;
  }

  /* ---------------- 分享码 <-> 字节 ---------------- */

  function legacyShareCodeToBytes(shareCode) {
    if (!LEGACY_PATTERN.test(shareCode)) {
      throw shareCodeError("无效的 legacy 分享码格式，应为 CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX");
    }
    return charsToBytes(shareCode.replace(/CSGO|-/g, ""), CONTAINERS.legacy.byteLength);
  }

  function bytesToLegacyShareCode(bytes) {
    var chars = bytesToChars(bytes, CONTAINERS.legacy.charCount);
    return "CSGO-" + chars.slice(0, 5) + "-" + chars.slice(5, 10) + "-" + chars.slice(10, 15) +
      "-" + chars.slice(15, 20) + "-" + chars.slice(20, 25);
  }

  function cs2ShareCodeToBytes(shareCode) {
    if (!CS2_PATTERN.test(shareCode)) {
      throw shareCodeError("无效的 CS2 分享码格式，应为 CS + 44 位 Base57 字符");
    }
    return charsToBytes(shareCode.slice(CONTAINERS.cs2.prefix.length), CONTAINERS.cs2.byteLength);
  }

  function bytesToCs2ShareCode(bytes) {
    return CONTAINERS.cs2.prefix + bytesToChars(bytes, CONTAINERS.cs2.charCount);
  }

  // 自动识别容器
  function shareCodeToBytes(shareCode) {
    var container = detectContainer(shareCode);
    if (container === "cs2") return cs2ShareCodeToBytes(String(shareCode).trim());
    if (container === "legacy") return legacyShareCodeToBytes(String(shareCode).trim());
    throw shareCodeError("无法识别的分享码容器（既不是 CS... 也不是 CSGO-...）");
  }

  function bytesToShareCode(bytes, container) {
    return container === "cs2" ? bytesToCs2ShareCode(bytes) : bytesToLegacyShareCode(bytes);
  }

  /* ---------------- 校验和 ---------------- */

  function checksum(bytes) {
    var sum = 0;
    for (var i = 1; i < bytes.length; i++) sum += bytes[i];
    return sum & 0xff;
  }

  function verifyChecksum(bytes) {
    return bytes.length > 0 && bytes[0] === checksum(bytes);
  }

  // 写入 byte0（原地）
  function applyChecksum(bytes) {
    bytes[0] = 0;
    bytes[0] = checksum(bytes);
    return bytes;
  }

  function assertChecksum(bytes) {
    if (!verifyChecksum(bytes)) {
      throw shareCodeError("分享码校验和不匹配（码可能已损坏）");
    }
    return true;
  }

  /* ---------------- 整型 / 字节工具 ---------------- */

  function uint8ToInt8(v) { return (v << 24) >> 24; }
  function int8ToUint8(v) { return v & 0xff; }

  var api = {
    ALPHABET: ALPHABET,
    CONTAINERS: CONTAINERS,
    LEGACY_PATTERN: LEGACY_PATTERN,
    CS2_PATTERN: CS2_PATTERN,
    LEGACY_LOOSE_PATTERN: LEGACY_LOOSE_PATTERN,
    clamp: clamp,
    shareCodeError: shareCodeError,
    bytesToBigInt: bytesToBigInt,
    bigIntToBytes: bigIntToBytes,
    charsToBytes: charsToBytes,
    bytesToChars: bytesToChars,
    detectContainer: detectContainer,
    legacyShareCodeToBytes: legacyShareCodeToBytes,
    bytesToLegacyShareCode: bytesToLegacyShareCode,
    cs2ShareCodeToBytes: cs2ShareCodeToBytes,
    bytesToCs2ShareCode: bytesToCs2ShareCode,
    shareCodeToBytes: shareCodeToBytes,
    bytesToShareCode: bytesToShareCode,
    checksum: checksum,
    verifyChecksum: verifyChecksum,
    applyChecksum: applyChecksum,
    assertChecksum: assertChecksum,
    uint8ToInt8: uint8ToInt8,
    int8ToUint8: int8ToUint8,
  };
  return api;
});
