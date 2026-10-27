/* ================= Showkey · CS2 准星工坊 v9 =================
 * UI 适配层：模型读写全部走 window.CS2Crosshair（2026 新版像素刻度）。
 *   · 生成器页直接绑定新模型字段（length / thickness / gap 均为屏幕像素）
 *   · 描边是 outlineMode 三态（0 无 / 1 全 / 2 半），半描边只描轮廓左上部分
 *   · 生成永远是 cs2-v1 新码；导入兼容 CSGO- 旧码与新旧命令串并显著标注「近似换算」
 *   · 几何唯一真源 = 模型像素 @ screenHeight；canvas 尺寸 / DPR 只进 unit，不参与几何
 *   · 预览恒为 1:1 原生像素（1 模型像素 = 1 CSS 像素），与窗口大小 / DPR / 屏幕高度无关
 *   · 动态预览：用 rAF 模拟连发时的散布扩散 / 上抬 / 回落，支持自动循环与按住连发
 *   · 准星库按「源数据时代」分新旧：legacy 只给预览图，cs2-v1 才给完整导出
 *   · 纯静态前端：不发任何网络请求（无 /api、无管理入口）
 * ============================================================ */
(function () {
  "use strict";

  var CS = window.CS2Crosshair;
  var PROS = window.PRO_PLAYERS || [];
  var TEAMS = window.PRO_TEAMS || [];
  var META = window.PRO_META || {};
  // 战队资料（阵容 / 排名）来自 HLTV.org 快照；准星与分享码仍来自 prosettings.net
  var HLT = window.HLTV_TEAMS || {};
  var HMETA = window.HLTV_META || {};
  // 预览画布统一 1:1 像素（zoom=1），只放大外框，不放大像素
  var CARD_XHAIR = 104;  // 选手卡片准星区（与 CSS .pc-xhair 高度一致）
  var MODAL_XHAIR = 188; // 详情弹窗主预览（与 CSS .m-preview 216px 留 14px 边距）
  var HIST_XHAIR = 72;   // 历史版本缩略图

  var MAPS = [
    // 6 张 2560×1440 全景游戏截图：整张图代表一个 1440p 游戏画面
    { name: "Dust2", file: "assets/bg-dust2.webp" },
    { name: "Mirage", file: "assets/bg-mirage.webp" },
    { name: "Inferno", file: "assets/bg-inferno.webp" },
    { name: "Nuke", file: "assets/bg-nuke.webp" },
    { name: "Ancient", file: "assets/bg-ancient.webp" },
    { name: "Train", file: "assets/bg-train.webp" },
  ];
  // 背景截图的「场景屏幕高度」：仅用于文案标注；几何换算只依赖模型 screenHeight
  var SCENE = { w: 2560, h: 1440, label: "2560×1440" };

  var ROLE_ZH = { AWPer: "狙击手", Rifler: "步枪手", IGL: "指挥", Lurker: "自由人", Entry: "突破手", Support: "辅助" };

  var state = {
    settings: null,
    bgIndex: 0,
    team: "",
    role: "",             // 位置筛选（"" = 全部）
    sort: "default",      // 列表排序方式
    current: null,
    currentCode: null,
    pristineCode: null,   // 刚导入的原分享码（只回显 cs2-v1；旧码已不被游戏接受）
    importInfo: null,     // 最近一次导入的码信息 {container, format, migration, sourceCode}
    collapsed: {},        // 战队折叠状态 {teamKey: true}
    modalOpener: null,    // 打开弹窗前聚焦的元素，关闭后把焦点还回去
  };

  /* 动态预览状态机：
   *   mode = off（静止/回落） | auto（自动循环连发） | hold（按住画面连发）
   *   spread / climb 是 0–1 的包络，绘制时再乘模型的像素上限。
   */
  var dyn = {
    mode: "off",
    firing: false,
    spread: 0,
    climb: 0,
    jitter: 0,
    raf: 0,
    last: 0,
    startedAt: 0,
    prevAuto: false,
  };
  // 自动演示节奏对齐游戏内预览（2026-10-21 逐帧实测）：
  // 涨 ~1.25s、落 ~1.3s、静息 ~0.4s，一轮约 2.95s。
  var DYN_CYCLE_MS = 2950;
  var DYN_FIRE_MS = 1250;

  var $ = function (id) { return document.getElementById(id); };
  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }
  function raf(fn) {
    if (typeof window.requestAnimationFrame === "function") return window.requestAnimationFrame(fn);
    return setTimeout(function () { fn(nowMs()); }, 16);
  }
  function caf(id) {
    if (!id) return;
    if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(id);
    else clearTimeout(id);
  }
  /* View Transitions API（渐进增强）：主题/视图切换时整页交叉淡化 220ms。
   * 不支持的环境或 reduced-motion 用户直接执行，行为与旧版一致。 */
  function withViewTransition(fn) {
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
    if (typeof document.startViewTransition === "function" && !reduce) {
      try { document.startViewTransition(fn); return; } catch (e) { /* 落回直接执行 */ }
    }
    fn();
  }

  /* ---------------- 工具 ---------------- */
  function fmt(v) { return Math.round(Number(v) * 100) / 100; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // 国旗统一用本地 HLTV 抓下来的 GIF（44 个），缺失时回落到 emoji
  var FLAG_SET = null;
  function flagImg(cc, cls) {
    var c = String(cc || "").toUpperCase();
    if (c.length === 2) {
      if (!FLAG_SET) {
        FLAG_SET = {};
        "AR AU BA BG BR BY CA CL CN CZ DE DK EE ES EU FI FR GB GT HU IL KZ LT LV MK MN MY NAM NO NZ PL RO RS RU SAM SE SK TR TW UA US UY XK ZA".split(" ").forEach(function (x) { FLAG_SET[x] = 1; });
      }
      if (FLAG_SET[c]) {
        return '<img class="' + (cls || "pc-flag") + '" src="assets/hltv/flags/' + c + '.gif" alt="" decoding="async">';
      }
    }
    return '<span class="' + (cls || "pc-flag") + ' flag-emoji">' + flagEmoji(cc) + "</span>";
  }
  function flagEmoji(cc) {
    if (!cc || cc.length !== 2) return "🏳️";
    var A = 0x1f1e6;
    return String.fromCodePoint(A + (cc.charCodeAt(0) - 97), A + (cc.charCodeAt(1) - 97));
  }
  function roleZh(r) { return ROLE_ZH[r] || r || "选手"; }
  // 位置口径（筛选与展示共用）：
  //   狙击手 = 源数据 r=AWPer；指挥 = HLTV 现役阵容里的 IGL 标记；其余算步枪手。
  //   一人可同时是「狙击手 + 指挥」（如 FalleN / Jame），返回多值数组。
  function rolesOf(p) {
    if (!p) return [];
    var out = [];
    if (p.r === "AWPer") out.push("AWPer");
    var live = lineupOf(p);
    if (live && live.igl) out.push("IGL");
    if (!out.length) out.push("Rifler");
    return out;
  }
  function roleLabel(p) {
    var rs = rolesOf(p);
    return rs.length ? rs.map(roleZh).join(" / ") : "选手";
  }
  function teamByKey(k) { for (var i = 0; i < TEAMS.length; i++) if (TEAMS[i].k === k) return TEAMS[i]; return null; }
  function hltvOf(k) { return (k && HLT[k]) || null; }
  // 队标优先用 HLTV 抓下来的当季队标；抓不到 PNG/SVG 的（如占位灰盾）回落到本地队标
  function teamLogo(t, h) {
    var hh = h || (t && hltvOf(t.k));
    // 站点恒为深色主题：优先 night 变体（多数是白色版队标）
    var pick = hh && hh.logo ? (hh.logo.night || hh.logo.day) : "";
    if (pick && /\.(png|svg|webp|jpg)$/i.test(pick)) return pick;
    if (hh && hh.logo && hh.logo.day && /\.(png|svg|webp|jpg)$/i.test(hh.logo.day)) return hh.logo.day;
    return t ? t.logo : "";
  }
  function hltvStamp() {
    if (!HMETA.updated) return "";
    var d = new Date(HMETA.updated);
    if (isNaN(d.getTime())) return String(HMETA.updated).slice(0, 10);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function toast(msg, ok) {
    var t = $("toast");
    t.innerHTML = (ok === false ? '<span class="t-ico err">✕</span>' : '<span class="t-ico ok">✓</span>') + esc(msg);
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  // 复制成功后按钮短暂变为「✓ 已复制」（宽按钮全文案，窄按钮只换 ✓），与 toast 同步确认
  function flashCopied(btn) {
    if (!btn || btn._flash) return;
    btn._flash = true;
    var orig = btn.innerHTML;
    btn.innerHTML = (btn.offsetWidth || 0) >= 120 ? "✓ 已复制" : "✓";
    btn.classList.add("is-done");
    setTimeout(function () { btn.innerHTML = orig; btn.classList.remove("is-done"); btn._flash = false; }, 1100);
  }

  function copyText(text, msg, btn) {
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(msg || "已复制"); flashCopied(btn); } catch (e) { toast("复制失败", false); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg || "已复制"); flashCopied(btn); }).catch(legacy);
    } else legacy();
  }

  /* ---------------- 系统工具 ---------------- */
  // 用户屏幕高度：浏览器/无头环境可能拿不到（jsdom 返回 0），拿不到就按 1080
  function userScreenHeight() {
    var h = 0;
    try { h = Math.round(Number(window.screen && window.screen.height) || 0); } catch (e) { h = 0; }
    if (!isFinite(h) || h < 240) h = 1080;
    return Math.min(65535, h);
  }

  /* ---------------- 控制台命令 ----------------
   * 展示：一句一行（美观、可逐条核对）。
   * 复制：控制台输入框是单行的，多行文本粘进去会丢掉换行拼成一整行，
   *       超过 512 字符会被整条丢弃并报 Command too long —— 所以「复制命令」
   *       复制的是分号分隔的单行版，并实时给出字符占比。 */
  function pasteChunks() { return CS.settingsToPasteChunks(state.settings); }

  // 把「单行分号版」拆成逐句数组（真正会生效的那些语句）
  function pasteCommands() {
    var out = [];
    pasteChunks().forEach(function (c) {
      String(c || "").split(";").forEach(function (part) {
        var t = part.trim();
        if (t) out.push(t);
      });
    });
    return out;
  }

  function pasteLenHtml(chunks) {
    var max = chunks.reduce(function (a, c) { return Math.max(a, c.length); }, 0);
    var over = chunks.length > 1;
    return '<span class="' + (over ? "over" : "") + '">单行 ' + max + " / " + CS.PASTE_LIMIT +
      " 字符" + (over ? " · 共 " + chunks.length + " 段" : "") + "</span>";
  }

  function renderExtraChunks(id, chunks) {
    var host = $(id);
    if (!host) return;
    host.innerHTML = chunks.length > 1
      ? chunks
          .map(function (c, i) {
            return '<div class="cmd-line"><span class="idx">' + (i + 1) + "</span><code>" + esc(c) +
              '</code><button class="btn btn-ghost" data-paste="' + i + '">复制</button></div>';
          })
          .join("")
      : "";
  }

  function renderPaste() {
    var chunks = pasteChunks();
    // 展示层：一句一行（控制台拷贝仍走单行分号版）
    var lines = pasteCommands();
    if ($("cfgOutput")) {
      $("cfgOutput").value = lines.join("\n");
    }
    if ($("pasteLen")) $("pasteLen").innerHTML = pasteLenHtml(chunks);
    renderExtraChunks("pasteExtra", chunks);
  }

  function copyPaste() {
    var chunks = pasteChunks();
    if (!chunks.length) return;
    if (chunks.length === 1) {
      copyText(chunks[0], "单行命令已复制 · " + chunks[0].length + " 字符，粘贴进控制台回车即可", $("btnCopyPaste"));
    } else {
      copyText(chunks[0], "已复制第 1/" + chunks.length + " 段，粘贴后复制下一段", $("btnCopyPaste"));
    }
  }

  function bindExtraChunks(id) {
    var host = $(id);
    if (!host) return;
    host.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-paste]");
      if (!btn) return;
      var i = Number(btn.dataset.paste);
      var chunks = pasteChunks();
      copyText(chunks[i] || "", "已复制第 " + (i + 1) + "/" + chunks.length + " 段");
    });
  }

  function setFill(input) {
    var min = parseFloat(input.min) || 0, max = parseFloat(input.max) || 100, v = parseFloat(input.value);
    if (!isFinite(v)) v = min;
    input.style.setProperty("--fill", ((v - min) / (max - min || 1)) * 100 + "%");
  }

  /* ---------------- 分享码格式识别 / 旧码提示 ---------------- */
  function codeKind(code) {
    var c = String(code || "").trim();
    if (/^CS[A-Za-z0-9]{44}$/.test(c)) return "cs2";
    if (/^CSGO(-?[A-Za-z0-9]{5}){5}$/.test(c)) return "legacy";
    return c ? "unknown" : "empty";
  }

  function renderCodeFormat(code) {
    var el = $("codeFormat");
    if (!el) return;
    var k = codeKind(code);
    var label = k === "cs2" ? "CS2 新格式 · " + String(code).trim().length + " 字符"
      : k === "legacy" ? "CSGO 旧格式 · 游戏已不接受导入"
        : k === "unknown" ? "无法识别的格式"
          : "等待输入";
    el.textContent = label;
    el.className = "code-tag " + (k === "cs2" ? "ok" : k === "legacy" ? "warn" : k === "unknown" ? "err" : "");
  }

  function migrationLabel(info) {
    var f = String((info && info.format) || "");
    var from = String((info && info.migration && info.migration.from) || "");
    if (/^legacy-v/.test(f)) return "CSGO " + f + " 旧码";
    // from=convars 且 lossy=false ⇒ 这是新系统文本，只是夹带了旧 convar 残留，不能叫「旧版」
    if (f === "convars") return from === "legacy-convars" ? "旧版控制台命令" : "CS2 控制台命令";
    return f || "旧格式码";
  }

  /* 导入说明条，两种口吻：
   *  - 旧格式（lossy）：必须明说「近似换算」，因为游戏已不接受旧码
   *  - 新系统文本夹旧残留：数值原样采用，旧 convar 只是存档残留
   * cs2 新码没有 migration，不显示。 */
  function migrationHtml(info) {
    if (!info || !info.migration) return "";
    var notes = info.migration.notes || [];
    var lossy = !!info.migration.lossy;
    var head;
    if (lossy) {
      head = '<span class="nb-tag">旧格式码</span><b>' + esc(migrationLabel(info)) +
        "</b>：游戏已不接受导入，已按官方像素公式<b>近似</b>换算为新模型（基准 " +
        (info.migration.h || 1080) + "p），并已改写成新的 CS2 分享码。";
    } else {
      head = '<span class="nb-tag">兼容提示</span><b>' + esc(migrationLabel(info)) +
        "</b>：数值<b>原样</b>采用，未做任何换算。";
    }
    return head +
      (info.sourceCode ? '<div class="nb-src">原码 ' + esc(info.sourceCode) + "</div>" : "") +
      (notes.length
        ? '<ul class="nb-list">' + notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>"
        : "");
  }

  function renderPastNotice() {
    var html = migrationHtml(state.importInfo);
    ["legacyNotice", "legacyNoticeShare"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.innerHTML = html;
      el.hidden = !html;
    });
  }

  /* ==================================================================
   * 官方像素渲染器 —— 单一真源在 render-canvas.js 的 CS.renderOpsSnapped
   * paint(cv, s, cssW, cssH, zoom, recoil, opts)
   *   zoom: 显示缩放（1 = 真实游戏像素大小；仅用于小窗适配，不影响几何）
   *   opts.viewHeight: 预览屏幕高度，缺省 = 模型自己的 screenHeight（缩放 ×1）
   * 几何唯一真源 = CS.buildDrawOps(model, {recoil, viewHeight})；
   * 画布尺寸与 DPR 只进 unit（zoom * dpr），绝不参与 f / b / x 几何计算。
   * 坐标全部在设备像素上做整数吸附 → 高/低/分数 DPR 都锐利
   * ==================================================================*/
  function paint(cv, s, cssW, cssH, zoom, recoil, opts) {
    if (!cv || !s) return;
    // zoom 允许小数:预览舞台按背景图缩放比例绘制,保证准星与场景比例和游戏一致
    zoom = Math.max(0.02, zoom || 1);
    var o = opts || {};
    var vh = o.viewHeight != null ? o.viewHeight : s.screenHeight;
    var dpr = window.devicePixelRatio || 1;
    var dw = Math.max(2, Math.round(cssW * dpr));
    var dh = Math.max(2, Math.round(cssH * dpr));
    if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; }
    if (cv.style.width !== cssW + "px") { cv.style.width = cssW + "px"; cv.style.height = cssH + "px"; }
    var ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    CS.renderOpsSnapped(ctx, CS.buildDrawOps(s, {
      recoil: !!recoil,
      viewHeight: vh,
      spread01: o.spread01,
      split01: o.split01,
      climb01: o.climb01,
      spreadPx: o.spreadPx,
      climbPx: o.climbPx,
      splitScale: o.splitScale,
    }), dw / 2, dh / 2, zoom * dpr);
  }

  /* ---------------- 视图切换 / 主题 / 回到顶部 ---------------- */
  function switchView(name) {
    withViewTransition(function () {
      var views = ["generator", "pros"];
      views.forEach(function (v) { $("view-" + v).hidden = v !== name; });
      document.querySelectorAll("#viewTabs .tab").forEach(function (t) {
        var on = t.dataset.view === name;
        t.classList.toggle("active", on);
        // tablist 语义：选中态与「只有当前页签可 Tab 到」都要跟着变
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      window.scrollTo(0, 0);
      if (name === "pros") { dynHardStop(false); renderPlayers(); }
      if (name === "generator") { renderPreview(); }
      syncGenLayout();
    });
  }

  /* ---------------- 生成器布局 ----------------
   * 左右分栏后预览尺寸只由窗口尺寸决定（不随滚动/主题变化）：
   * 这里只在视图切换 / 初始化时把画布重绘到实际尺寸。窗口 resize 由独立监听处理。
   */
  function syncGenLayout() {
    var gen = $("view-generator");
    if (!gen || gen.hidden) return;
    renderMainPreview();
  }

  /* ---------------- 滑杆拖拽数值气泡 ----------------
   * 拖动/键盘调参时浮出气泡跟随拇指，数值与芯片同源；松手/失焦即隐。
   * 定位用视口坐标 + fill 比例估算 thumb 圆心（误差 ≤ 半个拇指宽，够用）；
   * 无头环境 rect 为 0 时直接隐藏，不出气泡。 */
  var rangeBubble = null;
  function isGenRange(t) {
    return !!(t && t.type === "range" && t.closest && t.closest(".settings-panel"));
  }
  function ensureRangeBubble() {
    if (rangeBubble) return rangeBubble;
    rangeBubble = document.createElement("div");
    rangeBubble.id = "rangeBubble";
    rangeBubble.setAttribute("aria-hidden", "true");
    document.body.appendChild(rangeBubble);
    return rangeBubble;
  }
  function moveRangeBubble(input) {
    var rect = input.getBoundingClientRect();
    if (!rect.width) { hideRangeBubble(); return; }
    var bubble = ensureRangeBubble();
    var min = parseFloat(input.min) || 0;
    var max = parseFloat(input.max);
    var v = parseFloat(input.value);
    var frac = Math.max(0, Math.min(1, isFinite(max) && max !== min ? (v - min) / (max - min) : 0));
    var x = rect.left + 9 + frac * (rect.width - 18);
    x = Math.max(rect.left + 14, Math.min(rect.right - 14, x));
    var field = input.closest(".field");
    var chip = (field && field.querySelector(".field-val")) ||
      (input.closest(".rgb-cell") && input.closest(".rgb-cell").querySelector(".rgb-val"));
    bubble.textContent = chip ? chip.textContent : input.value;
    bubble.style.left = Math.round(x) + "px";
    bubble.style.top = Math.round(rect.top - 10) + "px";
    bubble.classList.add("show");
  }
  function hideRangeBubble() {
    if (rangeBubble) rangeBubble.classList.remove("show");
  }
  function bindRangeBubble() {
    document.addEventListener("input", function (e) { if (isGenRange(e.target)) moveRangeBubble(e.target); });
    document.addEventListener("pointerdown", function (e) { if (isGenRange(e.target)) moveRangeBubble(e.target); }, true);
    document.addEventListener("focusin", function (e) { if (isGenRange(e.target)) moveRangeBubble(e.target); });
    document.addEventListener("pointerup", hideRangeBubble);
    document.addEventListener("pointercancel", hideRangeBubble);
    document.addEventListener("focusout", function (e) {
      if (e.target && e.target.type === "range") setTimeout(hideRangeBubble, 180);
    });
  }

  function bindChrome() {
    document.querySelectorAll("#viewTabs .tab").forEach(function (t) {
      t.addEventListener("click", function () { switchView(t.dataset.view); });
    });
    // tablist 键盘惯例：← → 在页签间移动并即时切换，Home / End 跳到首尾
    $("viewTabs").addEventListener("keydown", function (e) {
      var keys = { ArrowLeft: -1, ArrowRight: 1 };
      var tabs = [].slice.call(document.querySelectorAll("#viewTabs .tab"));
      var cur = tabs.indexOf(document.activeElement);
      var next = null;
      if (e.key in keys) next = tabs[(cur + keys[e.key] + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      switchView(next.dataset.view);
      next.focus({ preventScroll: true });
    });

    $("toTop").addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) dynHardStop(true);
    });
    // scroll 只负责「回到顶部」按钮的显隐（左右分栏下预览恒定，无需滚动形态切换）
    window.addEventListener("scroll", function () {
      $("toTop").classList.toggle("show", window.scrollY > 600);
      hideRangeBubble(); // 滚动后气泡的视口坐标已过期
    }, { passive: true });
    bindRangeBubble();
    // 键盘友好：在选手库按 / 直接聚焦搜索框，Esc 清空
    document.addEventListener("keydown", function (e) {
      if ($("view-pros").hidden) return;
      var tag = (e.target && e.target.tagName) || "";
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        $("proSearch").focus();
      } else if (e.key === "Escape" && e.target === $("proSearch") && $("proSearch").value) {
        $("proSearch").value = "";
        renderPlayers();
      }
    });
    syncGenLayout();
  }

  /* ---------------- 默认设置 / 控件绑定表 ---------------- */
  // 默认 = CS.defaultSettings()：style 4、thickness 2px、length 11px、gap 7px、1080p、绿色
  function defaultSettings() { return CS.defaultSettings(); }

  // 全部为「新模型像素字段」，不再做任何新旧刻度换算
  var SLIDERS = [
    { id: "sLength", key: "length", v: "vLength" },
    { id: "sThickness", key: "thickness", v: "vThickness" },
    { id: "sGap", key: "gap", v: "vGap" },
    { id: "sSpread", key: "dynamicSpreadLimit", v: "vSpread" },
    { id: "sOR", key: "outlineRed", v: "vOR" },
    { id: "sOG", key: "outlineGreen", v: "vOG" },
    { id: "sOB", key: "outlineBlue", v: "vOB" },
    { id: "sOA", key: "outlineAlpha", v: "vOA" },
    { id: "sSplitDist", key: "splitDistance", v: "vSplitDist" },
    { id: "sInnerSplit", key: "innerSplitAlpha", v: "vInnerSplit" },
    { id: "sOuterSplit", key: "outerSplitAlpha", v: "vOuterSplit" },
    { id: "sSplitRatio", key: "splitSizeRatio", v: "vSplitRatio" },
  ];
  var TOGGLES = [
    { id: "sDot", key: "centerDotEnabled" },
    { id: "sT", key: "tStyleEnabled" },
    { id: "sRecoil", key: "followRecoil" },
  ];

  /* ---------------- 预览：1:1 原生像素 ----------------
   * 准星永远按「1 模型像素 = 1 CSS 像素」绘制，与窗口大小、DPR、屏幕高度无关：
   * 这就是游戏里准星在 100% HUD 缩放下的真实像素大小。
   * 背景截图只是衬底（object-fit: cover），不参与任何缩放运算，
   * 因此不会因为「准星和地图比例对不上」而误导用户 —— 这一点与 prosettings
   * 的做法一致：那边是固定 50×50 像素格 + 逐像素 rect，背景是装饰条。
   */
  function renderMainPreview() {
    var cv = $("previewCanvas");
    var st = $("previewStage");
    if (!cv || !st) return;
    var w = st.clientWidth || cv.clientWidth || 0;
    var h = st.clientHeight || cv.clientHeight || 0;
    if (w <= 0 || h <= 0) return;
    var s = state.settings;
    paint(cv, s, w, h, 1, dyn.firing, {
      spread01: Math.min(1, Math.max(0, dyn.spread * (1 + (dyn.firing ? dyn.jitter : 0)))),
      split01: dyn.firing ? 1 : dyn.spread,
      climb01: dyn.climb,
    });
  }

  /* ---------------- 动态预览动画 ----------------
   * 新系统显示真实武器散布，这里用一个「代表性步枪连发」的包络做示意：
   *   · 开火：spread 快速上升并在上限附近抖动
   *   · 松开：指数回落
   *   · followRecoil 开启时叠加 6px 上抬
   * 只动画「展示层」，不改模型、不改分享码。
   */
  function isDynStyle() {
    // 「可演示」= 动态散布样式 + 有开火反馈的样式（style 5 的 k 脉冲）。
    return !!state.settings && (!CS.isStaticStyle(state.settings) || CS.hasFireFeedback(state.settings));
  }

  function dynMaxSpread() {
    var s = state.settings;
    if (!s) return 0;
    var limit = Number(s.dynamicSpreadLimit);
    if (!isFinite(limit)) limit = 255;
    return Math.max(0, Math.min(CS.MAX_SPREAD_PX, limit));
  }

  function dynSpreadPx() {
    if (!isDynStyle()) return 0;
    if (CS.hasFireFeedback(state.settings)) {
      // style 5：外推量 = shotR - gap = H·k/1200（k = 25 × env），与渲染同一处计算。
      var fm = CS.crosshairMetrics(state.settings, { spread01: dyn.spread });
      return Math.max(0, fm.shotR - fm.gapPx);
    }
    var jitter = 1 + (dyn.firing ? dyn.jitter : 0);
    return Math.max(0, dyn.spread * dynMaxSpread() * jitter);
  }

  function dynClimbPx() {
    var s = state.settings;
    if (!s || !isDynStyle() || !s.followRecoil) return 0;
    return Math.max(0, dyn.climb * CS.MAX_CLIMB_PX);
  }

  function updateDynButton() {
    var btn = $("btnRecoil");
    if (!btn) return;
    var playing = dyn.mode !== "off";
    btn.classList.toggle("is-playing", playing);
    btn.setAttribute("aria-pressed", playing ? "true" : "false");
    if (dyn.mode === "auto") btn.innerHTML = '<span class="btn-ico">■</span> 停止预览';
    else if (dyn.mode === "hold") btn.innerHTML = '<span class="btn-ico">◉</span> 连发中…';
    else btn.innerHTML = '<span class="btn-ico">▶</span> 动态预览';
  }

  function updateFireUI() {
    var active = dyn.mode !== "off" || dyn.spread > 0.02;
    var chip = $("recoilChip");
    if (chip) {
      chip.classList.toggle("show", active);
      chip.textContent = dyn.firing ? "开火中" : (dyn.spread > 0.04 ? "回落中" : "待机");
    }
    var meter = $("fireMeter");
    if (meter) meter.classList.toggle("show", active);
    var style = state.settings ? Number(state.settings.style) : 4;
    var shape = CS.styleShape(style);
    var splitStyle = !!CS.isSplitStyle(state.settings);
    var feedbackStyle = !!CS.hasFireFeedback(state.settings);
    var ringStyle = shape === "circle" || shape === "quad";
    var pulseAmount = dyn.spread;
    if (splitStyle) pulseAmount = Number(state.settings.splitDistance) > 0 ? (dyn.firing ? 1 : dyn.spread) : 0;
    else if (feedbackStyle) pulseAmount = dyn.spread;
    else if (!ringStyle) pulseAmount = dynMaxSpread() > 0 ? dyn.spread : 0;
    var bar = $("fmBar");
    if (bar) bar.style.transform = "scaleX(" + Math.min(1, Math.max(0, pulseAmount)).toFixed(3) + ")";

    var label = $("fmLabel");
    if (label) label.textContent = splitStyle ? "SPLIT" : (feedbackStyle ? "FEEDBACK" : (ringStyle ? "RING" : "SPREAD"));
    var val = $("fmVal");
    if (val) {
      if (splitStyle) {
        // style 2：内臂推进 min(R, splitdist)，外臂推进完整半径 R（0xDA66C0 实读）。
        // 读数取「内臂实际推进量」（px），splitdist 是它的上限。
        var splitM = CS.crosshairMetrics(state.settings, { spread01: dyn.firing ? 1 : dyn.spread });
        val.textContent = Math.min(splitM.spread, splitM.splitPx).toFixed(1);
      } else if (feedbackStyle) {
        // style 5：读数取「反馈外推的像素量」= H·k/1200（k = 25 × env），满量 22.5px @1080p。
        var fbM = CS.crosshairMetrics(state.settings, { spread01: dyn.spread });
        val.textContent = Math.max(0, fbM.shotR - fbM.gapPx).toFixed(1);
      } else if (ringStyle) {
        // 半径由投影模型给出：R = focal(H) × t，t = 0.1 × spread01 × (limit/255)，
        // focal = 2H/3（1080p = 720）⇒ 满散布 72px；读数直接取引擎结果。
        var ringM = CS.crosshairMetrics(state.settings, { spread01: dyn.spread });
        val.textContent = Number(ringM.ringR).toFixed(1);
      } else {
        val.textContent = dynSpreadPx().toFixed(1);
      }
    }
  }

  function dynHardStop(redraw) {
    caf(dyn.raf);
    dyn.raf = 0;
    dyn.mode = "off";
    dyn.firing = false;
    dyn.spread = 0;
    dyn.climb = 0;
    dyn.jitter = 0;
    updateDynButton();
    updateFireUI();
    if (redraw) renderMainPreview();
  }

  function dynSettle() {
    dyn.mode = "off";
    dyn.firing = false;
    if (!dyn.raf) {
      dyn.last = nowMs();
      dyn.raf = raf(dynTick);
    }
    updateDynButton();
  }

  function dynStartAuto() {
    if (!isDynStyle()) return;
    dyn.mode = "auto";
    dyn.startedAt = nowMs();
    dyn.firing = true;
    if (!dyn.raf) {
      dyn.last = nowMs();
      dyn.raf = raf(dynTick);
    }
    updateDynButton();
    updateFireUI();
  }

  function dynStartHold() {
    if (!isDynStyle()) return;
    if (dyn.mode !== "hold") dyn.prevAuto = dyn.mode === "auto";
    dyn.mode = "hold";
    dyn.firing = true;
    if (!dyn.raf) {
      dyn.last = nowMs();
      dyn.raf = raf(dynTick);
    }
    updateDynButton();
    updateFireUI();
  }

  function dynEndHold() {
    if (dyn.mode !== "hold") return;
    if (dyn.prevAuto) {
      dyn.mode = "auto";
      // 松开时从「开火结束」相位继续，先完整回落一次，再进入下一轮
      dyn.startedAt = nowMs() - DYN_FIRE_MS;
    } else {
      dynSettle();
    }
    updateDynButton();
  }

  function dynTick() {
    dyn.raf = 0;
    var now = nowMs();
    var dt = Math.max(0, Math.min(0.05, (now - dyn.last) / 1000));
    dyn.last = now;

    if (!isDynStyle()) { dynHardStop(true); return; }

    var firing;
    if (dyn.mode === "hold") firing = true;
    else if (dyn.mode === "auto") firing = ((now - dyn.startedAt) % DYN_CYCLE_MS) < DYN_FIRE_MS;
    else firing = false;
    dyn.firing = firing;

    var target = firing ? 1 : 0;
    // 实机 AK 连发：0.35s 约到 45–50% 包络，1.2s 接近上限；1.8/s 的上升速率更贴近。
    var rate = firing ? 1.6 : 3.2;
    dyn.spread += (target - dyn.spread) * Math.min(1, rate * dt);
    dyn.climb += (((firing && state.settings.followRecoil) ? 1 : 0) - dyn.climb) * Math.min(1, 6 * dt);
    dyn.jitter = firing ? (Math.sin(now / 37) * 0.06 + Math.sin(now / 71 + 1.3) * 0.03) : 0;

    if (dyn.mode === "off" && dyn.spread < 0.004 && dyn.climb < 0.004) {
      dynHardStop(false);
      renderMainPreview();
      return;
    }

    renderMainPreview();
    updateFireUI();
    dyn.raf = raf(dynTick);
  }

  /* ---------------- 舞台标注 ----------------
   * 没有检视倍率：预览恒为 1:1 原生像素（1 模型像素 = 1 CSS 像素）。
   * 「制作基准」概念已移除 —— 准星几何不再随分辨率变化。 */

  function applySettingsToUI() {
    var s = state.settings;
    if (!s) return;
    // 样式下拉：10 项，显示「编号 · 中文名（English）」
    var sel = $("styleSel");
    if (sel) {
      if (!sel.options || !sel.options.length) {
        sel.innerHTML = CS.STYLES.map(function (st) {
          return '<option value="' + st.value + '">' + esc(st.value + " · " + st.zh + "（" + st.en + "）") + "</option>";
        }).join("");
      }
      sel.value = String(s.style);
    }
    SLIDERS.forEach(function (sl) {
      var input = $(sl.id);
      if (input) { input.value = s[sl.key]; setFill(input); }
      if ($(sl.v)) $(sl.v).textContent = fmt(s[sl.key]);
    });
    TOGGLES.forEach(function (tg) { var input = $(tg.id); if (input) input.checked = !!s[tg.key]; });
    if ($("outlineSeg")) {
      $("outlineSeg").querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", Number(b.dataset.outline) === Number(s.outlineMode));
      });
    }
    syncGapRange();
    syncColorUI();
    syncOutlineUI();
    syncDynamicPanel();
  }

  // 颜色区：SV 方块 / 色相条 / 不透明度条 / 数值框，四者共用同一份 state.settings
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

  // 描边：三态 + 描边颜色。关闭描边时颜色置灰（控制台也不会输出那四条命令）
  function syncOutlineUI() {
    var s = state.settings;
    if (!s) return;
    var mode = Number(s.outlineMode) || 0;
    var off = mode === 0;
    var host = $("outlineColorHost");
    if (host) {
      host.classList.toggle("is-dim", off);
      host.querySelectorAll("input").forEach(function (i) { i.disabled = off; });
    }
  }

  // gap 量程随样式变化：只有「2 动态十字(经典)」允许负值
  function syncGapRange() {
    var s = state.settings;
    if (!s) return;
    var input = $("sGap");
    if (!input) return;
    var allowNeg = Number(s.style) === 2;
    input.min = allowNeg ? "-10" : "0";
    input.max = "128";
    var minV = parseFloat(input.min), maxV = parseFloat(input.max);
    if (s.gap < minV) s.gap = minV;
    if (s.gap > maxV) s.gap = maxV;
    input.value = s.gap;
    setFill(input);
    if ($("vGap")) $("vGap").textContent = fmt(s.gap);
  }

  // 样式相关的提示与控件可用态
  //   · 静态样式（3/4/6/8/9）开火不变化 → 禁用「动态预览」、散布上限置灰
  //   · 开火分裂参数仅 style 2（经典）生效
  function syncDynamicPanel() {
    var s = state.settings;
    if (!s) return;
    var dynamic = !CS.isStaticStyle(s);
    var animatable = dynamic || CS.hasFireFeedback(s);
    // 分裂参数面板只对 style 2 生效（游戏 0xDA66C0 是唯一调用两次 ARMS 的样式）
    var splitOn = CS.isSplitStyle(s);
    if ($("splitCollapse")) $("splitCollapse").classList.toggle("dim", !splitOn);

    var sf = $("spreadField");
    if (sf) sf.classList.toggle("is-dim", !dynamic);
    if ($("sSpread")) $("sSpread").disabled = !dynamic;

    var row = $("recoilRow");
    if (row) row.classList.toggle("is-dim", !animatable);

    // 舞台连发提示签：只有可演示的样式才显示（静态准星没有开火反馈）
    if ($("stageHint")) $("stageHint").hidden = !animatable;

    var btn = $("btnRecoil");
    if (btn) {
      btn.disabled = !animatable;
      btn.title = animatable
        ? "自动循环演示连发时的散布扩散与回落"
        : "静态样式在开火时不会变化（已禁用）";
    }
    if (!animatable) dynHardStop(true);
    updateDynButton();

  }

  function renderPreview() {
    var s = state.settings;
    if (!s) return;
    renderMainPreview();
    updateFireUI();
  }

  function renderBackground() {
    var m = MAPS[state.bgIndex];
    $("bgImg").src = m.file;
    var dots = $("mapDots");
    if (dots && dots.children.length !== MAPS.length) {
      dots.innerHTML = MAPS.map(function (m2, i2) {
        return '<button title="切换到 ' + m2.name + '" aria-label="切换到 ' + m2.name + '" data-i="' + i2 + '"><span class="dot"></span><span class="txt">' + m2.name + "</span></button>";
      }).join("");
      Array.prototype.forEach.call(dots.children, function (b) {
        b.addEventListener("click", function () {
          state.bgIndex = Number(b.dataset.i);
          renderBackground();
        });
      });
    }
    if (dots) {
      Array.prototype.forEach.call(dots.children, function (b, i2) {
        b.classList.toggle("active", i2 === state.bgIndex);
      });
    }
  }

  function currentShareCode() {
    try { return CS.encodeShareCode(state.settings); } catch (e) { return ""; }
  }

  function syncOutputs() {
    var code = state.pristineCode || currentShareCode();
    $("shareCodeInput").value = code;
    renderCodeFormat(code);
    renderPastNotice();
    renderPaste();
    queueHashSync(code);
  }

  /* ---------------- 地址栏分享（#CS… / #CSGO-…） ---------------- */
  var hashTimer = null;
  function queueHashSync(code) {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      try {
        var want = code ? "#" + encodeURIComponent(code) : "";
        if (want && location.hash !== want) history.replaceState(null, "", want);
      } catch (e) {}
    }, 500);
  }
  function readHash() {
    var h = decodeURIComponent((location.hash || "").replace(/^#/, "")).trim();
    // 分享码 Base57 字母表大小写敏感，绝不可大小写归一
    var k = codeKind(h);
    return (k === "cs2" || k === "legacy") ? h : null;
  }

  function updateAll() { renderPreview(); syncOutputs(); }

  // 旧码导入提示：附上原码文本；cs2-v1 不需要提示
  // container=cs2 也可能带 migration（新系统文本夹旧残留 / 本机存档），所以提示条按 migration 判显示
  function normalizeImportInfo(originalCode, info, s) {
    var merged = info || (s && s.migration ? { container: "legacy", format: s.format, migration: s.migration } : null);
    if (!merged) return null;
    var out = {
      container: merged.container,
      format: merged.format,
      migration: merged.migration,
    };
    if (merged.fromConvars) out.fromConvars = merged.fromConvars;
    if (originalCode && merged.container !== "cs2") out.sourceCode = originalCode;
    return out;
  }

  function applySettings(s, scroll, originalCode, info) {
    if (!s) return false;
    // 换模型前停掉动画：避免上一款准星的 spread/climb 残留到新样式上
    dynHardStop(false);
    state.settings = CS.normalizeModel(s);
    // 旧码游戏已拒绝导入，绝不回显到可复制的分享码框里；提示条另附原码
    state.pristineCode = (originalCode && CS.detectContainer(originalCode) === "cs2") ? originalCode : null;
    state.importInfo = normalizeImportInfo(originalCode, info, s);
    applySettingsToUI();
    updateAll();
    if (scroll) switchView("generator");
    return true;
  }

  function importCode(code, silent) {
    code = (code || "").trim();
    if (!code) { if (!silent) toast("请输入分享码", false); return false; }
    try {
      var info = CS.decodeInfo(code);
      applySettings(info.model, true, code, info);
      if (!silent) toast(info.container === "legacy" ? "已导入旧格式码（已近似换算）" : "已导入并应用");
      return true;
    } catch (e) {
      if (!silent) toast("分享码无效", false);
      return false;
    }
  }

  /* 统一导入：CS… 新码 / CSGO- 旧码 / 新旧控制台命令与 cfg 文本，自动识别 */
  function importAny(raw, silent) {
    var text = String(raw == null ? "" : raw).trim();
    var st = $("statusImport");
    var setStatus = function (msg, cls) { if (st) { st.textContent = msg; st.className = "status-msg " + cls; } };
    if (!text) { if (!silent) toast("请粘贴分享码或命令文本", false); return false; }
    var k = codeKind(text);
    if (k === "cs2" || k === "legacy") {
      var ok = importCode(text, silent);
      if (ok && !silent) setStatus(k === "legacy" ? "已识别为 CSGO 旧码：已近似换算为新模型" : "已识别为 CS2 新码，已应用", "ok");
      return ok;
    }
    if (/cl_[a-z0-9_]+/i.test(text)) {
      var model = CS.parseConVars(text);
      // 只有 lossy（旧码/旧命令换算）才叫「旧格式」；新系统文本 + 旧残留只是兼容提示
      var info = model.migration ? {
        container: model.migration.lossy ? "legacy" : "cs2",
        format: "convars",
        migration: model.migration,
      } : null;
      if (info && info.container === "cs2") info.fromConvars = "CS2 控制台命令";
      applySettings(model, true, null, info);
      if (!silent) {
        var isLegacyText = !!(info && info.container === "legacy");
        setStatus(isLegacyText ? "已识别为旧版控制台命令：已按像素公式近似换算" : "已识别为新版控制台命令，已应用", "ok");
        toast(isLegacyText ? "已从旧命令导入（近似换算）" : "已从命令导入准星");
      }
      return true;
    }
    if (!silent) { setStatus("无法识别：既不是分享码，也没有 cl_ 指令", "err"); toast("无法识别的输入", false); }
    return false;
  }

  // 导入框实时识别标签（交互效率：粘进去就知道是什么）
  function renderImportKind() {
    var el = $("importKind");
    if (!el) return;
    var text = String(($("importInput") && $("importInput").value) || "").trim();
    var k = codeKind(text);
    el.textContent = !text ? "自动识别"
      : k === "cs2" ? "CS2 新码"
        : k === "legacy" ? "CSGO 旧码 · 近似换算"
          : /cl_[a-z0-9_]+/i.test(text) ? "控制台命令 / cfg"
            : "无法识别";
  }

  // 用户改动后不再展示原分享码与旧码提示（此时输出的是全新的 CS2 码）
  function markDirty() { state.pristineCode = null; state.importInfo = null; }

  function bindGenerator() {
    SLIDERS.forEach(function (sl) {
      var input = $(sl.id);
      if (!input) return;
      input.addEventListener("input", function () {
        var v = parseFloat(input.value);
        if (!isFinite(v)) return;
        state.settings[sl.key] = v;
        if ($(sl.v)) $(sl.v).textContent = fmt(v);
        setFill(input);
        syncColorUI();
        markDirty();
        updateAll();
      });
    });
    // 双击参数行 → 该项恢复默认值（走既有 input 事件链，芯片/命令/预览同步刷新）
    var genPanel = document.querySelector(".settings-panel");
    if (genPanel) {
      genPanel.querySelectorAll(".field").forEach(function (f) {
        if (f.querySelector('input[type="range"]')) f.title = "双击恢复默认值";
      });
      genPanel.addEventListener("dblclick", function (e) {
        var field = e.target.closest ? e.target.closest(".field") : null;
        if (!field) return;
        var input = field.querySelector('input[type="range"]');
        if (!input || input.disabled) return;
        var meta = null;
        for (var i = 0; i < SLIDERS.length; i++) if (SLIDERS[i].id === input.id) { meta = SLIDERS[i]; break; }
        if (!meta) return;
        var def = CS.defaultSettings()[meta.key];
        if (def == null || Number(input.value) === Number(def)) return;
        input.value = String(def);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        var label = field.querySelector("label");
        toast("「" + (label ? label.textContent : meta.key) + "」已恢复默认 " + fmt(def));
      });
    }
    TOGGLES.forEach(function (tg) {
      var input = $(tg.id);
      if (!input) return;
      input.addEventListener("change", function () {
        state.settings[tg.key] = input.checked;
        markDirty();
        updateAll();
      });
    });
    bindColorPicker();
    // 样式：0-9 全部可选；切换后按新布局裁剪并刷新量程 / 可用态
    var styleSel = $("styleSel");
    styleSel.addEventListener("change", function () {
      // 切样式先把上一款的动态包络清零：否则旧样式的 spread/climb 会带进新样式，
      // 动态十字（style 2）满包络时臂会瞬间外推到 ~72px，看起来「预览突然变大」。
      dynHardStop(false);
      state.settings.style = Number(styleSel.value);
      state.settings = CS.normalizeModel(state.settings);
      markDirty();
      applySettingsToUI();
      updateAll();
    });
    // 描边三态
    $("outlineSeg").querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.settings.outlineMode = Number(b.dataset.outline);
        markDirty();
        applySettingsToUI();
        updateAll();
      });
    });
    // 地图切换:箭头与圆点(所有背景均为 2560×1440 等比截图,切换不影响准星比例)
    $("bgPrev").addEventListener("click", function () {
      state.bgIndex = (state.bgIndex - 1 + MAPS.length) % MAPS.length;
      renderBackground();
    });
    $("bgNext").addEventListener("click", function () {
      state.bgIndex = (state.bgIndex + 1) % MAPS.length;
      renderBackground();
    });
    // 数值徽标：点击直接输入（Enter/失焦提交，Esc 取消，自动夹取范围并对齐步进）
    SLIDERS.forEach(function (sl) {
      var badge = $(sl.v);
      if (!badge) return;
      badge.title = "点击输入数值";
      badge.addEventListener("click", function () {
        if (badge.classList.contains("editing")) return;
        var input = $(sl.id);
        if (!input || input.disabled) return;
        badge.classList.add("editing");
        var edit = document.createElement("input");
        edit.className = "val-edit";
        edit.value = badge.textContent;
        badge.textContent = "";
        badge.appendChild(edit);
        edit.focus();
        edit.select();
        var done = false;
        function commit(ok) {
          if (done) return;
          done = true;
          if (ok) {
            var v = parseFloat(edit.value);
            if (isFinite(v)) {
              var min = parseFloat(input.min), max = parseFloat(input.max), step = parseFloat(input.step) || 1;
              v = Math.min(max, Math.max(min, v));
              v = Math.round(v / step) * step;
              v = Math.round(v * 100) / 100;
              input.value = v;
              input.dispatchEvent(new Event("input"));
            }
          }
          badge.classList.remove("editing");
          badge.textContent = fmt(parseFloat(input.value));
        }
        edit.addEventListener("keydown", function (e) {
          if (e.key === "Enter") commit(true);
          else if (e.key === "Escape") commit(false);
        });
        edit.addEventListener("blur", function () { commit(true); });
      });
    });
    // 动态预览：点按自动循环演示，按住预览画面则连续开火（松手回落）
    $("btnRecoil").addEventListener("click", function () {
      if (this.disabled) return;
      if (dyn.mode === "auto" || dyn.mode === "hold") dynSettle();
      else dynStartAuto();
    });
    // 预览舞台：按住连发 / 方向键切图 / 空格开关自动演示
    var stage = $("previewStage");
    if (stage) {
      stage.addEventListener("pointerdown", function (e) {
        if (e.target.closest(".stage-arrow")) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (!isDynStyle()) return;
        e.preventDefault();
        dynStartHold();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
        stage.addEventListener(ev, dynEndHold);
      });
      stage.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          var dir = e.key === "ArrowRight" ? 1 : -1;
          state.bgIndex = (state.bgIndex + dir + MAPS.length) % MAPS.length;
          renderBackground();
        } else if (e.key === " " && isDynStyle()) {
          e.preventDefault();
          if (dyn.mode === "auto") dynSettle();
          else dynStartAuto();
        }
      });
    }
    $("btnRandom").addEventListener("click", function () {
      markDirty();
      applySettings(CS.randomSettings());
      toast("已掷出随机准星");
    });
    $("btnReset").addEventListener("click", function () {
      markDirty();
      applySettings(defaultSettings());
      toast("已重置为默认（4 静态十字）");
    });
    $("btnCopyCode").addEventListener("click", function () {
      if ($("shareCodeInput").value) copyText($("shareCodeInput").value, "分享码已复制 · 粘进游戏「导入准星」即可", this);
    });
    // 预览动作条：把主复制入口前置到预览旁，避免滚到分享面板才能拿结果
    $("btnQuickCopy").addEventListener("click", function () {
      if ($("shareCodeInput").value) copyText($("shareCodeInput").value, "分享码已复制 · 粘进游戏「导入准星」即可", this);
    });
    $("shareCodeInput").addEventListener("focus", function () { this.select(); });
    $("shareCodeInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); copyText($("shareCodeInput").value, "分享码已复制", this); }
    });
    // 统一导入框：新码 / 旧码 / 新旧命令串
    $("btnImportCode").addEventListener("click", function () {
      var raw = $("importInput").value || $("shareCodeInput").value;
      importAny(raw);
    });
    $("importInput").addEventListener("input", renderImportKind);
    $("importInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); importAny($("importInput").value); }
    });
    $("btnCopyPaste").addEventListener("click", copyPaste);
    bindExtraChunks("pasteExtra");
    // 窗口尺寸变化：预览重绘；若正停在选手库且跨过 760px 断点，卡片画布也要跟着改尺寸
    var resizeRaf = 0;
    window.addEventListener("resize", function () {
      renderPreview();
      if (resizeRaf) return;
      resizeRaf = raf(function () {
        resizeRaf = 0;
        if (!document.getElementById("view-pros").hidden) paintCardCanvases();
      });
    });
    // 舞台尺寸变化（吸附态切换 / 窗口缩放 / 视图切换）→ 重绘。
    // 观察的是 stage 而非 canvas：stage 高度由 CSS 决定，与 canvas 内联尺寸无关，不会自激。
    var stageEl = $("previewStage");
    if (stageEl && typeof ResizeObserver === "function") {
      var stageRaf = 0;
      new ResizeObserver(function () {
        if (stageRaf) return;
        stageRaf = raf(function () {
          stageRaf = 0;
          renderMainPreview();
        });
      }).observe(stageEl);
    }
    window.addEventListener("hashchange", function () {
      var code = readHash();
      if (code && code !== state.pristineCode) importCode(code, true);
    });
  }

  /* ---------------- 选手库 ---------------- */
  var decodeCache = {};
  // 返回 CS.decodeInfo 的结果 { model, container, format, migration }（失败为 null）
  function decodeInfoCached(code, opts) {
    var key = code + (opts && opts.screenHeight ? "@" + opts.screenHeight : "");
    if (key in decodeCache) return decodeCache[key];
    var info = null;
    try { info = CS.decodeInfo(code, opts); } catch (e) { info = null; }
    decodeCache[key] = info;
    return info;
  }

  /* 选手准星的「源数据时代」判定（按源数据，不是迁移后格式）：
   *   m.from 以 legacy 开头      → 旧准星（旧码/旧页面转换而来）：只允许存预览图
   *   有 c2 且 m.from 非 legacy  → 新准星（抓取自新格式页面）：完整功能
   *   无 c2/m 的老数据          → 兜底按码的容器判定 */
  function playerCode(p) { return (p && (p.c2 || p.c)) || ""; }
  function playerLegacy(p) {
    if (!p) return false;
    if (p.m && typeof p.m.from === "string" && /^legacy/.test(p.m.from)) return true;
    if (p.c2) return false;
    var info = decodeInfoCached(p.c);
    return !!info && info.container === "legacy";
  }
  // 历史条目：优先用采集时记录的 lg 标记（prosettings history API 的 legacy 字段），老数据按容器兜底
  function histLegacy(h, info) {
    if (h && h.lg != null) return !!h.lg;
    return !!info && info.container === "legacy";
  }
  // 选手分辨率高度（"1280x960" → 960）：旧码换算时作为参考屏幕高度，拿不到返回 undefined
  function resHeight(p) {
    var m = /^(\d{3,4})x(\d{3,4})$/.exec(String(p && p.i && p.i.res || ""));
    return m ? Number(m[2]) : undefined;
  }

  // 新模型字段的参数 chip（legacy：源数据时代为旧 → 追认「近似转换」标签）
  function chipsFor(info, legacy) {
    if (!info) return "";
    var s = info.model;
    var mode = ["无轮廓", "完整轮廓", "半轮廓"][Number(s.outlineMode)] || "无轮廓";
    var out = chip("STYLE", CS.STYLE_NAMES[s.style] || s.style) +
      chip("GAP", s.gap + "px") + chip("LENGTH", s.length + "px") + chip("THK", s.thickness + "px") +
      chip("RGBA", s.red + "," + s.green + "," + s.blue + "," + s.alpha) +
      chip("描边", mode) +
      (s.followRecoil ? chip("RECOIL", "开") : "") +
      (s.centerDotEnabled ? chip("DOT", "开") : "") +
      (s.tStyleEnabled ? chip("T", "开") : "") +
      chip("镜内点", fmt(s.scopeDotScale) + "×");
    if (legacy || info.container === "legacy") out += '<span class="param-chip legacy">旧码 · 已近似转换</span>';
    return out;
  }

  // 个别选手在 prosettings 与 HLTV 的昵称写法不同，人工对齐避免「现役过滤」误杀
  var NICK_ALIAS = { "techno4k": "techno" };
  function nickKey(s) {
    s = String(s || "").toLowerCase().trim().replace(/[-_.]+$/, "");
    return NICK_ALIAS[s] || s;
  }
  // 选手在 HLTV 现役阵容里的对应条目（按昵称精确匹配，匹配不到返回 null）
  function lineupOf(p) {
    var h = p && hltvOf(p.t);
    if (!h || !h.lineup) return null;
    var nick = nickKey(p.n);
    for (var i = 0; i < h.lineup.length; i++) {
      if (nickKey(h.lineup[i].nick) === nick) return h.lineup[i];
    }
    return null;
  }
  // 现役口径：战队有 HLTV 阵容数据 → 必须在阵容内才算现役；
  // 战队没有阵容数据（HLTV 页面停更）→ 无法核验，保留不猜
  function isCurrentPlayer(p) {
    var h = p && hltvOf(p.t);
    if (!h || !h.lineup || !h.lineup.length) return true;
    return !!lineupOf(p);
  }
  /* 现役口径：HLTV 阵容（定期同步）是唯一权威 —— 必须在阵容内才算现役。
   * prosettings 的归队信息滞后于 HLTV，转会窗后库内会残留已离队选手；
   * 宁缺毋滥：某队核验后不足 5 张卡（新援尚无准星数据）就如实展示，
   * 完整权威名单见战队详情的「HLTV 当前名单」。 */
  function activePlayers() {
    return PROS.filter(isCurrentPlayer);
  }
  // 检测来源的展示文案：上游的 "Admin" 表示非比赛的官方记录
  function sourceText(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (/^admin$/i.test(s)) return "官方记录";
    return s;
  }

  function cardHTML(p, t) {
    var histTag = p.h && p.h.length ? '<span class="pc-hist" title="历史版本">×' + p.h.length + "</span>" : "";
    var edpi = p.i && p.i.edpi ? '<span class="pc-edpi">eDPI ' + esc(p.i.edpi) + "</span>" : "";
    // 旧准星（源数据早于 9.23）：可应用近似值；复制走「转换 + 差异确认」
    var legacy = playerLegacy(p);
    var pInfo = decodeInfoCached(playerCode(p));
    var dynTag = pInfo && !CS.isStaticStyle(pInfo.model.style) ? '<span class="pc-dyn">动态</span>' : "";
    var legacyTag = legacy ? '<span class="pc-legacy">旧码 · 可转换</span>' : "";
    var copyBtn = legacy
      ? '<button class="btn btn-ghost btn-sm" data-act="convert" title="复制转换后的新码，会先列出差异">转换</button>'
      : '<button class="btn btn-ghost btn-sm" data-act="copy">复制码</button>';
    return '<div class="player-card" data-pid="' + esc(p.n) + '" role="button" tabindex="0"' +
      ' aria-label="' + esc(p.n + " · " + (t ? t.n + " · " : "") + roleLabel(p) + "，打开详情") + '">' +
      '<div class="pc-xhair"><canvas></canvas></div>' +
      '<div class="pc-info">' +
      '<div class="pc-top">' +
      (t ? '<img class="pc-logo" src="' + esc(teamLogo(t)) + '" alt="" decoding="async">' : "") +
      '<span class="pc-name">' + flagImg(p.f, "pc-flag") + '<span class="pc-nick">' + esc(p.n) + "</span></span>" +
      "</div>" +
      '<div class="pc-meta"><span class="pc-role">' + esc(roleLabel(p)) + "</span>" + edpi + "</div>" +
      '<div class="pc-tags">' + dynTag + legacyTag + histTag + "</div>" +
      '<div class="pc-actions">' +
      '<button class="btn btn-primary btn-sm" data-act="apply">应用</button>' +
      copyBtn +
      "</div></div></div>";
  }

  function buildTeamList() {
    var pool = activePlayers();
    var html = '<button class="team-item' + (state.team === "" ? " active" : "") + '" data-team="">' +
      '<span class="team-cross">◎</span><span class="team-name">全部战队</span></button>';
    TEAMS.forEach(function (t) {
      var count = pool.filter(function (p) { return p.t === t.k; }).length;
      if (count === 0) {
        // 现役过滤后已无选手的战队不再出现在侧栏；若它恰好是当前选中项，退回「全部」
        if (state.team === t.k) state.team = "";
        return;
      }
      var h = hltvOf(t.k);
      var rank = h && h.ranks && h.ranks.world ? '<span class="team-rank">#' + h.ranks.world + "</span>" : "";
      html += '<button class="team-item' + (state.team === t.k ? " active" : "") + '" data-team="' + t.k + '">' +
        '<img src="' + esc(teamLogo(t, h)) + '" alt="" decoding="async">' +
        '<span class="team-name">' + esc(t.n) + "</span>" + rank + "</button>";
    });
    var list = $("teamList");
    list.innerHTML = html;
    list.querySelectorAll(".team-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.team = btn.dataset.team;
        list.querySelectorAll(".team-item").forEach(function (b) { b.classList.toggle("active", b.dataset.team === state.team); });
        renderPlayers();
        renderTeamDetail();
      });
    });
  }

  function teamName(k) { var t = teamByKey(k); return t ? t.n : k; }

  /* ---------- 战队详情 ---------- */
  // HLTV 抓下来的国旗是 30×20 GIF，缺图（如 BE）时回落到 emoji
  function hltvFlag(path, cc, cls) {
    if (path) return '<img class="' + (cls || "td-flag") + '" src="' + esc(path) + '" alt="" decoding="async">';
    return '<span class="' + (cls || "td-flag") + ' td-flag-emoji">' + flagEmoji(cc) + "</span>";
  }
  function rankText(v) { return v ? "#" + v : "—"; }

  // 选中战队时在列表上方展开资料卡：队标 / 队名 / 国家 / 排名 + 横向阵容
  // （按要求不展示社交链接、赛程战绩、档案字段与冠军荣誉，把版面留给下方准星卡片）
  function renderTeamDetail() {
    var box = $("teamDetail");
    if (!box) return;
    var t = state.team ? teamByKey(state.team) : null;
    var h = t ? hltvOf(t.k) : null;
    if (!t) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;

    var logo = esc(teamLogo(t, h));
    var name = h && h.localName ? h.localName : t.n;
    var fullName = h && h.name && h.name !== name ? h.name : "";
    var country = h && h.country ? h.country : "";
    var flag = h && h.flag ? hltvFlag(h.flag, "", "td-flag") : "";
    var ranks = (h && h.ranks) || {};

    // 顶部：队标 + 队名 + 国家 + 三个排名徽章（不展示教练，也不给 HLTV 外链）
    var head = '<div class="td-head">' +
      '<img class="td-logo" src="' + logo + '" alt="' + esc(t.n) + '" decoding="async">' +
      '<div class="td-title">' +
      '<h3 class="td-name">' + esc(name) + (fullName ? '<span class="td-sub">' + esc(fullName) + "</span>" : "") + "</h3>" +
      '<div class="td-meta">' +
      (country ? flag + "<span>" + esc(country) + "</span>" : "") +
      '<span class="td-rankline">世界 <b>' + rankText(ranks.world) + "</b>" +
      (ranks.worldRegionRank ? ' · <span class="td-rk">' + esc(ranks.worldRegion || "区域") + "</span> <b>" + rankText(ranks.worldRegionRank) + "</b>" : "") +
      ' · Valve <b>' + rankText(ranks.valve) + "</b></span>" +
      "</div></div>" +
      "</div>";

    // 阵容：横向一排（头像 + 昵称 + 真名 + 国旗），让下方准星卡片尽快露出
    var body = '<div class="td-body">';
    body += '<h4 class="td-col-head">现役阵容' +
      (h && h.lineup && h.lineup.length ? '<span class="td-col-note">HLTV 当前名单 · ' + h.lineup.length + " 人</span>" : "") +
      "</h4>";
    if (h && h.lineup && h.lineup.length) {
      body += '<ul class="td-lineup">';
      h.lineup.forEach(function (m) {
        // 参照 HLTV 的标注：昵称加粗 + 国旗紧跟昵称 + 真名小字在下。
        // 昵称过长只截断 .td-nick-name 本身，指挥徽标与国旗永远完整（不再被省略号吃掉）。
        body += '<li class="td-player" title="' + esc(m.nick + (m.real ? " · " + m.real : "")) + '">' +
          '<img class="td-avatar" src="' + esc(m.avatar) + '" alt="" decoding="async" loading="lazy">' +
          '<span class="td-player-main">' +
          '<span class="td-nick"><span class="td-nick-name">' + esc(m.nick) + "</span>" +
          (m.igl ? '<span class="td-igl">指挥</span>' : "") +
          hltvFlag(m.flag, m.country, "td-mini-flag") + "</span>" +
          '<span class="td-real">' + esc(m.real || "") + "</span></span>" +
          "</li>";
      });
      body += "</ul>";
    } else {
      body += '<p class="td-empty">HLTV 暂无现役阵容记录（该队页已停更）。</p>';
    }
    body += "</div>"; // td-body

    var foot = '<div class="td-foot">队名 / 队标 / 阵容 / 排名来自 <b>HLTV.org</b>（快照 ' +
      esc(hltvStamp() || "—") + "） · 准星与分享码来自 prosettings.net</div>";

    box.innerHTML = head + body + foot;
  }

  // 排序：默认（战队原始顺序）/ 姓名 / eDPI / 战队
  function sortPlayers(list) {
    var a = list.slice();
    if (state.sort === "name") {
      a.sort(function (x, y) { return x.n.toLowerCase() < y.n.toLowerCase() ? -1 : 1; });
    } else if (state.sort === "edpi") {
      a.sort(function (x, y) {
        var vx = Number(x.i && x.i.edpi), vy = Number(y.i && y.i.edpi);
        if (!isFinite(vx)) vx = Infinity;
        if (!isFinite(vy)) vy = Infinity;
        return vx - vy;
      });
    } else if (state.sort === "team") {
      a.sort(function (x, y) {
        var tx = teamName(x.t), ty = teamName(y.t);
        if (tx !== ty) return tx < ty ? -1 : 1;
        return x.n.toLowerCase() < y.n.toLowerCase() ? -1 : 1;
      });
    }
    return a;
  }

  // 三个筛选维度是「与」关系：位置 × 战队 × 搜索词（此前搜索会顶掉战队条件、位置只认单一 r 字段）
  // 底池先过「现役」：战队有 HLTV 阵容但人不在其中的选手不参与展示
  function visiblePlayers() {
    var q = $("proSearch").value.trim().toLowerCase();
    var list = activePlayers().filter(function (p) {
      if (state.role && rolesOf(p).indexOf(state.role) === -1) return false;
      if (state.team && p.t !== state.team) return false;
      if (q) {
        var hay = p.n.toLowerCase() + " " +
          String((p.i && p.i.real) || "").toLowerCase() + " " +
          String(teamName(p.t)).toLowerCase();
        return hay.indexOf(q) !== -1;
      }
      return true;
    });
    return sortPlayers(list);
  }

  // 选手库头部统计
  function dataStamp() {
    if (!META.updated) return "未知";
    var d = new Date(META.updated);
    if (isNaN(d.getTime())) return String(META.updated).slice(0, 16);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function renderProsStats() {
    var el = $("prosStats");
    if (!el) return;
    var pool = activePlayers();
    var teamN = TEAMS.filter(function (t) {
      return pool.some(function (p) { return p.t === t.k; });
    }).length;
    var stat = function (v, k) { return '<div class="ps-item"><b>' + v + "</b><span>" + k + "</span></div>"; };
    el.innerHTML = stat(teamN, "战队") + stat(pool.length, "现役选手");
  }

  function renderPlayers() {
    var list = visiblePlayers();
    var q = $("proSearch").value.trim().toLowerCase();
    $("playersCount").textContent = list.length + " 位选手";
    renderTeamDetail();
    var grid = $("proGrid");

    if (!list.length) {
      var active = [];
      if (q) active.push("搜索「" + esc(q) + "」");
      if (state.team) active.push("战队「" + esc(teamName(state.team)) + "」");
      if (state.role) active.push("位置「" + esc(roleZh(state.role)) + "」");
      grid.innerHTML = '<div class="empty-state"><div class="big">◎</div>没有找到选手' +
        (active.length ? '<div class="es-cond">当前条件：' + active.join(" · ") + "</div>" : "") +
        (active.length ? '<button class="btn btn-ghost btn-sm es-reset" data-act="reset-filters">清除筛选条件</button>' : "") +
        "</div>";
      return;
    }

    // 有搜索 / 战队 / 位置筛选或非默认排序时平铺展示，顺序变化立即可见
    var flat = q || state.team || state.role || state.sort !== "default";
    var html = "";
    if (flat) {
      html = '<div class="team-group open" style="background:transparent;border:none">' +
        '<div class="team-group-body players-flat">';
      list.forEach(function (p) { html += cardHTML(p, teamByKey(p.t)); });
      html += "</div></div>";
    } else {
      TEAMS.forEach(function (t, idx) {
        var members = list.filter(function (p) { return p.t === t.k; });
        if (!members.length) return;
        var open = !state.collapsed[t.k] && idx < 6;
        html += '<div class="team-group' + (open ? " open" : "") + '" data-tg="' + t.k + '">' +
          '<div class="team-group-head" role="button" tabindex="0" aria-expanded="' + (open ? "true" : "false") + '">' +
          '<img src="' + esc(teamLogo(t)) + '" alt="" decoding="async">' +
          '<span class="tg-name">' + esc(t.n) + '</span>' +
          '<span class="tg-count">' + members.length + '</span>' +
          '<span class="tg-rank">' + (function () { var h = hltvOf(t.k); return h && h.ranks && h.ranks.world ? "#" + h.ranks.world : ""; })() + '</span>' +
          '<span class="tg-arrow">▾</span></div>' +
          '<div class="team-group-body">';
        members.forEach(function (p) { html += cardHTML(p, t); });
        html += "</div></div>";
      });
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".team-group-head").forEach(function (head) {
      head.addEventListener("click", function () {
        var group = head.closest(".team-group");
        var k = group.dataset.tg;
        group.classList.toggle("open");
        var open = group.classList.contains("open");
        head.setAttribute("aria-expanded", open ? "true" : "false");
        if (k) state.collapsed[k] = !open;
      });
    });

    paintCardCanvases(grid);
  }

  // 官方像素渲染：按该选手自己的制作屏幕高度 1:1 绘制，不放大。
  // 画布边长跟着 .pc-xhair 的实际高度走：宽屏容器 112px → 画布 104px（四周各留 4px 呼吸）；
  // ≤760px 容器收到 100px → 画布 92px。若写死 104px，窄屏画布会比容器高、底部被
  // .player-card 的 overflow:hidden 裁掉一截。
  function cardCanvasSide(wrap) {
    var box = wrap ? Math.round(wrap.getBoundingClientRect().height) : 0;
    if (!box) return CARD_XHAIR;
    return Math.max(40, Math.min(CARD_XHAIR, box - 8));
  }

  function paintCardCanvases(root) {
    (root || $("proGrid")).querySelectorAll(".player-card").forEach(function (card) {
      var p = PROS.find(function (x) { return x.n === card.dataset.pid; });
      var cv = card.querySelector("canvas");
      if (!p || !cv) return;
      var info = decodeInfoCached(playerCode(p));
      if (!info) return;
      var side = cardCanvasSide(card.querySelector(".pc-xhair"));
      paint(cv, info.model, side, side, 1, false, { viewHeight: info.model.screenHeight });
    });
  }

  function bindProGrid() {
    // 键盘可达：卡片 / 分组头都是 tabindex=0 的 role=button，Enter 与 Space 等价于点击
    $("proGrid").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var target = e.target.closest(".player-card, .team-group-head");
      if (!target) return;
      e.preventDefault();
      target.click();
    });
    $("proGrid").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      // 空结果的「清除筛选」在卡片之外，先处理
      if (btn && btn.dataset.act === "reset-filters") {
        $("proSearch").value = "";
        state.role = "";
        state.team = "";
        if ($("proRole")) $("proRole").value = "";
        var tl = $("teamList");
        if (tl) tl.querySelectorAll(".team-item").forEach(function (b) { b.classList.toggle("active", b.dataset.team === ""); });
        renderPlayers();
        return;
      }
      var card = e.target.closest(".player-card");
      if (!card) return;
      var p = PROS.find(function (x) { return x.n === card.dataset.pid; });
      if (!p) return;
      if (btn && btn.disabled) return;
      if (btn && btn.dataset.act === "apply") {
        var info = decodeInfoCached(playerCode(p));
        if (info && applySettings(info.model, true, playerCode(p), info)) toast("已应用 " + p.n + " 的准星");
      } else if (btn && btn.dataset.act === "copy") {
        copyText(playerCode(p), p.n + " 的分享码已复制", btn);
      } else if (btn && btn.dataset.act === "convert") {
        openConvertDialog({
          code: playerCode(p),
          orig: p.c || playerCode(p),
          height: resHeight(p),
        });
      } else {
        openModal(p);
      }
    });
    $("proSearch").addEventListener("input", renderPlayers);
    $("proRole").addEventListener("change", function () { state.role = this.value; renderPlayers(); });
    $("proSort").addEventListener("change", function () { state.sort = this.value; renderPlayers(); });
  }

  /* ---------------- 弹窗 ---------------- */
  function chip(k, v) {
    var display = (typeof v === "number") ? esc(String(fmt(v))) : esc(String(v));
    return '<span class="param-chip"><b>' + k + "</b> " + display + "</span>";
  }

  // Viewmodel / 雷达设置 → 控制台指令(单行分号分隔,与 prosettings 一致,可直接粘贴)
  function vmCommands(vm) {
    if (!vm) return "";
    var p = [];
    var add = function (k, v) { if (v !== "" && v != null) p.push(k + " " + v); };
    add("viewmodel_fov", vm.fov); add("viewmodel_offset_x", vm.ox);
    add("viewmodel_offset_y", vm.oy); add("viewmodel_offset_z", vm.oz);
    add("viewmodel_presetpos", vm.preset);
    return p.join("; ") + (p.length ? ";" : "");
  }
  function radarCommands(rd) {
    if (!rd) return "";
    var p = [];
    var add = function (k, v) { if (v !== "" && v != null) p.push(k + " " + v); };
    add("cl_radar_always_centered", rd.centered); add("cl_radar_rotate", rd.rotate);
    add("cl_radar_square_with_scoreboard", rd.square); add("cl_radar_hud_scale", rd.hudScale);
    add("cl_radar_scale", rd.scale); add("hud_scaling", rd.hudScaling);
    return p.join("; ") + (p.length ? ";" : "");
  }

  /* 选手详情分组：顺序对齐任务书 / prosettings.net 选手页维度
   *   鼠标 → 显示器 → 外设(Gear) → Viewmodel → 雷达 / HUD → 视频画面 →（准星在准星页签）
   * 型号行来自 players.js 的 i.gear（prosettings Equipment 区抓取的实机型号）；
   * 数据源里没有鼠标垫以外的虚构字段，绝不虚构数据行。
   * 任何分组只要一条有效数据都没有，整块不渲染。
   */
  var DATA_GROUPS = [
    { key: "mouse", icon: "🖱", name: "鼠标", rows: [
      ["型号", function (i) { return i.gear && i.gear.mouse; }, "md-item--wide"],
      ["DPI", function (i) { return i.dpi; }],
      ["灵敏度", function (i) { return i.sens; }],
      ["eDPI", function (i) { return i.edpi; }],
      ["缩放灵敏度", function (i) { return i.zoom; }],
      ["回报率", function (i) { return i.hz ? i.hz + " Hz" : ""; }],
      ["Windows 灵敏度", function (i, ex) { return ex.winSens; }],
    ] },
    { key: "monitor", icon: "🖥", name: "显示器", rows: [
      ["型号", function (i) { return i.gear && i.gear.monitor; }, "md-item--wide"],
      ["分辨率", function (i) { return i.res; }],
      ["纵横比", function (i) { return i.aspect; }],
      ["缩放模式", function (i) { return i.scaling; }],
      ["刷新率", function (i) { return i.refresh ? i.refresh + " Hz" : ""; }],
      ["面板", function (i, ex) { return ex.panel; }],
      ["DyAc", function (i, ex) { return ex.dyac; }],
      ["Black eQualizer", function (i, ex) { return ex.blackEq; }],
      ["色彩饱和度", function (i, ex) { return ex.vibrance; }],
      ["低蓝光", function (i, ex) { return ex.lowBlue; }],
      ["图像模式", function (i, ex) { return ex.pictureMode; }],
      ["对比度", function (i, ex) { return ex.contrast; }],
      ["锐度", function (i, ex) { return ex.sharpness; }],
      ["Gamma", function (i, ex) { return ex.gamma; }],
      ["色温", function (i, ex) { return ex.colorTemp; }],
      ["AMA", function (i, ex) { return ex.ama; }],
      ["数字振动", function (i, ex) { return ex.digitalVibrance; }],
    ] },
    { key: "gear", icon: "🎮", name: "外设", rows: [
      ["键盘", function (i) { return i.gear && i.gear.keyboard; }, "md-item--wide"],
      ["耳机", function (i) { return i.gear && i.gear.headset; }, "md-item--wide"],
      ["鼠标垫", function (i) { return i.gear && i.gear.mousepad; }, "md-item--wide"],
      ["传感器", function (i, ex) { return ex.sensor; }],
      ["握持形状", function (i, ex) { return ex.shape; }],
      ["重量", function (i, ex) { return ex.weight; }],
      ["连接方式", function (i, ex) { return ex.connection; }],
      ["左键触发点", function (i, ex) { return ex.actL; }],
      ["右键触发点", function (i, ex) { return ex.actR; }],
      ["左键 Rapid Trigger", function (i, ex) { return ex.rtL; }],
      ["右键 Rapid Trigger", function (i, ex) { return ex.rtR; }],
      ["左键点击反馈", function (i, ex) { return ex.cfL; }],
      ["右键点击反馈", function (i, ex) { return ex.cfR; }],
      ["抬起高度", function (i, ex) { return ex.lod; }],
      ["BHOP 模式", function (i, ex) { return ex.bhop; }],
    ] },
    { key: "viewmodel", icon: "🖐", name: "Viewmodel", cmd: "vm", rows: [
      ["FOV", function (i, ex, vm) { return vm.fov; }],
      ["Offset X", function (i, ex, vm) { return vm.ox; }],
      ["Offset Y", function (i, ex, vm) { return vm.oy; }],
      ["Offset Z", function (i, ex, vm) { return vm.oz; }],
      ["Presetpos", function (i, ex, vm) { return vm.preset; }],
    ] },
    { key: "radar", icon: "📡", name: "雷达 / HUD", cmd: "radar", rows: [
      ["雷达缩放", function (i, ex, vm, rd) { return rd.scale; }],
      ["HUD 缩放", function (i, ex, vm, rd) { return rd.hudScale; }],
      ["雷达居中", function (i, ex, vm, rd) { return rd.centered; }],
      ["雷达旋转", function (i, ex, vm, rd) { return rd.rotate; }],
      ["计分板方形雷达", function (i, ex, vm, rd) { return rd.square; }],
      ["HUD 颜色", function (i, ex, vm, rd) { return rd.hudColor; }],
    ] },
    { key: "video", icon: "🎬", name: "视频画面", rows: [
      ["亮度", function (i, ex) { return ex.brightness; }],
      ["显示模式", function (i, ex) { return ex.displayMode; }],
      ["增强玩家对比度", function (i, ex) { return ex.boostContrast; }],
      ["垂直同步", function (i, ex) { return ex.vsync; }],
      ["NVIDIA Reflex", function (i, ex) { return ex.reflex; }],
      ["最大 FPS", function (i, ex) { return ex.maxFps; }],
      ["阴影质量", function (i, ex) { return ex.shadowQuality; }],
      ["动态阴影", function (i, ex) { return ex.dynamicShadows; }],
      ["模型/贴图细节", function (i, ex) { return ex.textureDetail; }],
      ["贴图过滤", function (i, ex) { return ex.textureFiltering; }],
      ["着色器细节", function (i, ex) { return ex.shaderDetail; }],
      ["粒子细节", function (i, ex) { return ex.particleDetail; }],
      ["环境光遮蔽", function (i, ex) { return ex.ao; }],
      ["HDR", function (i, ex) { return ex.hdr; }],
      ["FidelityFX FSR", function (i, ex) { return ex.fsr; }],
    ] },
  ];

  function buildDataGroups(i) {
    var ex = i.extra || {};
    var vm = i.vm || {};
    var rd = i.radar || {};
    var html = "";
    DATA_GROUPS.forEach(function (g) {
      var rows = [];
      g.rows.forEach(function (r) {
        var v = r[1](i, ex, vm, rd);
        if (v === undefined || v === null || v === "") return;
        // 行可带第三位的修饰类：型号名等长文本走 md-item--wide（整行 + 可换行），保证完整可读
        rows.push(r[2] ? [r[0], v, r[2]] : [r[0], v]);
      });
      var cmd = g.cmd === "vm" ? vmCommands(i.vm) : g.cmd === "radar" ? radarCommands(i.radar) : "";
      if (!rows.length && !cmd) return; // 没有数据的分组整块不渲染
      html += '<div class="md-group" data-group="' + g.key + '">' + mdHead(g.icon, g.name, cmd ? g.cmd : "") +
        mdGrid(rows) +
        (cmd ? '<div class="md-cmdbox" data-cmd="' + g.cmd + '" title="点击复制">' + esc(cmd) + "</div>" : "") +
        "</div>";
    });
    return html;
  }

  /* ---------------- 准星库：新旧准星规则 ----------------
   * 判定依据是「源数据时代」（不是迁移后格式）：
   *   m.from 以 legacy 开头 / 老数据的 legacy 容器 → 旧准星（源数据早于 9.23）：
   *     双轨：应用/预览始终可用；复制转换码先弹差异确认；原码单独折叠存档
   *     （旧码被游戏拒绝导入，转换只是近似）
   *   cs2 新格式源数据 → 新准星：四项功能全开
   * 历史版本逐条按采集时记录的 lg 标记（prosettings history API 的 legacy 字段）判定。
   */
  var LEGACY_REASON = "旧格式码（源数据早于 2026-09-23）已被游戏拒绝导入。" +
    "下面复制的码与命令都是按参考分辨率换算出的新值，转换前会列出差异；原始码仅保留作存档。";

  function libButton(act, code, label, cls, dis, tip, lg, orig) {
    return '<button class="' + cls + '" data-lib="' + act + '" data-code="' + esc(code) + '"' +
      (orig ? ' data-orig="' + esc(orig) + '"' : "") +
      (lg ? ' data-lg="1"' : "") + (dis ? " disabled" : "") + (tip || "") + ">" + label + "</button>";
  }

  function libActionsHTML(code, info, legacy, opts) {
    if (legacy == null) legacy = !!info && info.container === "legacy";
    opts = opts || {};
    var orig = opts.origCode || (legacy ? code : "");
    // omitCode：「复制分享码」由调用方单独渲染在主演区（弹窗里与「应用到生成器」并排），
    // 这里只出剩下的次要动作，避免同屏出现两个主按钮。
    var wrap = '<div class="lib-actions' + (opts.omitCode ? " lib-actions-sub" : "") + '">';
    if (legacy) {
      var tip = ' title="旧码已被游戏拒绝导入；复制的是转换后的新码，会先列出差异"';
      return wrap +
        (opts.omitCode ? "" : libButton("code", code, "复制转换码", "btn btn-primary btn-sm", false, tip, true, orig)) +
        libButton("cmd", code, "复制命令", "btn btn-ghost btn-sm", false, tip, true, orig) +
        "</div>" +
        '<div class="lib-reason">' + esc(LEGACY_REASON) + "</div>" +
        (orig ? '<details class="orig-code"><summary>原始码（游戏已不支持导入）</summary>' +
          '<div class="orig-code-row"><code>' + esc(orig) + "</code>" +
          libButton("orig", orig, "复制原码", "btn btn-ghost btn-sm", false, "", false, "") +
          "</div></details>" : "");
    }
    return wrap +
      (opts.omitCode ? "" : libButton("code", code, "复制分享码", "btn btn-primary btn-sm", false, "", false, "")) +
      libButton("cmd", code, "复制控制台命令", "btn btn-ghost btn-sm", false, "", false, "") +
      "</div>";
  }

  function histActionsHTML(code, info, legacy, opts) {
    if (legacy == null) legacy = !!info && info.container === "legacy";
    opts = opts || {};
    var orig = opts.origCode || (legacy ? code : "");
    return '<div class="h-actions">' +
      '<button class="btn btn-primary btn-sm" data-ha="apply">应用</button>' +
      (legacy
        ? libButton("code", code, "转换", "btn btn-ghost btn-sm", false,
            ' title="复制转换后的新码，会先列出差异"', true, orig)
        : libButton("code", code, "复制", "btn btn-ghost btn-sm", false, "", false, "")) +
      "</div>";
  }

  function libLegacy(btn, info) {
    return btn.dataset.lg === "1" || (btn.dataset.lg == null && !!info && info.container === "legacy");
  }

  /* 旧码双轨：应用/预览始终可用；复制转换码先弹差异确认；原码单独存档复制。 */
  var convertState = null;

  function openConvertDialog(o) {
    var h = Math.max(240, Number(o.height) || 1080);
    var orig = String(o.orig || o.code || "");
    var info = decodeInfoCached(o.code, { screenHeight: h });
    if (!info) { toast("无法解析该分享码", false); return; }
    if (info.container === "cs2" && info.model.screenHeight) h = info.model.screenHeight;
    var newCode = info.container === "cs2" ? String(o.code) : CS.encodeShareCode(info.model);
    if (!/^CS[0-9A-Za-z]{44}$/.test(newCode)) { toast("转换失败：未生成有效新码", false); return; }
    var origInfo = decodeInfoCached(orig, { screenHeight: h });
    var lossy = !!(origInfo && origInfo.migration && origInfo.migration.lossy);
    var notes = (origInfo && origInfo.migration && origInfo.migration.notes) || [];
    var diffCount = notes.length;
    if (!notes.length) notes = [lossy
      ? "已完成像素换算，未发现需要特别说明的差异；仍建议在游戏内确认视觉效果。"
      : "字段直搬，无已知换算差异；仍建议在游戏内确认视觉效果。"];
    convertState = { newCode: newCode, count: diffCount, trigger: document.activeElement };
    $("cvMeta").innerHTML = "<span>原格式 " + esc(origInfo ? origInfo.format : "legacy") + "</span>" +
      " <span>参考高度 " + h + "p</span> <span>目标 cs2-v1</span> <span>" + (lossy ? "有损换算" : "字段直搬") + "</span>";
    $("cvDiff").innerHTML = notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
    $("cvCode").textContent = newCode;
    $("cvOrig").textContent = orig;
    $("convertModal").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { $("cvConfirm").focus(); }, 20);
  }

  function closeConvertDialog() {
    $("convertModal").hidden = true;
    if ($("playerModal").hidden) document.body.style.overflow = "";
    if (convertState && convertState.trigger && convertState.trigger.focus) convertState.trigger.focus();
    convertState = null;
  }

  function confirmConvert() {
    if (!convertState) return;
    var n = convertState.count;
    var code = convertState.newCode;
    closeConvertDialog();
    copyText(code, "已复制转换码（非选手原码）" +
      (n ? " · 差异 " + n + " 项" : " · 无已知差异"));
  }

  // 库内动作统一处理：复制（转换）码 / 命令 / 原始码
  function handleLibAction(btn) {
    var code = btn.dataset.code;
    var act = btn.dataset.lib;
    if (act === "orig") { copyText(btn.dataset.orig || code, "原始码已复制 · 游戏已不支持导入，仅供存档", btn); return; }
    var h = Number(btn.dataset.h) || resHeight(state.current) || 1080;
    var info = decodeInfoCached(code, { screenHeight: h });
    if (!info) return;
    var lg = libLegacy(btn, info);
    var orig = btn.dataset.orig || (lg ? code : "");
    if (act === "code") {
      if (lg) { openConvertDialog({ code: code, orig: orig, height: h }); return; }
      copyText(code, "分享码已复制 · 粘进游戏「导入准星」即可", btn);
    } else if (act === "cmd") {
      var chunks = CS.settingsToPasteChunks(info.model);
      if (!chunks.length) return;
      copyText(chunks[0], chunks.length > 1
        ? "命令共 " + chunks.length + " 段，已复制第 1 段，粘贴后复制下一段"
        : (lg ? "近似换算命令已复制 · " : "控制台命令已复制 · ") + chunks[0].length + " 字符", btn);
    }
  }

  function mdHead(icon, text, cmdKey) {
    var btn = cmdKey ? '<button class="md-copy" data-cmd="' + cmdKey + '">Copy ⧉</button>' : "";
    return '<div class="md-head"><span class="md-icon">' + icon + '</span><span class="md-name">' + text + "</span>" + btn + "</div>";
  }
  function mdGrid(items) {
    var out = '<div class="md-grid">';
    for (var i = 0; i < items.length; i++) {
      if (items[i][1] === "" || items[i][1] == null) continue;
      var cls = items[i][2] ? ' class="md-item ' + items[i][2] + '"' : ' class="md-item"';
      out += "<div" + cls + "><span>" + items[i][0] + "</span><b>" + esc(items[i][1]) + "</b></div>";
    }
    return out + "</div>";
  }

  /* 详情页动态预览：动态样式才显示播放按钮，播两轮后自动停在静止态。 */
  var modalDynRaf = 0;
  function stopModalDyn() {
    caf(modalDynRaf);
    modalDynRaf = 0;
    var btn = $("mDynPlay");
    if (btn) {
      btn.classList.remove("playing");
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function playModalDyn() {
    var info = decodeInfoCached(state.currentCode);
    var host = $("mPreview");
    var cv = host && host.querySelector("canvas");
    var btn = $("mDynPlay");
    if (!info || !cv) return;
    if (modalDynRaf) { stopModalDyn(); paint(cv, info.model, MODAL_XHAIR, MODAL_XHAIR, 1, false, { viewHeight: info.model.screenHeight }); return; }
    if (btn) { btn.classList.add("playing"); btn.setAttribute("aria-pressed", "true"); }
    var t0 = nowMs();
    function frame() {
      var elapsed = nowMs() - t0;
      if (elapsed > 4800 || $("playerModal").hidden) {
        stopModalDyn();
        paint(cv, info.model, MODAL_XHAIR, MODAL_XHAIR, 1, false, { viewHeight: info.model.screenHeight });
        return;
      }
      var phase = elapsed % DYN_CYCLE_MS;
      var firing = phase < DYN_FIRE_MS;
      var spread = firing
        ? Math.min(1, phase / 260)
        : Math.max(0, 1 - (phase - DYN_FIRE_MS) / 460);
      paint(cv, info.model, MODAL_XHAIR, MODAL_XHAIR, 1, firing, {
        viewHeight: info.model.screenHeight,
        spread01: spread,
        split01: firing ? 1 : spread,
        climb01: (firing && info.model.followRecoil) ? spread : 0,
      });
      modalDynRaf = raf(frame);
    }
    frame();
  }

  /* 弹窗主演区第二个按钮：与「应用到生成器」并排，视觉上是次要动作（ghost）。
     旧码时它就是「复制转换码」，点击仍走 openConvertDialog 的差异确认。 */
  function syncModalCopyCode(code, legacy, orig) {
    var btn = $("mCopyCode");
    if (!btn) return;
    btn.textContent = legacy ? "复制转换码" : "复制分享码";
    btn.className = "btn btn-ghost";
    btn.dataset.lib = "code";
    btn.dataset.code = code;
    if (legacy) {
      btn.dataset.lg = "1";
      btn.dataset.orig = orig || "";
      btn.title = "旧码已被游戏拒绝导入；复制的是转换后的新码，会先列出差异";
    } else {
      delete btn.dataset.lg;
      delete btn.dataset.orig;
      btn.title = "";
    }
  }

  function openModal(p) {
    state.current = p;
    state.currentCode = playerCode(p);
    var t = teamByKey(p.t);
    var country = (p.i && p.i.country) || "";
    $("mName").innerHTML = flagImg(p.f, "m-flag") + " " + esc(p.n);
    var th = t ? hltvOf(t.k) : null;
    $("mMeta").innerHTML = (t ? '<img src="' + esc(teamLogo(t, th)) + '" alt="">' : "") + (t ? esc(t.n) : "—") +
      " · " + esc(roleLabel(p)) + (country ? " · " + esc(country) : "");
    $("mTeamLogo").src = t ? teamLogo(t, th) : "";
    // 选手照片：HLTV 阵容快照里带 avatar（与战队详情卡的 .td-avatar 同源）
    var face = $("mPlayerFace");
    if (face) {
      var lu = lineupOf(p);
      var src = lu && lu.avatar ? lu.avatar : "";
      if (src) { face.src = src; face.hidden = false; }
      else { face.removeAttribute("src"); face.hidden = true; }
    }
    var info = decodeInfoCached(state.currentCode);
    var legacy = playerLegacy(p);
    $("mCode").innerHTML = esc(state.currentCode) + (legacy ? ' <span class="code-tag warn">旧码 · 已近似转换</span>' : "");
    $("mCode").title = state.currentCode;
    $("mParams").innerHTML = chipsFor(info, legacy);
    $("mKind").textContent = legacy ? "旧准星 · 可转换" : "新准星 · 完整功能";
    $("mKind").className = "m-kind " + (legacy ? "warn" : "ok");
    $("mActions").innerHTML = libActionsHTML(state.currentCode, info, legacy,
      { origCode: legacy ? (p.c || "") : "", height: resHeight(p), omitCode: true });
    syncModalCopyCode(state.currentCode, legacy, legacy ? (p.c || "") : "");

    // 选手设置：按任务书维度顺序（鼠标 → 显示器 → 外设 → Viewmodel → 雷达/HUD → 视频画面）
    var i = p.i || {};
    $("mData").innerHTML = buildDataGroups(i);
    state.vmCmd = vmCommands(i.vm);
    state.radarCmd = radarCommands(i.radar);
    var src = $("mSource");
    if (p.u) { src.href = p.u; src.style.display = ""; } else { src.style.display = "none"; }

    // 历史版本：把「当前最新准星」也作为第一条并进来，按同一套新旧规则渲染
    var hist = (p.h || []).slice(0, 11);
    var hOpts = { screenHeight: resHeight(p) };
    var html = "";
    var curCode = state.currentCode;
    // 当前准星的检测来源：优先用采集侧记的 cs（与当前码相同的那条历史），
    // 老数据没有 cs 时回落用最新一条历史近似
    var cs = p.cs || null;
    var csDate = String((cs && cs.d) || (hist[0] && hist[0].d) || "").slice(0, 10);
    var csFrom = sourceText(cs && cs.s ? cs.s : (hist[0] && hist[0].s));
    var curDate = csDate || String(dataStamp()).slice(0, 10);
    var curSource = "正在使用" +
      (csDate ? " · " + csDate : "") +
      (csFrom ? " · " + csFrom : "") +
      (!csDate && !csFrom ? " · 最新检测" : "");
    html += '<div class="hist-entry is-current" data-code="' + esc(curCode) + '" data-current="1">' +
      '<div class="h-preview"><canvas></canvas></div>' +
      '<div class="h-info">' +
      '<div class="h-date">' + esc(curDate) + ' <span class="h-now">当前</span>' +
      '<span class="h-fmt' + (legacy ? " legacy" : "") + '">' + (legacy ? "旧" : "新") + "</span></div>" +
      '<div class="h-source">' + esc(curSource) + "</div>" +
      '<div class="h-code">' + esc(curCode) + "</div></div>" +
      histActionsHTML(curCode, info, legacy,
        { origCode: legacy ? (p.c || "") : "", height: resHeight(p) }) +
      "</div>";
    hist.forEach(function (h) {
      if (!h || !h.c) return;
      // 历史版本同样按「源数据时代」判定新旧（API 的 legacy 标记优先）：旧码走「转换 + 差异确认」
      var hi = decodeInfoCached(h.c, hOpts);
      var hlg = histLegacy(h, hi);
      html += '<div class="hist-entry" data-code="' + esc(h.c) + '"' + (hlg ? ' data-lg="1"' : "") + ">" +
        '<div class="h-preview"><canvas></canvas></div>' +
        '<div class="h-info">' +
        '<div class="h-date">' + esc((h.d || "").slice(0, 10)) + (h.n > 1 ? ' <span class="h-seen">×' + h.n + "</span>" : "") +
        ' <span class="h-fmt' + (hlg ? " legacy" : "") + '">' + (hlg ? "旧" : "新") + "</span></div>" +
        '<div class="h-source">' + esc(sourceText(h.s)) + "</div>" +
        '<div class="h-code">' + esc(h.c) + "</div></div>" +
        histActionsHTML(h.c, hi, hlg, { origCode: h.c, height: resHeight(p) }) +
        "</div>";
    });
    $("mHistoryList").innerHTML = html;
    state.modalOpener = document.activeElement;
    $("playerModal").hidden = false;
    document.body.style.overflow = "hidden";
    switchModalTab("xhair");
    // 打开后把焦点送进对话框，键盘用户不需要再从页面顶部 Tab 一遍
    var closeBtn = $("modalClose");
    if (closeBtn) closeBtn.focus({ preventScroll: true });

    stopModalDyn();
    if (info) {
      var mainCv = $("mPreviewCanvas");
      if (mainCv) paint(mainCv, info.model, MODAL_XHAIR, MODAL_XHAIR, 1, false, { viewHeight: info.model.screenHeight });
      var dynBtn = $("mDynPlay");
      if (dynBtn) dynBtn.hidden = CS.isStaticStyle(info.model.style);
    }
    $("mHistoryList").querySelectorAll(".hist-entry").forEach(function (entry) {
      var hs = decodeInfoCached(entry.dataset.code, { screenHeight: resHeight(p) });
      if (hs) {
        var hcv = entry.querySelector("canvas");
        if (hcv) paint(hcv, hs.model, HIST_XHAIR, HIST_XHAIR, 1, false, { viewHeight: hs.model.screenHeight });
      }
    });
  }

  function closeModal() {
    stopModalDyn();
    if (!$("convertModal").hidden) { $("convertModal").hidden = true; convertState = null; }
    $("playerModal").hidden = true;
    document.body.style.overflow = "";
    var opener = state.modalOpener;
    state.modalOpener = null;
    if (opener && document.contains(opener) && typeof opener.focus === "function") {
      opener.focus({ preventScroll: true });
    }
  }

  // 弹窗内页签:准星 / 选手信息
  function switchModalTab(name) {
    document.querySelectorAll("#modalTabs button").forEach(function (b) {
      var on = b.dataset.mtab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    $("mtab-xhair").hidden = name !== "xhair";
    $("mtab-info").hidden = name !== "info";
    if (name !== "xhair") stopModalDyn();
  }

  function bindModal() {
    $("modalClose").addEventListener("click", closeModal);
    $("playerModal").addEventListener("click", function (e) { if (e.target === $("playerModal")) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && (!$("playerModal").hidden || !$("cpDialog").hidden)) {
        // 焦点陷阱：Tab / Shift+Tab 只在当前对话框内部循环
        var scope = !$("cpDialog").hidden ? $("cpDialog") : (!$("convertModal").hidden ? $("convertModal") : $("playerModal"));
        var focusables = Array.prototype.filter.call(
          scope.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
          function (el) { return el.offsetParent !== null || el === document.activeElement; }
        );
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) {
          e.preventDefault(); last.focus({ preventScroll: true });
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus({ preventScroll: true });
        }
        return;
      }
      if (e.key !== "Escape") return;
      if (!$("cpDialog").hidden) { closeColorDialog(true); return; }
      if (!$("convertModal").hidden) { closeConvertDialog(); return; }
      closeModal();
    });
    $("cvClose").addEventListener("click", closeConvertDialog);
    $("cvCancel").addEventListener("click", closeConvertDialog);
    $("cvConfirm").addEventListener("click", confirmConvert);
    $("convertModal").addEventListener("click", function (e) {
      if (e.target === $("convertModal")) closeConvertDialog();
    });
    // 页签切换（含 ← → 键盘惯例）
    document.querySelectorAll("#modalTabs button").forEach(function (b) {
      b.addEventListener("click", function () { switchModalTab(b.dataset.mtab); });
    });
    $("modalTabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var tabs = [].slice.call(document.querySelectorAll("#modalTabs button"));
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      switchModalTab(next.dataset.mtab);
      next.focus({ preventScroll: true });
    });
    if ($("mDynPlay")) $("mDynPlay").addEventListener("click", playModalDyn);
    // Viewmodel / 雷达指令一键复制
    $("mData").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cmd]");
      if (!btn) return;
      if (btn.dataset.cmd === "vm" && state.vmCmd) copyText(state.vmCmd, "Viewmodel 指令已复制");
      if (btn.dataset.cmd === "radar" && state.radarCmd) copyText(state.radarCmd, "雷达设置指令已复制");
    });
    // 库动作：复制分享码 / 复制命令（新旧规则由按钮 disabled 表达）
    $("playerModal").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-lib]");
      if (!btn || btn.disabled) return;
      handleLibAction(btn);
    });
    $("mApply").addEventListener("click", function () {
      if (!state.currentCode) return;
      var info = decodeInfoCached(state.currentCode);
      if (info && applySettings(info.model, true, state.currentCode, info)) {
        closeModal();
        toast("已应用到生成器");
      }
    });
    $("mHistoryList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-ha]");
      if (!btn || btn.disabled) return;
      var entry = btn.closest(".hist-entry");
      var code = entry.dataset.code;
      var info = decodeInfoCached(code, { screenHeight: resHeight(state.current) });
      if (info && applySettings(info.model, true, code, info)) { closeModal(); toast("已应用历史版本"); }
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 首次加载：制作高度 = 用户实际屏幕高度（拿不到就 1080），预览与之 1:1
    state.settings = defaultSettings();
    state.settings.screenHeight = userScreenHeight();
    bindChrome();
    bindGenerator();
    renderBackground();
    renderImportKind();
    var fromUrl = readHash();
    var imported = fromUrl ? importCode(fromUrl, true) : false;
    applySettingsToUI();
    if (!imported) { state.pristineCode = null; updateAll(); }
    buildTeamList();
    renderProsStats();
    renderPlayers();
    bindProGrid();
    bindModal();
    switchView("generator");
    var foot = $("footerNote");
    if (foot) {
      foot.textContent = "准星与分享码 prosettings.net（" + (META.updated ? String(META.updated).slice(0, 10) : "—") +
        "） · 阵容与排名来自 HLTV.org 快照（" + (hltvStamp() || "—") + "）";
    }
    if (imported) toast("已从链接导入准星");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
