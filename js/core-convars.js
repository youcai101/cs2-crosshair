/* =========================================================================
 * core-convars.js — 新准星系统的 convar 双向映射
 *
 * 命令集以 akiver/csgo-sharecode 7.0.1 的 cs2-v1 输出为准（19 条），
 * 再加上本站的投掷物准星指令。
 *
 * 规则：
 *   · 已删除的旧 convar（cl_crosshair_outlinethickness / cl_fixedcrosshairgap /
 *     cl_crosshairgap_useweaponvalue / cl_crosshairusealpha / cl_crosshaircolor）
 *     **绝不输出**，只作为「旧文本兼容解析」的输入；
 *   · 样式条件输出：split* 仅 style 2；描边颜色仅开启描边；spread limit 仅动态样式；
 *   · 输出前一律按布局表的取值范围裁剪；
 *   · 控制台是单行的，必须分号分隔且每段 ≤ 512 字符（COMMAND_MAX_LENGTH）。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({
      codec: require("./core-codec.js"),
      convert: require("./core-convert.js"),
    });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2XH.convars = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var Codec = NS.codec;
  var Convert = NS.convert;

  var PASTE_LIMIT = 512; // Source 控制台 COMMAND_MAX_LENGTH

  /* 旧 convar 分两类，**策略上都不输出**，但措辞不能混（并集 = NEVER_OUTPUT，共 9 条）：

   *   · REMOVED_CONVARS（6 条）—— 客户端已移除：本机 1.41.9.1 的用户配置里**查不到**它们。
   *   · HIDDEN_LEGACY_CONVARS（3 条）—— 客户端**仍保留但标记 hidden**，且不参与新准星渲染。
   *     实测（2026-10-15，cs2_user_convars_0_slot0.vcfg）：客户端会继续把这三个写进用户配置，
   *     值还是旧时代的残留（0.5 / 2 / 255），且与 cl_crosshair_length/_thickness/color_a 并存。
   *     这些值**不支持任何换算**：旧 thickness 0.5 按旧公式应得 1，实际是 2。不要据此反推新值。
   *
   * 实测方法是「存在可证、不存在不可证」：用户配置是稀疏存档，只写非默认值，
   * 因此「不在配置里」只能作为「很可能已移除」的旁证，不是硬证据。
   */
  var REMOVED_CONVARS = [
    "cl_crosshair_outlinethickness",
    "cl_fixedcrosshairgap",
    "cl_crosshairgap_useweaponvalue",
    "cl_crosshairusealpha",
    "cl_crosshaircolor",
    "cl_crosshairgap",
  ];
  var HIDDEN_LEGACY_CONVARS = ["cl_crosshairsize", "cl_crosshairthickness", "cl_crosshairalpha"];
  var NEVER_OUTPUT = REMOVED_CONVARS.concat(HIDDEN_LEGACY_CONVARS);

  /* 镜内准星线宽（附加项）。
   * 实测存在（2026-10-15 本机 1.41.9.1 vcfg）：cl_crosshair_sniper_width 默认 0。
   * 这是「客户端真实存在、但不在分享码布局里」的附加项：只进导入解析（EXTRA_NUMERIC）；
   * 不进单行粘贴命令（粘贴行只放准星本体，保「一次粘贴生效」），不进分享码。 */
  var SNIPER_FIELD = ["cl_crosshair_sniper_width", "sniperWidth"];

  function bool01(v) { return v ? 1 : 0; }
  function conVarValue(v) { return typeof v === "boolean" ? (v ? "1" : "0") : String(v); }
  function num(v) { return Math.round(Number(v) * 1000) / 1000; }

  /* ---------------- 输出 ---------------- */

  // 新命令表（顺序固定，便于对拍与阅读）
  function toCommands(model) {
    var m = Codec.normalizeModel(model);
    var info = Codec.styleInfo(m.style);
    var dynamic = !!info.dynamic;
    var outlineOn = m.outlineMode !== 0;

    var rows = [
      ["cl_crosshairstyle", m.style],
      ["cl_crosshair_length", m.length],
      ["cl_crosshair_thickness", m.thickness],
      ["cl_crosshair_gap", m.gap],
      ["cl_crosshaircolor_r", m.red],
      ["cl_crosshaircolor_g", m.green],
      ["cl_crosshaircolor_b", m.blue],
      ["cl_crosshaircolor_a", m.alpha],
      ["cl_crosshairdot", bool01(m.centerDotEnabled)],
      ["cl_crosshair_t", bool01(m.tStyleEnabled)],
      ["cl_crosshair_drawoutline", m.outlineMode],
      ["cl_crosshair_screen_height", m.screenHeight],
      ["cl_crosshair_recoil", bool01(m.followRecoil)],
    ];
    // 描边颜色只在开启描边时有意义
    if (outlineOn) {
      rows.push(["cl_crosshairoutline_r", m.outlineRed]);
      rows.push(["cl_crosshairoutline_g", m.outlineGreen]);
      rows.push(["cl_crosshairoutline_b", m.outlineBlue]);
      rows.push(["cl_crosshairoutline_a", m.outlineAlpha]);
    }
    // 散布上限只对动态样式生效
    if (dynamic) rows.push(["cl_crosshair_dynamic_spread_limit", m.dynamicSpreadLimit]);
    // 分裂参数只在「经典」样式生效
    if (Codec.isSplitStyle(m)) {
      rows.push(["cl_crosshair_dynamic_splitdist", m.splitDistance]);
      rows.push(["cl_crosshair_dynamic_splitalpha_innermod", num(m.innerSplitAlpha)]);
      rows.push(["cl_crosshair_dynamic_splitalpha_outermod", num(m.outerSplitAlpha)]);
      rows.push(["cl_crosshair_dynamic_maxdist_splitratio", num(m.splitSizeRatio)]);
    }
    // 镜内准星点
    rows.push(["cl_ironsight_dot_scale", num(m.scopeDotScale)]);
    rows.push(["cl_ironsight_usecrosshaircolor", bool01(m.scopeDotUseCrosshairColor)]);

    return rows.map(function (r) { return r[0] + " " + conVarValue(r[1]); });
  }

  function toCmdRows(model) {
    var m = Codec.normalizeModel(model);
    var rows = toCommands(m).map(function (line) {
      var i = line.indexOf(" ");
      return [line.slice(0, i), line.slice(i + 1)];
    });
    // 附加项：镜内线宽（客户端真实存在的附加 convar，不进分享码）
    rows.push([SNIPER_FIELD[0], num(m[SNIPER_FIELD[1]])]);
    return rows;
  }

  /* ---------------- 控制台单行粘贴 ---------------- */

  /* 单行粘贴用的命令集：目标是**粘一次回车就生效，且永远只有一段**。
   * 命令分两层：
   *   · 核心 12 条（准星的可见身份）——永远发送：style / length / thickness / gap /
   *     RGBA / dot / t / drawoutline / screen_height。其中 drawoutline 的游戏出厂值是开，
   *     所以「关描边」也必须显式发 0。
   *   · 条件尾部（描边 RGBA / 动态扩散上限 / recoil / 分裂×4 / 镜内×2）——
   *     仅在取值偏离默认模型时发送。全新安装的游戏与 defaultModel 一致
   *     （描边黑色 a255、分裂 7/1/0.5/1、扩散 255、镜内 1/关），
   *     省略即等价，却把单行从 ~540 字符压回 ~380，保证 512 内一次粘贴。
   *     （库内选手准星的分裂/扩散/镜内参数全部来自 defaultModel，因此**全部单行可贴**。）
   * 依据：cs2util 输出的同类单行串约 550-600 字符实测可用；但 512 仍是保守硬限，
   * 压不进 512 的极端组合（style 2/5 + 自定义分裂 + 自定义描边色 ≈ 542）保留分段兜底。 */
  function pasteCommands(model) {
    var m = Codec.normalizeModel(model);
    var d = Codec.defaultModel();
    var info = Codec.styleInfo(m.style);
    var out = [];
    var add = function (k, v) { out.push(k + " " + conVarValue(v)); };
    var diff = function (v, dv) { return conVarValue(v) !== conVarValue(dv); };

    add("cl_crosshairstyle", m.style);
    add("cl_crosshair_length", m.length);
    add("cl_crosshair_thickness", m.thickness);
    add("cl_crosshair_gap", m.gap);
    add("cl_crosshaircolor_r", m.red);
    add("cl_crosshaircolor_g", m.green);
    add("cl_crosshaircolor_b", m.blue);
    add("cl_crosshaircolor_a", m.alpha);
    add("cl_crosshairdot", bool01(m.centerDotEnabled));
    add("cl_crosshair_t", bool01(m.tStyleEnabled));
    add("cl_crosshair_drawoutline", m.outlineMode);
    add("cl_crosshair_screen_height", m.screenHeight);
    if (m.outlineMode !== 0) {
      if (diff(m.outlineRed, d.outlineRed)) add("cl_crosshairoutline_r", m.outlineRed);
      if (diff(m.outlineGreen, d.outlineGreen)) add("cl_crosshairoutline_g", m.outlineGreen);
      if (diff(m.outlineBlue, d.outlineBlue)) add("cl_crosshairoutline_b", m.outlineBlue);
      if (diff(m.outlineAlpha, d.outlineAlpha)) add("cl_crosshairoutline_a", m.outlineAlpha);
    }
    if (info.dynamic) {
      if (diff(m.followRecoil, d.followRecoil)) add("cl_crosshair_recoil", bool01(m.followRecoil));
      if (diff(m.dynamicSpreadLimit, d.dynamicSpreadLimit)) add("cl_crosshair_dynamic_spread_limit", m.dynamicSpreadLimit);
    }
    if (Codec.isSplitStyle(m)) {
      if (diff(m.splitDistance, d.splitDistance)) add("cl_crosshair_dynamic_splitdist", m.splitDistance);
      if (diff(m.innerSplitAlpha, d.innerSplitAlpha)) add("cl_crosshair_dynamic_splitalpha_innermod", num(m.innerSplitAlpha));
      if (diff(m.outerSplitAlpha, d.outerSplitAlpha)) add("cl_crosshair_dynamic_splitalpha_outermod", num(m.outerSplitAlpha));
      if (diff(m.splitSizeRatio, d.splitSizeRatio)) add("cl_crosshair_dynamic_maxdist_splitratio", num(m.splitSizeRatio));
    }
    if (diff(m.scopeDotScale, d.scopeDotScale)) add("cl_ironsight_dot_scale", num(m.scopeDotScale));
    if (diff(m.scopeDotUseCrosshairColor, d.scopeDotUseCrosshairColor)) add("cl_ironsight_usecrosshaircolor", bool01(m.scopeDotUseCrosshairColor));
    // 注意：附加项（镜内线宽）**故意不在此输出**，只进导入解析，见文件头注释
    return out;
  }

  function toPasteChunks(model, limit) {
    limit = limit || PASTE_LIMIT;
    var cmds = pasteCommands(model);
    var chunks = [];
    var cur = [];
    var len = 0;
    for (var i = 0; i < cmds.length; i++) {
      var extra = (cur.length ? 1 : 0) + cmds[i].length;
      if (cur.length && len + extra > limit) { chunks.push(cur.join(";")); cur = []; len = 0; }
      cur.push(cmds[i]);
      len += (cur.length > 1 ? 1 : 0) + cmds[i].length;
    }
    if (cur.length) chunks.push(cur.join(";"));
    return chunks;
  }

  function toPasteLine(model, limit) { return toPasteChunks(model, limit).join(";"); }

  /* ---------------- 解析（新命令直读 + 旧命令兼容换算） ---------------- */

  var NEW_NUMERIC = {
    "cl_crosshairstyle": "style",
    "cl_crosshair_length": "length",
    "cl_crosshair_thickness": "thickness",
    "cl_crosshair_gap": "gap",
    "cl_crosshaircolor_r": "red",
    "cl_crosshaircolor_g": "green",
    "cl_crosshaircolor_b": "blue",
    "cl_crosshaircolor_a": "alpha",
    "cl_crosshairoutline_r": "outlineRed",
    "cl_crosshairoutline_g": "outlineGreen",
    "cl_crosshairoutline_b": "outlineBlue",
    "cl_crosshairoutline_a": "outlineAlpha",
    "cl_crosshair_drawoutline": "outlineMode",
    "cl_crosshair_screen_height": "screenHeight",
    "cl_crosshair_dynamic_spread_limit": "dynamicSpreadLimit",
    "cl_crosshair_dynamic_splitdist": "splitDistance",
    "cl_crosshair_dynamic_splitalpha_innermod": "innerSplitAlpha",
    "cl_crosshair_dynamic_splitalpha_outermod": "outerSplitAlpha",
    "cl_crosshair_dynamic_maxdist_splitratio": "splitSizeRatio",
    "cl_ironsight_dot_scale": "scopeDotScale",
  };
  var NEW_BOOL = {
    "cl_crosshairdot": "centerDotEnabled",
    "cl_crosshair_t": "tStyleEnabled",
    "cl_crosshair_recoil": "followRecoil",
    "cl_ironsight_usecrosshaircolor": "scopeDotUseCrosshairColor",
  };
  // 附加项：镜内线宽 —— 客户端真实存在，可解析可写 .cfg
  var EXTRA_NUMERIC = {
    "cl_crosshair_sniper_width": "sniperWidth",
  };

  // 旧 convar → 处理分支（只解析，绝不输出）
  // 旧系统专属命令名（LEGACY_ONLY 与 REMOVED_CONVARS 的交集 + 三个 hidden 项）
  var LEGACY_ONLY = [
    "cl_crosshairsize", "cl_crosshairthickness", "cl_crosshairgap",
    "cl_crosshairalpha", "cl_crosshairusealpha", "cl_crosshaircolor",
    "cl_crosshair_outlinethickness", "cl_fixedcrosshairgap", "cl_crosshairgap_useweaponvalue",
  ];

  /* 只在新准星系统里出现过的命令名。
   * 用途：判断一段文本到底是「旧系统文本」还是「新系统文本里混着旧残留」。
   * 实测依据（2026-10-15 本机 CS2 1.41.9.1 的 cs2_user_convars_0_slot0.vcfg）：
   * 客户端仍会把 cl_crosshairsize / cl_crosshairthickness / cl_crosshairalpha 写进用户配置，
   * 与新系统的 cl_crosshair_length / cl_crosshair_thickness / cl_crosshaircolor_a **同时存在**。
   * 只按「出现旧名」判定会把整段当成旧文本，进而用旧编号重映射 style、用旧公式换算 gap —— 那是错的。 */
  var NEW_ONLY = [
    "cl_crosshair_gap", "cl_crosshair_length", "cl_crosshair_thickness", "cl_crosshaircolor_a",
    "cl_crosshairoutline_r", "cl_crosshairoutline_g", "cl_crosshairoutline_b", "cl_crosshairoutline_a",
    "cl_crosshair_screen_height", "cl_crosshair_dynamic_spread_limit",
    "cl_ironsight_dot_scale", "cl_ironsight_usecrosshaircolor",
  ];

  function parseBool(v) {
    var s = String(v).toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return null;
  }

  function tokenize(text) {
    return String(text)
      .split(/[;\n\r]+/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var m = line.match(/^\s*(cl_[a-z0-9_]+)\s*[= ]\s*(.+?)\s*$/i);
        return m ? { key: m[1].toLowerCase(), value: m[2].trim().replace(/^["']|["']$/g, "") } : null;
      })
      .filter(Boolean);
  }

  /* 解析任意来源的文本 → 新模型。
   * 同时出现旧命令名时按「旧刻度换算」处理（需要 style 已知来选间距分支）。
   * 返回 { model, migration, recognized, ignored }。 */
  function parse(text, opts) {
    opts = opts || {};
    var tokens = tokenize(text);
    var keys = tokens.map(function (t) { return t.key; });
    var hasLegacyOnly = keys.some(function (k) { return LEGACY_ONLY.indexOf(k) !== -1; });
    var hasNewOnly = keys.some(function (k) { return NEW_ONLY.indexOf(k) !== -1; });
    // 出现新专属命令名 → 这是新系统文本，里面的旧命令一律当存档残留忽略；
    // 只有「有旧名、且一个旧名之外的新名都没有」才按旧系统文本走换算路径。
    var looksLegacy = hasLegacyOnly && !hasNewOnly;

    var model = Codec.defaultModel();
    var ignored = [];
    var recognized = [];
    var leftover = [];
    // 旧文本里的描边是「开关 + 粗细」两个 convar，新系统是单一三态；
    // 必须等两个值都读完再决定模式，否则后出现的 cl_crosshair_drawoutline 会覆盖掉粗细推导出的「半描边」。
    var legacyOutline = { enabled: null, thickness: null };
    var legacyGap = null;

    for (var i = 0; i < tokens.length; i++) {
      var key = tokens[i].key;
      var val = tokens[i].value;
      // 新系统文本里的旧 convar（客户端存档残留）：直接忽略，不得参与换算
      if (!looksLegacy && LEGACY_ONLY.indexOf(key) !== -1) {
        leftover.push(key);
        continue;
      }
      if (looksLegacy && key === "cl_crosshair_drawoutline") {
        var dOb = parseBool(val);
        legacyOutline.enabled = dOb === null ? parseFloat(val) > 0 : dOb;
        recognized.push(key);
        continue;
      }
      if (looksLegacy && key === "cl_crosshair_outlinethickness") {
        var dOt = parseFloat(val);
        if (isFinite(dOt)) legacyOutline.thickness = dOt;
        recognized.push(key);
        continue;
      }
      if (NEW_BOOL[key]) {
        var b = parseBool(val);
        if (b !== null) { model[NEW_BOOL[key]] = b; recognized.push(key); }
        continue;
      }
      if (EXTRA_NUMERIC[key]) {
        var xn = parseFloat(val);
        if (isFinite(xn)) { model[EXTRA_NUMERIC[key]] = xn; recognized.push(key); }
        continue;
      }
      if (NEW_NUMERIC[key]) {
        var n = parseFloat(val);
        if (isFinite(n)) { model[NEW_NUMERIC[key]] = n; recognized.push(key); }
        continue;
      }
      // ---- 旧命令兼容 ----
      if (key === "cl_crosshairalpha") {
        var a = parseFloat(val);
        if (isFinite(a)) { model.alpha = Math.max(0, Math.min(255, a)); recognized.push(key); }
        continue;
      }
      if (key === "cl_crosshairusealpha") {
        var ua = parseBool(val);
        if (ua === false) model.alpha = 255;
        recognized.push(key);
        continue;
      }
      if (key === "cl_crosshaircolor") {
        var c = parseInt(val, 10);
        if (c >= 0 && c < Convert.PALETTE.length) {
          model.red = Convert.PALETTE[c][0]; model.green = Convert.PALETTE[c][1]; model.blue = Convert.PALETTE[c][2];
        }
        recognized.push(key);
        continue;
      }
      if (key === "cl_crosshairsize") {
        var L = parseFloat(val);
        if (isFinite(L)) { model.length = Math.floor((L + 0.2222) / 0.4445); recognized.push(key); }
        continue;
      }
      if (key === "cl_crosshairthickness") {
        var T = parseFloat(val);
        if (isFinite(T)) { model.thickness = Math.max(1, Math.floor((T + 0.2222) / 0.4444)); recognized.push(key); }
        continue;
      }
      if (key === "cl_crosshairgap") {
        // 旧间距的换算依赖「旧编号的样式」，而样式可能出现在本行之后，
        // 所以先记账，等整段读完再算（见循环后的收尾）。
        var G = parseFloat(val);
        if (isFinite(G)) { legacyGap = G; recognized.push(key); }
        continue;
      }
      if (key === "cl_crosshair_outlinethickness") {
        recognized.push(key); // 已在循环开头按旧语义收集，这里不重复处理
        continue;
      }
      if (key === "cl_fixedcrosshairgap" || key === "cl_crosshairgap_useweaponvalue") {
        recognized.push(key); // 新系统已删除，解析但丢弃
        continue;
      }
      ignored.push(key);
    }

    // 旧样式编号（0-5）→ 新编号；只在确认是旧文本时做
    if (looksLegacy) {
      // 间距换算必须用**旧编号**的样式来判断走哪条分支（与 core-convert.legacyV1ToPixels 同一规则）：
      // 只有旧编号 2 走 trunc(G)+5，其余（含映射到新 2 的旧 0/1/3）都走 trunc/floor(G)+4。
      // 再按新系统「gap 从屏幕中心起算」补半个臂厚（R3 已裁决，与 core-convert 候选 B 同规则），
      // 保证旧命令导入后臂根内沿距中心与游戏旧观感一致。
      if (legacyGap !== null) {
        var gapBase = model.style === 2 ? Convert.legacyGapRound(legacyGap) + 1 + 4 : Convert.legacyGapRound(legacyGap) + 4;
        model.gap = gapBase + Math.ceil(Math.max(1, model.thickness) / 2);
      }
      var mapped = Convert.LEGACY_V1_STYLE_MAP[model.style];
      if (mapped != null) model.style = mapped;
      // 旧描边（开关 + 0.5 步进粗细）→ 新三态：<1 只描左上 = 半描边，≥1 = 全描边
      if (legacyOutline.enabled !== null || legacyOutline.thickness !== null) {
        var en = legacyOutline.enabled === null ? true : legacyOutline.enabled;
        var thk = legacyOutline.thickness === null ? 1 : legacyOutline.thickness;
        model.outlineMode = Convert.outlineFromLegacy(en, thk);
      }
    }

    var normalized = Codec.normalizeModel(model);
    if (looksLegacy) {
      normalized.migration = {
        fmt: "cs2-v1", from: "legacy-convars", h: opts.screenHeight || Convert.DEFAULT_SCREEN_HEIGHT,
        lossy: true, notes: ["来自旧版控制台命令，已按像素公式换算"],
      };
    }
    if (leftover.length) {
      normalized.migration = normalized.migration || { fmt: "cs2-v1", from: "convars", h: opts.screenHeight || Convert.DEFAULT_SCREEN_HEIGHT, lossy: false, notes: [] };
      normalized.migration.leftover = leftover;
      normalized.migration.notes = normalized.migration.notes.concat(
        ["已忽略 " + leftover.length + " 条旧 convar（" + leftover.join("、") + "）：新准星系统里它们只是客户端存档残留，不参与渲染"]
      );
    }
    return { model: normalized, migration: normalized.migration || null, recognized: recognized, ignored: ignored, leftover: leftover };
  }

  function parseConVars(text, opts) { return parse(text, opts).model; }

  return {
    PASTE_LIMIT: PASTE_LIMIT,
    REMOVED_CONVARS: REMOVED_CONVARS,
    HIDDEN_LEGACY_CONVARS: HIDDEN_LEGACY_CONVARS,
    NEVER_OUTPUT: NEVER_OUTPUT,
    LEGACY_ONLY: LEGACY_ONLY,
    NEW_ONLY: NEW_ONLY,
    SNIPER_FIELD: SNIPER_FIELD,
    EXTRA_NUMERIC: EXTRA_NUMERIC,
    toCommands: toCommands,
    toCmdRows: toCmdRows,
    pasteCommands: pasteCommands,
    toPasteChunks: toPasteChunks,
    toPasteLine: toPasteLine,
    parse: parse,
    parseConVars: parseConVars,
  };
});
