
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "js", "app.js");
let s = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const before = s.length;

const NEW_BLOCK = `  // 颜色区：SV 方块 / 色相条 / 不透明度条 / 数值框，四者共用同一份 state.settings
  function syncColorUI() {
    if (!state.settings) return;
    syncColorFromSettings();
  }

  /* ---------------- 调色盘（与游戏里的取色对话框同构） ----------------
   * 左：饱和度 × 明度 方块（横向 = 饱和度，纵向 = 明度）+ 色相条 + 不透明度条
   * 右：新 / 当前 两个色块 + R G B # A 五个数值框
   * 拖动 / 键盘 / 数值框都写回 state.settings，再由 syncColorFromSettings() 反向刷新，
   * 所以只有一份状态。拖动即时生效；「取消」退回打开对话框那一刻的快照。 */
  var cpHue = 120;        // 最近一次有意义的色相（灰 / 黑时保留，不会跳回红色）
  var cpSnapshot = null;  // 打开对话框那一刻的 rgba

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: mx ? d / mx : 0, v: mx };
  }
  function hsvToRgb(h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var seg = Math.floor(h / 60) % 6;
    var t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)];
  }
  function hexOf(r, g, b) {
    var h = function (n) { var s = Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase(); return s.length < 2 ? "0" + s : s; };
    return "#" + h(r) + h(g) + h(b);
  }

  // 色块：棋盘格衬底（CSS）+ 颜色叠加，和游戏里一样能看出 alpha
  function paintChip(el, r, g, b, a) {
    if (!el) return;
    el.style.setProperty("--chip", "rgb(" + r + "," + g + "," + b + ")");
    el.style.setProperty("--chip-a", String(Math.max(0, Math.min(255, a)) / 255));
  }

  // 由 state.settings 刷新对话框里的一切 + 设置行上的色块与文字
  function syncColorFromSettings() {
    var s = state.settings;
    if (!s) return;
    var hsv = rgbToHsv(s.red, s.green, s.blue);
    if (hsv.v > 0.004 && hsv.s > 0.004) cpHue = hsv.h;
    var hue = cpHue, sat = hsv.s, val = hsv.v;
    var solid = hexOf.apply(null, hsvToRgb(hue, 1, 1));

    // 设置行：色块 + HEX + 不透明度
    paintChip($("cpChip"), s.red, s.green, s.blue, s.alpha);
    var hex = $("cpHex");
    if (hex) hex.textContent = hexOf(s.red, s.green, s.blue);
    var alphaText = $("cpAlphaText");
    if (alphaText) alphaText.textContent = String(s.alpha);

    // SV 方块：底色 = 当前色相的纯色（左白上黑由 CSS 渐变叠加）
    var sv = $("cpSV"), svMarker = $("cpSVMarker");
    if (sv) {
      sv.style.setProperty("--cp-hue", solid);
      sv.setAttribute("aria-valuenow", String(Math.round(sat * 100)));
      sv.setAttribute("aria-valuetext", "饱和度 " + Math.round(sat * 100) + "% · 明度 " + Math.round(val * 100) + "%");
    }
    if (svMarker) {
      svMarker.style.left = (sat * 100) + "%";
      svMarker.style.top = ((1 - val) * 100) + "%";
      svMarker.style.setProperty("--cp-dot", hexOf(s.red, s.green, s.blue));
    }

    // 色相条 / 不透明度条
    var hueBar = $("cpHue"), hueMarker = $("cpHueMarker");
    if (hueBar) {
      hueBar.setAttribute("aria-valuenow", String(Math.round(hue)));
      hueBar.setAttribute("aria-valuetext", "色相 " + Math.round(hue) + " 度");
    }
    if (hueMarker) hueMarker.style.left = (hue / 360 * 100) + "%";
    var alphaBar = $("cpAlpha"), alphaMarker = $("cpAlphaMarker");
    if (alphaBar) {
      alphaBar.style.setProperty("--cp-solid", hexOf(s.red, s.green, s.blue));
      alphaBar.setAttribute("aria-valuenow", String(s.alpha));
      alphaBar.setAttribute("aria-valuetext", "不透明度 " + s.alpha);
    }
    if (alphaMarker) alphaMarker.style.left = (s.alpha / 255 * 100) + "%";

    // 新 / 当前 两个色块
    paintChip($("cpNew"), s.red, s.green, s.blue, s.alpha);
    if (cpSnapshot) paintChip($("cpCur"), cpSnapshot.r, cpSnapshot.g, cpSnapshot.b, cpSnapshot.a);

    // 数值框（正在输入的那个不覆盖）
    ["Red", "Green", "Blue"].forEach(function (ch) {
      var input = $("n" + ch);
      if (input && document.activeElement !== input) input.value = String(s[ch.toLowerCase()]);
    });
    var hexInput = $("cpHexInput");
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hexOf(s.red, s.green, s.blue);
    var alphaInput = $("nAlpha");
    if (alphaInput && document.activeElement !== alphaInput) alphaInput.value = String(s.alpha);
  }

  // 统一写入口：任何来源改色都走这里，保证色块 / 命令 / 预览同帧刷新
  function setColor(r, g, b) {
    var s = state.settings;
    if (!s) return;
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    if (s.red === r && s.green === g && s.blue === b) { syncColorFromSettings(); return; }
    s.red = r; s.green = g; s.blue = b;
    markDirty();
    applySettingsToUI();
    updateAll();
  }

  function setAlpha(a) {
    var s = state.settings;
    if (!s) return;
    a = Math.max(0, Math.min(255, Math.round(a)));
    if (s.alpha === a) { syncColorFromSettings(); return; }
    s.alpha = a;
    markDirty();
    applySettingsToUI();
    updateAll();
  }

  // 色相条 / 键盘只改 HSV 里的几维，色相由 cpHue 单独持有，不受取整影响
  function applyHsv(h, sat, val) {
    var rgb = hsvToRgb(h, Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, val)));
    setColor(rgb[0], rgb[1], rgb[2]);
  }

  function openColorDialog() {
    var s = state.settings;
    if (!s) return;
    cpSnapshot = { r: s.red, g: s.green, b: s.blue, a: s.alpha };
    $("cpDialog").hidden = false;
    document.body.style.overflow = "hidden";
    syncColorFromSettings();
    var sv = $("cpSV");
    if (sv) sv.focus({ preventScroll: true });
  }

  function closeColorDialog(restore) {
    var snap = cpSnapshot;
    cpSnapshot = null;
    if (restore && snap) {
      setAlpha(snap.a);
      setColor(snap.r, snap.g, snap.b);
    }
    var dialog = $("cpDialog");
    if (dialog) dialog.hidden = true;
    document.body.style.overflow = "";
    var trigger = $("cpTrigger");
    if (trigger) trigger.focus({ preventScroll: true });
  }

  // 拖拽：把指针位置归一化成 0..1 后交给 onPoint(x, y)
  function bindDragArea(el, onPoint) {
    if (!el) return;
    var drag = false;
    function pick(e) {
      var box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      onPoint(
        Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
        Math.max(0, Math.min(1, (e.clientY - box.top) / box.height))
      );
    }
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      drag = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* jsdom 无实现，忽略 */ }
      pick(e);
    });
    el.addEventListener("pointermove", function (e) { if (drag) pick(e); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      el.addEventListener(ev, function () { drag = false; });
    });
  }

  function bindColorPicker() {
    var trigger = $("cpTrigger");
    if (trigger) trigger.addEventListener("click", openColorDialog);
    if ($("cpAccept")) $("cpAccept").addEventListener("click", function () { closeColorDialog(false); });
    if ($("cpCancel")) $("cpCancel").addEventListener("click", function () { closeColorDialog(true); });
    if ($("cpDialog")) {
      $("cpDialog").addEventListener("click", function (e) {
        if (e.target === $("cpDialog")) closeColorDialog(true);
      });
    }

    // SV 方块：横向饱和度、纵向明度
    bindDragArea($("cpSV"), function (x, y) { applyHsv(cpHue, x, 1 - y); });
    // 色相条（黑白灰时按满饱和度 / 满明度过渡，避免拖了半天没反应）
    bindDragArea($("cpHue"), function (x) {
      var hsv = rgbToHsv(state.settings.red, state.settings.green, state.settings.blue);
      var live = hsv.v > 0.004;
      applyHsv(x * 360, live ? hsv.s : 1, live ? hsv.v : 1);
    });
    // 不透明度条
    bindDragArea($("cpAlpha"), function (x) { setAlpha(x * 255); });

    // 键盘：方向键 ±4%（色相 5° / alpha 5），Shift 大步
    if ($("cpSV")) {
      $("cpSV").addEventListener("keydown", function (e) {
        var hsv = rgbToHsv(state.settings.red, state.settings.green, state.settings.blue);
        var step = e.shiftKey ? 0.2 : 0.04;
        var sat = hsv.s, val = hsv.v;
        if (e.key === "ArrowLeft") sat -= step;
        else if (e.key === "ArrowRight") sat += step;
        else if (e.key === "ArrowUp") val += step;
        else if (e.key === "ArrowDown") val -= step;
        else return;
        e.preventDefault();
        applyHsv(cpHue, sat, val);
      });
    }
    function keyNav(el, onStep) {
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        var dir = 0;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") dir = -1;
        else if (e.key === "ArrowRight" || e.key === "ArrowUp") dir = 1;
        else return;
        e.preventDefault();
        onStep(dir, e.shiftKey);
      });
    }
    keyNav($("cpHue"), function (dir, big) {
      var hsv = rgbToHsv(state.settings.red, state.settings.green, state.settings.blue);
      var live = hsv.v > 0.004;
      applyHsv((cpHue + dir * (big ? 30 : 5) + 360) % 360, live ? hsv.s : 1, live ? hsv.v : 1);
    });
    keyNav($("cpAlpha"), function (dir, big) { setAlpha(state.settings.alpha + dir * (big ? 25 : 5)); });

    // R / G / B / A 数值框
    [["nRed", "red"], ["nGreen", "green"], ["nBlue", "blue"]].forEach(function (pair) {
      var input = $(pair[0]);
      if (!input) return;
      function commit() {
        var v = parseFloat(input.value);
        if (!isFinite(v)) { syncColorFromSettings(); return; }
        v = Math.max(0, Math.min(255, Math.round(v)));
        if (pair[1] === "red") setColor(v, state.settings.green, state.settings.blue);
        else if (pair[1] === "green") setColor(state.settings.red, v, state.settings.blue);
        else setColor(state.settings.red, state.settings.green, v);
      }
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); input.blur(); }
      });
    });
    var alphaInput = $("nAlpha");
    if (alphaInput) {
      function commitAlpha() {
        var v = parseFloat(alphaInput.value);
        if (!isFinite(v)) { syncColorFromSettings(); return; }
        setAlpha(v);
      }
      alphaInput.addEventListener("change", commitAlpha);
      alphaInput.addEventListener("blur", commitAlpha);
      alphaInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commitAlpha(); alphaInput.blur(); }
      });
    }
    var hexInput = $("cpHexInput");
    if (hexInput) {
      function commitHex() {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hexInput.value).trim());
        if (!m) { syncColorFromSettings(); return; }
        var h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        setColor(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
      }
      hexInput.addEventListener("change", commitHex);
      hexInput.addEventListener("blur", commitHex);
      hexInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commitHex(); hexInput.blur(); }
      });
    }
  }

`;

const startMarker = "  // 颜色区：色轮 + 明度 / 不透明度 + RGB 数值，四者共用同一份 state.settings";
const endMarker = "  // 描边：三态 + 描边颜色。关闭描边时颜色置灰（控制台也不会输出那四条命令）";
const i = s.indexOf(startMarker);
const j = s.indexOf(endMarker);
if (i < 0 || j < 0 || j < i) { console.error("MARKER MISS", i, j); process.exit(1); }
s = s.slice(0, i) + NEW_BLOCK + s.slice(j);

// SLIDERS 里去掉 sAlpha（不透明度搬进调色盘）
const alphaSlider = '    { id: "sAlpha", key: "alpha", v: "vAlpha" },\n';
if (s.indexOf(alphaSlider) < 0) { console.error("SLIDER MISS"); process.exit(1); }
s = s.replace(alphaSlider, "");

// 焦点陷阱 + Escape 优先给调色盘
const oldTab = '      if (e.key === "Tab" && !$("playerModal").hidden) {';
const newTab = '      if (e.key === "Tab" && (!$("playerModal").hidden || !$("cpDialog").hidden)) {';
if (s.indexOf(oldTab) < 0) { console.error("TAB MISS"); process.exit(1); }
s = s.replace(oldTab, newTab);
const oldScope = '        var scope = !$("convertModal").hidden ? $("convertModal") : $("playerModal");';
const newScope = '        var scope = !$("cpDialog").hidden ? $("cpDialog") : (!$("convertModal").hidden ? $("convertModal") : $("playerModal"));';
if (s.indexOf(oldScope) < 0) { console.error("SCOPE MISS"); process.exit(1); }
s = s.replace(oldScope, newScope);
const oldEsc = '      if (e.key !== "Escape") return;\n      if (!$("convertModal").hidden) { closeConvertDialog(); return; }';
const newEsc = '      if (e.key !== "Escape") return;\n      if (!$("cpDialog").hidden) { closeColorDialog(true); return; }\n      if (!$("convertModal").hidden) { closeConvertDialog(); return; }';
if (s.indexOf(oldEsc) < 0) { console.error("ESC MISS"); process.exit(1); }
s = s.replace(oldEsc, newEsc);

fs.writeFileSync(FILE, s.replace(/\n/g, "\r\n"), "utf8");
console.log("OK", before, "->", s.length);
