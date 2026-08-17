/* ================= Showkey · CS2 准星工坊 v5 ================= */
(function () {
  "use strict";

  var CS = window.CS2Crosshair;
  var PROS = window.PRO_PLAYERS || [];
  var TEAMS = window.PRO_TEAMS || [];

  var MAPS = [
    { name: "Dust2", file: "assets/bg-dust2.webp" },
    { name: "Mirage", file: "assets/bg-mirage.webp" },
    { name: "Inferno", file: "assets/bg-inferno.webp" },
    { name: "Nuke", file: "assets/bg-nuke.webp" },
    { name: "Ancient", file: "assets/bg-ancient.webp" },
    { name: "Train", file: "assets/bg-train.webp" },
  ];

  var ROLE_ZH = { AWPer: "狙击手", Rifler: "步枪手", IGL: "指挥", Lurker: "自由人", Entry: "突破手", Support: "辅助" };
  var STYLE_ZH = ["经典", "传统", "经典静态"];

  var state = {
    settings: null,
    bgIndex: 0,
    recoil: false,
    team: "",
    current: null,
    currentCode: null,
    collapsed: {},      // 战队折叠状态 {teamKey: true}
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 工具 ---------------- */
  function fmt(v) { return Math.round(v * 100) / 100; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function flagEmoji(cc) {
    if (!cc || cc.length !== 2) return "🏳️";
    var A = 0x1f1e6;
    return String.fromCodePoint(A + (cc.charCodeAt(0) - 97), A + (cc.charCodeAt(1) - 97));
  }
  function roleZh(r) { return ROLE_ZH[r] || r || "选手"; }
  function teamByKey(k) { for (var i = 0; i < TEAMS.length; i++) if (TEAMS[i].k === k) return TEAMS[i]; return null; }

  function toast(msg, ok) {
    var t = $("toast");
    t.innerHTML = (ok === false ? "✕ " : "✓ ") + msg;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove("show"); }, 2000);
  }
  function copyText(text, msg) {
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(msg || "已复制"); } catch (e) { toast("复制失败", false); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg || "已复制"); }).catch(legacy);
    } else legacy();
  }
  function setFill(input) {
    var min = parseFloat(input.min) || 0, max = parseFloat(input.max) || 100, v = parseFloat(input.value);
    input.style.setProperty("--fill", ((v - min) / (max - min)) * 100 + "%");
  }

  /* ---------------- 视图切换 / 主题 / 回到顶部 ---------------- */
  function switchView(name) {
    var views = ["generator", "pros", "convert"];
    views.forEach(function (v) {
      $("view-" + v).hidden = v !== name;
    });
    document.querySelectorAll("#viewTabs .tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === name);
    });
    window.scrollTo(0, 0);
    if (name === "pros") renderPlayers();
    if (name === "generator") { renderPreview(); updateMiniPreview(); }
    else $("miniPreview").classList.remove("show");
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("themeBtn").textContent = theme === "dark" ? "🌙" : "☀️";
    try { localStorage.setItem("cs2theme", theme); } catch (e) {}
  }

  function bindChrome() {
    document.querySelectorAll("#viewTabs .tab").forEach(function (t) {
      t.addEventListener("click", function () { switchView(t.dataset.view); });
    });
    $("themeBtn").addEventListener("click", function () {
      var cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      setTheme(cur);
    });
    // 初始主题
    var saved = null;
    try { saved = localStorage.getItem("cs2theme"); } catch (e) {}
    setTheme(saved === "light" ? "light" : "dark");

    // 回到顶部
    $("toTop").addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    window.addEventListener("scroll", function () {
      $("toTop").classList.toggle("show", window.scrollY > 600);
      updateMiniPreview();
    }, { passive: true });
  }

  /* ---------------- 默认设置 ---------------- */
  function defaultSettings() {
    var s = CS.defaultSettings();
    s.color = 5; s.red = 0; s.green = 255; s.blue = 0;
    return s;
  }

  var SLIDERS = [
    { id: "sGap", key: "gap", v: "vGap" }, { id: "sLength", key: "length", v: "vLength" },
    { id: "sThickness", key: "thickness", v: "vThickness" }, { id: "sFixedGap", key: "fixedCrosshairGap", v: "vFixedGap" },
    { id: "sAlpha", key: "alpha", v: "vAlpha" }, { id: "sOutline", key: "outline", v: "vOutline" },
    { id: "sRed", key: "red", v: "vRed" }, { id: "sGreen", key: "green", v: "vGreen" }, { id: "sBlue", key: "blue", v: "vBlue" },
    { id: "sSplitDist", key: "splitDistance", v: "vSplitDist" }, { id: "sInnerSplit", key: "innerSplitAlpha", v: "vInnerSplit" },
    { id: "sOuterSplit", key: "outerSplitAlpha", v: "vOuterSplit" }, { id: "sSplitRatio", key: "splitSizeRatio", v: "vSplitRatio" },
  ];
  var TOGGLES = [
    { id: "sUseAlpha", key: "alphaEnabled" }, { id: "sOutlineEnabled", key: "outlineEnabled" },
    { id: "sDot", key: "centerDotEnabled" }, { id: "sT", key: "tStyleEnabled" },
    { id: "sRecoil", key: "followRecoil" }, { id: "sWeaponGap", key: "deployedWeaponGapEnabled" },
  ];

  /* ---------------- 准星绘制（CS2 官方像素级） ---------------- */
  // 度量统一使用 CS.crosshairMetrics（区分 style：0/1=gap+4，2=gap+5）

  // 预览显示尺寸：跨度×1.5，最小 24px 保证极小准星可见
  function crosshairPreviewSize(s, maxPx) {
    var m = CS.crosshairMetrics(s);
    return Math.round(Math.min(maxPx, Math.max(18, m.span)));
  }

  // 核心绘制：以 (cx, cy) 为中心，k = 游戏px→显示px 缩放
    function drawCrosshairAt(ctx, s, cx, cy, k, recoil) {
    var m = CS.crosshairMetrics(s, recoil === true);
    var fw = m.f * k, bl = m.b * k, gx = m.x * k;
    var baseX = cx - Math.floor(m.f / 2) * k;
    var baseY = cy - Math.floor(m.f / 2) * k;
    var alpha = (s.alphaEnabled ? s.alpha : 200) / 255;

    // 收集臂的矩形坐标（中心点单独用圆形绘制），过滤掉宽高为 0 的不可见矩形
    var colorRects = [];
    if (bl > 0) {
      colorRects.push([baseX + fw + gx, baseY, bl, fw]); // 右臂
      colorRects.push([baseX - gx - bl, baseY, bl, fw]); // 左臂
    }
    if (bl > 0) {
      colorRects.push([baseX, baseY + fw + gx, fw, bl]); // 下臂
      if (!s.tStyleEnabled) colorRects.push([baseX, baseY - gx - bl, fw, bl]); // 上臂
    }
    // 中心点圆心与半径（用圆形绘制，模拟 CS2 游戏中 1px 点的视觉效果）
    var dotCx = baseX + fw / 2;
    var dotCy = baseY + fw / 2;
    var dotR = fw / 2;

    ctx.globalAlpha = 1;

    // 第一步：绘制黑色描边底层（臂用矩形外扩，中心点用圆形外扩）
    if (s.outlineEnabled && s.outline > 0) {
      var outlineThick = s.outline * k;
      ctx.fillStyle = "#000000";
      for (var i = 0; i < colorRects.length; i++) {
        var r = colorRects[i];
        ctx.fillRect(
          r[0] - outlineThick,
          r[1] - outlineThick,
          r[2] + outlineThick * 2,
          r[3] + outlineThick * 2
        );
      }
      if (s.centerDotEnabled) {
        ctx.beginPath();
        ctx.arc(dotCx, dotCy, dotR + outlineThick, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 第二步：绘制彩色准星上层（臂用矩形，中心点用圆形）
    ctx.fillStyle = "rgba(" + s.red + "," + s.green + "," + s.blue + "," + alpha + ")";
    for (var j = 0; j < colorRects.length; j++) {
      var rc = colorRects[j];
      ctx.fillRect(rc[0], rc[1], rc[2], rc[3]);
    }
    if (s.centerDotEnabled) {
      ctx.beginPath();
      ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
    

    function renderCrosshairPreview(canvas, s, size) {
    if (!canvas || !s) return;
    var dpr = window.devicePixelRatio || 1;
    var sz = Math.max(2, Math.round(size));
    canvas.width = sz * dpr;
    canvas.height = sz * dpr;
    canvas.style.width = sz + "px";
    canvas.style.height = sz + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz, sz);
    var m = CS.crosshairMetrics(s, false);
    drawCrosshairAt(ctx, s, sz / 2, sz / 2, sz / m.span, false);
  }

  // 统一预览渲染：canvas + cs2util metrics 公式 + 整数坐标（高 DPR 无锯齿）
  function renderCrosshairMetricsCanvas(canvas, s, size) {
    if (!canvas || !s) return;
    var dpr = window.devicePixelRatio || 1;
    var sz = Math.max(2, Math.round(size));
    canvas.width = sz * dpr;
    canvas.height = sz * dpr;
    canvas.style.width = sz + "px";
    canvas.style.height = sz + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz, sz);

    // 统一调用 drawCrosshairAt 进行绘制
    var m = CS.crosshairMetrics(s, false);
    var k = sz / m.span;
    drawCrosshairAt(ctx, s, sz / 2, sz / 2, k, false);
}

  // 选手准星预览：与准星生成器主预览完全一致的绘制方法
  // boxSize 为 canvas 固定尺寸（像素），准星居中绘制，不超出容器
  function renderPlayerCrosshair(canvas, s, boxSize) {
    if (!canvas || !s) return;
    var dpr = window.devicePixelRatio || 1;
    var m = CS.crosshairMetrics(s, false);
    var isDotOnly = m.b === 0; // 纯点准星（无臂，仅中心点）
    // 普通准星最大 2 倍缩放；纯点准星用 4 倍让白点清晰可见
    var maxK = isDotOnly ? 4 : 2;
    var k = Math.min(maxK, (boxSize - 8) / m.span);
    var sz = boxSize;
    canvas.width = sz * dpr;
    canvas.height = sz * dpr;
    canvas.style.width = sz + "px";
    canvas.style.height = sz + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz, sz);
    // 纯点准星用 4 倍缩放让白点清晰可见，描边保留（与游戏一致）
    var drawS = s;
    drawCrosshairAt(ctx, drawS, sz / 2, sz / 2, k, false);
  }

  // 准星盒 HTML：CSS background-image 渲染（最古老最可靠的 data URL 使用方式）
  function cxBoxHTML(rects, size) {
    var url = crosshairSvgDataUrl(rects);
    return '<div class="cxbox" style="width:' + size + 'px;height:' + size + 'px;background-image:url(\'' + url + '\')"></div>';
  }

  // 官方矩形 → SVG data URL 图片（浏览器图像管线直接显示，最可靠）
  function crosshairSvgDataUrl(rects) {
    if (!rects || !rects.length) return "";
    var minX = 99, maxX = -99, minY = 99, maxY = -99;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r[0] < minX) minX = r[0]; if (r[0] + r[2] > maxX) maxX = r[0] + r[2];
      if (r[1] < minY) minY = r[1]; if (r[1] + r[3] > maxY) maxY = r[1] + r[3];
    }
    var span = Math.max(maxX - minX, maxY - minY, 1);
    var pad = Math.ceil(span * 0.08);
    var S = span + pad * 2;
    var ox = pad - minX, oy = pad - minY;
    var parts = [];
    for (var j = 0; j < rects.length; j++) {
      var rr = rects[j];
      parts.push('<rect x="' + (rr[0] + ox) + '" y="' + (rr[1] + oy) + '" width="' + rr[2] + '" height="' + rr[3] + '" fill="rgb(' + rr[4] + ',' + rr[5] + ',' + rr[6] + ')" fill-opacity="' + (rr.length > 7 ? rr[7] : 1) + '"/>');
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + " " + S + '">' + parts.join("") + "</svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // settings → 40 视口 rects（无官方数据时兜底）
  // 包含黑色描边底层 + 彩色上层，与 CS2 官方渲染顺序一致
  function metricsToRects(s, recoil) {
    var m = CS.crosshairMetrics(s, recoil === true);
    var f = m.f, b = m.b, x = m.x;
    var cx = 20, cy = 20, hw = f / 2;
    var alpha = (s.alphaEnabled ? s.alpha : 200) / 255;
    var outline = (s.outlineEnabled && s.outline > 0) ? s.outline : 0;

    var colorRects = [
      [cx + x, cy - hw, b, f],
      [cx - x - b, cy - hw, b, f],
      [cx - hw, cy + x, f, b],
    ];
    if (!s.tStyleEnabled) colorRects.push([cx - hw, cy - x - b, f, b]);
    if (s.centerDotEnabled) colorRects.push([cx - hw, cy - hw, f, f]);

    var rects = [];
    // 黑色描边底层（先画）
    if (outline > 0) {
      for (var i = 0; i < colorRects.length; i++) {
        var r = colorRects[i];
        rects.push([r[0] - outline, r[1] - outline, r[2] + outline * 2, r[3] + outline * 2, 0, 0, 0, 1]);
      }
    }
    // 彩色上层（后画）
    for (var j = 0; j < colorRects.length; j++) {
      var r2 = colorRects[j];
      rects.push([r2[0], r2[1], r2[2], r2[3], s.red, s.green, s.blue, alpha]);
    }
    return rects;
  }

  // 官方矩形数据渲染：rects = [x,y,w,h,r,g,b,a]（40 视口坐标，与 prosettings 页面一致）
  function crosshairRectSize(rects, maxPx) {
    var minX = 99, maxX = -99, minY = 99, maxY = -99;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r[0] < minX) minX = r[0]; if (r[0] + r[2] > maxX) maxX = r[0] + r[2];
      if (r[1] < minY) minY = r[1]; if (r[1] + r[3] > maxY) maxY = r[1] + r[3];
    }
    var span = Math.max(maxX - minX, maxY - minY, 1);
    return Math.round(Math.min(maxPx, Math.max(18, span)));
  }

  function renderCrosshairRects(canvas, rects, size) {
    if (!canvas || !rects || !rects.length) return;
    var dpr = window.devicePixelRatio || 1;
    var sz = Math.max(2, Math.round(size));
    canvas.width = sz * dpr;
    canvas.height = sz * dpr;
    canvas.style.width = sz + "px";
    canvas.style.height = sz + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz, sz);
    // 包围盒 → 居中缩放
    var minX = 99, maxX = -99, minY = 99, maxY = -99;
    for (var i = 0; i < rects.length; i++) {
      var r0 = rects[i];
      if (r0[0] < minX) minX = r0[0]; if (r0[0] + r0[2] > maxX) maxX = r0[0] + r0[2];
      if (r0[1] < minY) minY = r0[1]; if (r0[1] + r0[3] > maxY) maxY = r0[1] + r0[3];
    }
    var span = Math.max(maxX - minX, maxY - minY, 1);
    var k = sz / span;
    var ccx = (minX + maxX) / 2;
    var ccy = (minY + maxY) / 2;
    var col = rects[0];
    ctx.fillStyle = "rgb(" + col[4] + "," + col[5] + "," + col[6] + ")";
    ctx.globalAlpha = col.length > 7 ? col[7] : 1;
    for (var j = 0; j < rects.length; j++) {
      var r = rects[j];
      ctx.fillRect((r[0] - ccx) * k + sz / 2, (r[1] - ccy) * k + sz / 2, r[2] * k, r[3] * k);
    }
    ctx.globalAlpha = 1;
  }

  // 主预览（地图背景）：整体放大 2 倍（背景+准星一起，如同游戏画面放大）
  // 准星与背景的相对比例完全真实，参数与形状一个没动
  function renderMainPreview() {
    var canvas = $("previewCanvas");
    var s = state.settings;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 0;
    var h = canvas.clientHeight || 0;
    if (w <= 0 || h <= 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // cs2util 同款：游戏原始像素大小，地图背景上精确绘制（开火模拟时应用间距变化）
    drawCrosshairAt(ctx, s, w / 2, h / 2, 1, state.recoil);
  }

  /* ---------------- 生成器 ---------------- */
  function applySettingsToUI() {
    var s = state.settings;
    SLIDERS.forEach(function (sl) {
      var input = $(sl.id);
      if (input) { input.value = s[sl.key]; setFill(input); }
      if ($(sl.v)) $(sl.v).textContent = fmt(s[sl.key]);
    });
    TOGGLES.forEach(function (tg) { var input = $(tg.id); if (input) input.checked = !!s[tg.key]; });
    $("styleSeg").querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", Number(b.dataset.style) === s.style);
    });
    $("colorChip").style.background = "rgb(" + s.red + "," + s.green + "," + s.blue + ")";
  }

  function renderPreview() {
    var s = state.settings;
    renderMainPreview();
    var msz = crosshairPreviewSize(s, 72);
    $("miniPreview").style.width = (msz + 24) + "px";
    $("miniPreview").style.height = (msz + 24) + "px";
    $("miniPreview").innerHTML = '<canvas></canvas>';
    renderCrosshairMetricsCanvas($("miniPreview").querySelector("canvas"), s, msz);
    $("previewHud").textContent =
      "GAP " + fmt(s.gap) + "  LEN " + fmt(s.length) + "  THK " + fmt(s.thickness) +
      "  RGB " + s.red + " " + s.green + " " + s.blue;
    $("recoilChip").classList.toggle("show", state.recoil);
  }

  function renderBackground() {
    var m = MAPS[state.bgIndex];
    $("bgImg").src = m.file;
    $("mapName").textContent = m.name;
  }
  function syncOutputs() {
    var s = state.settings;
    try { $("shareCodeInput").value = CS.encodeShareCode(s); } catch (e) { $("shareCodeInput").value = ""; }
    $("cfgOutput").value = CS.settingsToCfg(s);
  }
  function updateAll() { renderPreview(); syncOutputs(); }

  function applySettings(s, scroll) {
    state.settings = s;
    applySettingsToUI();
    updateAll();
    if (scroll) { switchView("generator"); }
  }

  function importCode(code, silent) {
    code = (code || "").trim();
    if (!code) { toast("请输入分享码", false); return false; }
    try {
      applySettings(CS.decodeShareCode(code), true);
      toast("已导入并应用");
      return true;
    } catch (e) {
      if (!silent) toast("分享码无效", false);
      return false;
    }
  }

  function updateMiniPreview() {
    var stage = $("previewStage");
    var rect = stage.getBoundingClientRect();
    var small = window.innerWidth <= 1000;
    var genVisible = !$("view-generator").hidden;
    var show = small && genVisible && rect.bottom < 40;
    $("miniPreview").classList.toggle("show", show);
  }

  function bindGenerator() {
    SLIDERS.forEach(function (sl) {
      var input = $(sl.id);
      input.addEventListener("input", function () {
        state.settings[sl.key] = parseFloat(input.value);
        if ($(sl.v)) $(sl.v).textContent = fmt(parseFloat(input.value));
        setFill(input);
        $("colorChip").style.background = "rgb(" + state.settings.red + "," + state.settings.green + "," + state.settings.blue + ")";
        updateAll();
      });
    });
    TOGGLES.forEach(function (tg) {
      $(tg.id).addEventListener("change", function () {
        state.settings[tg.key] = $(tg.id).checked;
        updateAll();
      });
    });
    $("styleSeg").querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.settings.style = Number(b.dataset.style);
        applySettingsToUI();
        updateAll();
      });
    });
    $("bgPrev").addEventListener("click", function () {
      state.bgIndex = (state.bgIndex - 1 + MAPS.length) % MAPS.length; renderBackground();
    });
    $("bgNext").addEventListener("click", function () {
      state.bgIndex = (state.bgIndex + 1) % MAPS.length; renderBackground();
    });
    $("btnRecoil").addEventListener("click", function () {
      state.recoil = !state.recoil;
      this.classList.toggle("btn-primary", state.recoil);
      renderPreview();
    });
    $("btnReset").addEventListener("click", function () { applySettings(defaultSettings()); toast("已重置"); });
    $("btnCopyCode").addEventListener("click", function () {
      if ($("shareCodeInput").value) copyText($("shareCodeInput").value, "分享码已复制");
    });
    $("btnImportCode").addEventListener("click", function () { importCode($("shareCodeInput").value); });
    $("shareCodeInput").addEventListener("keydown", function (e) { if (e.key === "Enter") importCode($("shareCodeInput").value); });
    $("btnCopyCfg").addEventListener("click", function () { copyText($("cfgOutput").value, "cfg 已复制"); });
    $("btnDecode").addEventListener("click", function () {
      var ok = importCode($("codeImport").value, true);
      var st = $("statusDecode");
      if (ok) { st.textContent = "✓ 解码成功，已应用到生成器"; st.className = "status-msg ok"; $("codeImport").value = ""; }
      else { st.textContent = "✕ 分享码无效"; st.className = "status-msg err"; }
    });
    $("btnImportCfg").addEventListener("click", function () {
      if (!$("cfgImport").value.trim()) { toast("请粘贴 cfg 命令", false); return; }
      applySettings(CS.parseConVars($("cfgImport").value), true);
      $("statusImport").textContent = "✓ 解析成功，已应用"; $("statusImport").className = "status-msg ok";
    });
    $("btnCopyCfg2").addEventListener("click", function () { copyText($("cfgOutput").value, "cfg 已复制"); });
    $("miniPreview").addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("resize", function () { renderPreview(); updateMiniPreview(); });
  }

  /* ---------------- 选手库 ---------------- */
  var decodeCache = {};
  function decodeCached(code) {
    if (code in decodeCache) return decodeCache[code];
    var s = null;
    try { s = CS.decodeShareCode(code); } catch (e) { s = null; }
    decodeCache[code] = s;
    return s;
  }

  function cardHTML(p, t) {
    var histTag = p.h && p.h.length ? '<span class="pc-hist">历史 ×' + p.h.length + "</span>" : "";
    return '<div class="player-card" data-pid="' + esc(p.n) + '">' +
      '<div class="pc-xhair"><canvas></canvas></div>' +
      '<div class="pc-info">' +
      '<div class="pc-top">' +
      (t ? '<img class="pc-logo" src="' + t.logo + '" alt="" loading="lazy">' : "") +
      '<span class="pc-name">' + flagEmoji(p.f) + " " + esc(p.n) + "</span></div>" +
      '<div class="pc-meta"><span>' + esc(roleZh(p.r)) + "</span>" + histTag + "</div>" +
      '<div class="pc-actions">' +
      '<button class="btn btn-primary btn-sm" data-act="apply">应用</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="copy">复制码</button>' +
      "</div></div></div>";
  }

  function buildTeamList() {
    var html = '<button class="team-item' + (state.team === "" ? " active" : "") + '" data-team="">' +
      '<span class="team-name">全部战队</span><span class="team-count">' + PROS.length + "</span></button>";
    TEAMS.forEach(function (t) {
      var count = PROS.filter(function (p) { return p.t === t.k; }).length;
      html += '<button class="team-item' + (state.team === t.k ? " active" : "") + '" data-team="' + t.k + '">' +
        '<img src="' + t.logo + '" alt="" loading="lazy">' +
        '<span class="team-name">' + esc(t.n) + '</span><span class="team-count">' + count + "</span></button>";
    });
    var list = $("teamList");
    list.innerHTML = html;
    list.querySelectorAll(".team-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.team = btn.dataset.team;
        list.querySelectorAll(".team-item").forEach(function (b) { b.classList.toggle("active", b.dataset.team === state.team); });
        renderPlayers();
      });
    });
  }

  function visiblePlayers() {
    var q = $("proSearch").value.trim().toLowerCase();
    return PROS.filter(function (p) {
      if (q) return p.n.toLowerCase().indexOf(q) !== -1;
      if (state.team) return p.t === state.team;
      return true;
    });
  }

  function renderPlayers() {
    var list = visiblePlayers();
    var q = $("proSearch").value.trim().toLowerCase();
    $("playersCount").textContent = list.length + " 位选手";
    var grid = $("proGrid");

    if (!list.length) { grid.innerHTML = '<div class="empty-state">没有找到选手</div>'; return; }

    var html = "";
    if (q || state.team) {
      // 搜索/选中战队：平铺
      html = '<div class="team-group open" style="background:transparent;border:none">' +
        '<div class="team-group-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:16px;padding:0">';
      list.forEach(function (p) { html += cardHTML(p, teamByKey(p.t)); });
      html += "</div></div>";
    } else {
      // 全部：按战队分组
      TEAMS.forEach(function (t, idx) {
        var members = list.filter(function (p) { return p.t === t.k; });
        if (!members.length) return;
        var open = !state.collapsed[t.k] && idx < 6;
        html += '<div class="team-group' + (open ? " open" : "") + '" data-tg="' + t.k + '">' +
          '<div class="team-group-head">' +
          '<img src="' + t.logo + '" alt="" loading="lazy">' +
          '<span class="tg-name">' + esc(t.n) + '</span>' +
          '<span class="tg-count">' + members.length + '</span>' +
          '<span class="tg-arrow">▾</span></div>' +
          '<div class="team-group-body">';
        members.forEach(function (p) { html += cardHTML(p, t); });
        html += "</div></div>";
      });
    }
    grid.innerHTML = html;

    // 分组折叠交互
    grid.querySelectorAll(".team-group-head").forEach(function (head) {
      head.addEventListener("click", function () {
        var group = head.closest(".team-group");
        var k = group.dataset.tg;
        group.classList.toggle("open");
        if (k) state.collapsed[k] = !group.classList.contains("open");
      });
    });

    // 渲染准星（与生成器主预览同绘制方法，容器固定大小，准星居中）
    grid.querySelectorAll(".player-card").forEach(function (card) {
      var p = PROS.find(function (x) { return x.n === card.dataset.pid; });
      var cv = card.querySelector("canvas");
      if (p && cv) {
        var s = decodeCached(p.c);
        if (s) renderPlayerCrosshair(cv, s, 64);
      }
    });
  }

  function bindProGrid() {
    $("proGrid").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      var card = e.target.closest(".player-card");
      if (!card) return;
      var p = PROS.find(function (x) { return x.n === card.dataset.pid; });
      if (!p) return;
      if (btn && btn.dataset.act === "apply") {
        applySettings(decodeCached(p.c), true);
        toast("已应用 " + p.n + " 的准星");
      } else if (btn && btn.dataset.act === "copy") {
        copyText(p.c, p.n + " 的分享码已复制");
      } else {
        openModal(p);
      }
    });
    $("proSearch").addEventListener("input", renderPlayers);
  }

  /* ---------------- 弹窗 ---------------- */
  function chip(k, v) {
    var display = (typeof v === "number") ? esc(String(fmt(v))) : esc(String(v));
    return '<span class="param-chip"><b>' + k + "</b> " + display + "</span>";
  }

  function openModal(p) {
    state.current = p;
    state.currentCode = p.c;
    var t = teamByKey(p.t);
    $("mName").innerHTML = flagEmoji(p.f) + " " + esc(p.n);
    $("mMeta").innerHTML = (t ? '<img src="' + t.logo + '" alt="">' : "") + (t ? esc(t.n) : "") + " · " + esc(roleZh(p.r));
    $("mTeamLogo").src = t ? t.logo : "";
    $("mCode").textContent = p.c;
    $("mCode").title = p.c;
    var s = decodeCached(p.c);
    var params = "";
    if (s) {
      params = chip("GAP", s.gap) + chip("LEN", s.length) + chip("THK", s.thickness) +
        chip("STYLE", STYLE_ZH[s.style] || s.style) + chip("RGB", s.red + "," + s.green + "," + s.blue) +
        (s.alphaEnabled ? chip("ALPHA", s.alpha) : "") +
        (s.centerDotEnabled ? chip("DOT", "开") : "") +
        (s.tStyleEnabled ? chip("T", "开") : "");
    }
    $("mParams").innerHTML = params;
    var hist = (p.h || []).slice(0, 8);
    var html = "";
    if (!hist.length) html = '<div class="hist-empty">暂无历史版本</div>';
    else {
      hist.forEach(function (h) {
        html += '<div class="hist-entry" data-code="' + esc(h.c) + '">' +
          '<div class="h-preview"><canvas></canvas></div>' +
          '<div class="h-info">' +
          '<div class="h-date">' + esc((h.d || "").slice(0, 10)) + "</div>" +
          '<div class="h-source">' + esc(h.s || "") + '</div>' +
          '<div class="h-code">' + esc(h.c) + "</div></div>" +
          '<div class="h-actions">' +
          '<button class="btn btn-primary btn-sm" data-ha="apply">应用</button>' +
          '<button class="btn btn-ghost btn-sm" data-ha="copy">复制</button>' +
          "</div></div>";
      });
    }
    $("mHistoryList").innerHTML = html;
    $("playerModal").hidden = false;
    document.body.style.overflow = "hidden";

    // 同步渲染（与生成器主预览同绘制方法，容器固定大小，准星居中）
    var s2 = decodeCached(p.c);
    if (s2) {
      $("mPreview").innerHTML = '<canvas></canvas>';
      renderPlayerCrosshair($("mPreview").querySelector("canvas"), s2, 84);
    }
    $("mHistoryList").querySelectorAll(".hist-entry").forEach(function (entry) {
      var hs = decodeCached(entry.dataset.code);
      if (hs) {
        var hcv = entry.querySelector("canvas");
        if (hcv) renderPlayerCrosshair(hcv, hs, 60);
      }
    });
  }

  function closeModal() {
    $("playerModal").hidden = true;
    document.body.style.overflow = "";
  }

  function bindModal() {
    $("modalClose").addEventListener("click", closeModal);
    $("playerModal").addEventListener("click", function (e) { if (e.target === $("playerModal")) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
    $("mApply").addEventListener("click", function () {
      if (!state.currentCode) return;
      applySettings(decodeCached(state.currentCode), true);
      closeModal();
      toast("已应用到生成器");
    });
    $("mCopy").addEventListener("click", function () {
      if (state.currentCode) copyText(state.currentCode, "分享码已复制");
    });
    $("mHistoryList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-ha]");
      if (!btn) return;
      var entry = btn.closest(".hist-entry");
      var code = entry.dataset.code;
      if (btn.dataset.ha === "apply") {
        applySettings(decodeCached(code), true);
        closeModal();
        toast("已应用历史版本");
      } else {
        copyText(code, "分享码已复制");
      }
    });
  }

  /* ---------------- 自检徽章 ---------------- */
  function badge() {
    var el = document.getElementById("badge");
    if (!el) return;
    el.textContent = "v23-dotfix · JS ✓ · 选手 " + PROS.length + " · 弹窗 " + (state.current ? "✓" : "—");
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    state.settings = defaultSettings();
    bindChrome();
    bindGenerator();
    renderBackground();
    applySettingsToUI();
    updateAll();
    buildTeamList();
    renderPlayers();
    bindProGrid();
    bindModal();
    switchView("generator");
    badge();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
