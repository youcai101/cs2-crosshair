/* 真实 DOM 环境下的整页回归测试（jsdom）· 2026 新版准星系统 UI
 * 用法: node test/check-page.js
 *
 * 与旧版的差别：
 *   · 屏幕高度 stub 成 960，验证「首次加载按用户屏幕高度」与预览高度选择器
 *   · 覆盖统一导入框、下载 .cfg、canonical PNG 导出、准星库新旧规则、位置筛选与排序
 *   · 断言页面不发任何 /api 请求、没有管理入口
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const SCREEN_H = 960;
let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fail++;
};
const section = (t) => console.log("\n" + t);

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(String((e && e.message) || e)));
vc.on("error", (m) => errors.push(String(m)));

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://127.0.0.1:3800/",
  virtualConsole: vc,
});
const { window } = dom;
const { document } = window;

/* ---- 环境桩：屏幕高度 960（jsdom 默认 0）、剪贴板、下载锚点、fetch ---- */
const screenStub1 = Object.defineProperty(window.screen, "height", { value: SCREEN_H, configurable: true });
if (window.screen.height !== SCREEN_H) {
  Object.defineProperty(window, "screen", { value: { height: SCREEN_H, width: 1920 }, configurable: true });
}
const copied = [];
Object.defineProperty(window.navigator, "clipboard", {
  value: { writeText: (t) => { copied.push(String(t)); return Promise.resolve(); } },
  configurable: true,
});
const downloads = [];
window.HTMLAnchorElement.prototype.click = function () {
  downloads.push(this.getAttribute("download") || "?");
};
const fetchCalls = [];
window.fetch = (u) => { fetchCalls.push(String(u)); return Promise.reject(new Error("no server in test")); };
window.scrollTo = () => {};

window.addEventListener("error", (e) => errors.push("window.onerror: " + ((e.error && e.error.stack) || e.message)));

let drawCalls = 0;
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,TESTPNG";
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1,
    setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
    closePath() {}, moveTo() {}, lineTo() {}, translate() {}, scale() {},
    rect() { drawCalls++; }, fill() { drawCalls++; }, fillRect() { drawCalls++; },
    strokeRect() { drawCalls++; }, arc() {}, stroke() {}, fillText() {},
    toDataURL: () => "data:image/png;base64,TESTPNG",
  };
};

const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
// 第三参数用于补事件属性（键盘事件用 KeyboardEvent，其余用 Event + defineProperty）
const fire = (el, type, extra) => {
  if (!el) return;
  let ev;
  if (/^key/.test(type)) {
    ev = new window.KeyboardEvent(type, Object.assign({ bubbles: true, cancelable: true }, extra || {}));
  } else {
    ev = new window.Event(type, { bubbles: true });
    if (extra) Object.keys(extra).forEach((k) => Object.defineProperty(ev, k, { value: extra[k] }));
  }
  el.dispatchEvent(ev);
};
const $ = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];

// 从控制台命令文本里取出命令名（精确匹配，不能拿子串去比，否则 cl_crosshaircolor_r 会被误判）
const cmdNames = (text) =>
  String(text)
    .split(/[;\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/[\s="']+/)[0].toLowerCase());

const SCRIPTS = [
  "js/core-alphabet.js", "js/core-layouts.js", "js/core-codec.js", "js/core-legacy.js",
  "js/core-convert.js", "js/core-convars.js", "js/render-model.js", "js/render-canvas.js",
  "js/codec.js", "js/players.js", "js/hltv-teams.js", "js/app.js",
];
const lines = () => $("cfgOutput").value.split("\n").filter(Boolean);

// 打开某位选手的详情弹窗（先按搜索词过滤成平铺列表，保证能找到卡片）
const openPlayer = (name) => {
  $("proSearch").value = name;
  fire($("proSearch"), "input");
  const card = q('.player-card[data-pid="' + name + '"]');
  if (!card) return null;
  click(card.querySelector(".pc-name") || card);
  return card;
};
const closeIfOpen = () => { if (!$("playerModal").hidden) click($("modalClose")); };

(async () => {
  section("① 脚本加载与初始化");
  for (const f of SCRIPTS) {
    try {
      window.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
    } catch (e) {
      errors.push(f + " 执行失败: " + e.message);
    }
  }
  await new Promise((resolve) => {
    if (document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
    setTimeout(resolve, 3000);
  });
  await new Promise((r) => setTimeout(r, 50));

  const CS = window.CS2Crosshair;
  ok(errors.length === 0, "无 JS 错误" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));
  ok(!!CS, "window.CS2Crosshair 已挂载");
  ok(window.PRO_PLAYERS.length > 0, "选手数据已载入（" + window.PRO_PLAYERS.length + " 人）");
  const bannedTeams = ["imperialesports", "metizport", "nemigagaming", "thehunsesports", "fnatic", "fluxo"];
  ok(!window.PRO_TEAMS.some((t) => bannedTeams.indexOf(t.k) > -1) &&
    !window.PRO_PLAYERS.some((p) => bannedTeams.indexOf(p.t) > -1),
    "已移除 6 支指定战队的准星数据（当前 " + window.PRO_TEAMS.length + " 队）");
  ok(drawCalls > 0, "准星画布已渲染（" + drawCalls + " 次绘制调用）");
  ok(CS.STYLES.length === 10, "样式表 " + CS.STYLES.length + " 项（0-9）");
  ok(CS.PASTE_LIMIT === 512, "粘贴上限 PASTE_LIMIT = " + CS.PASTE_LIMIT);
  ok(CS.NEVER_OUTPUT.length === 9, "禁止输出的旧命令名 " + CS.NEVER_OUTPUT.length + " 条");

  section("② 控制台命令：逐句一行显示 / 复制仍是单行分号 / ≤512 / 无旧命令名");
  let ls = lines();
  // 展示层：一行一条命令（不再用分号挤在一行）
  ok(ls.length > 1, "展示为逐句多行（实际 " + ls.length + " 行）");
  ok(ls.every((l) => l.indexOf(";") === -1), "每行只有一条命令（行内没有分号）");
  ok(ls.every((l) => /^[a-z0-9_]+ .+$/.test(l.trim())), "每行都是「命令 值」格式");
  ok(ls[0].trim().indexOf("cl_crosshairstyle ") === 0, "首行是 cl_crosshairstyle");
  // 复制层：控制台只吃单行 ≤512，复制内容必须是合并后的单行分号版
  const oneLine = ls.join("; ");
  ok(oneLine.length <= CS.PASTE_LIMIT, "合并后的单行命令 " + oneLine.length + " ≤ " + CS.PASTE_LIMIT + " 字符");
  const names = cmdNames(ls.join("\n"));
  const badNever = names.filter((n) => CS.NEVER_OUTPUT.indexOf(n) !== -1);
  ok(badNever.length === 0, "未出现 CS.NEVER_OUTPUT 里的任何命令名" + (badNever.length ? "：" + badNever.join(",") : "") +
    "（共 " + names.length + " 条命令）");
  ok(names.indexOf("cl_crosshair_screen_height") > -1, "命令里带 cl_crosshair_screen_height（跨分辨率一致的机制）");
  ok(/\/\s*512/.test($("pasteLen").textContent), "字符计数：" + $("pasteLen").textContent);
  copied.length = 0;
  click($("btnCopyPaste"));
  ok(copied.length === 1 && copied[0].indexOf(";") > -1 && copied[0].indexOf("\n") === -1,
    "「复制命令」给的是单行分号版（" + (copied[0] || "").length + " 字符）");
  ok(copied[0].trim().indexOf("cl_crosshairstyle ") === 0, "复制的单行版首条是 cl_crosshairstyle");
  copied.length = 0;
  click($("btnQuickCopy"));
  ok(copied.length === 1 && copied[0] === $("shareCodeInput").value,
    "预览动作条「复制分享码」与分享面板一致");
  ok(!$("btnQuickCmd"), "预览动作条已精简（「命令」入口并入分享面板）");
  console.log("    首行: " + ls[0]);
  console.log("    行数: " + ls.length + " · 单行合并 " + oneLine.length + " 字符");

  section("③ 存图 / 下载 .cfg 已整体移除");
  ok(!$("btnExport") && !$("btnDownloadCfg"), "分享面板不再有「存图」「下载 .cfg」按钮");
  ok(document.body.textContent.indexOf("存图") === -1 && document.body.textContent.indexOf("下载 .cfg") === -1,
    "页面文案不再出现存图 / 下载 .cfg");
  ok(typeof CS.settingsToCfgFile !== "function" && typeof CS.exportPreviewPng !== "function" &&
    typeof CS.canonicalExportSize !== "function" && !CS.CFG_FILE_NAME,
    "门面已不再导出 cfg 文件 / PNG 导出 API");
  ok(downloads.length === 0, "整个流程不触发任何下载");

  section("④ 预览恒 1:1 · 无「制作基准」· 滚动不收窄");
  ok(window.screen.height === SCREEN_H, "测试桩：window.screen.height = " + window.screen.height);
  // 「制作基准」概念已整体移除：控件、说明、舞台标注里都不应再出现
  ok(!$("screenHeightSel") && !$("vScreenHeight") && !$("screenHeightNote"),
    "「制作基准」分组控件已从页面移除");
  ok(document.body.textContent.indexOf("制作基准") === -1, "页面文案里不再出现「制作基准」");
  // Apple 式去冗余：样式角标/HUD 读数条/色块都与参数区重复，整体移除
  ok(!$("stageMeta") && !q(".stage-meta"), "「当前样式」角标已移除（与样式下拉重复）");
  ok(!$("previewHud") && !q(".preview-hud"), "HUD 参数读数条已移除（与参数区逐项重复）");
  ok(!$("colorChip") && !q(".color-swatch"), "46px 色块已移除（当前颜色由预览与选中环表达）");
  ok(!$("stageScale"), "冗余的像素口径文案已移除（无 #stageScale）");
  ok(!$("viewHeightSel") && !$("screenHeight") && !$("arSeg") && !$("zoomSeg"),
    "不提供预览高度 / 宽高比模拟控件");
  // 预览恒为 1:1 原生像素：不存在任何检视倍率控件，也不存在任何展示缩放换算
  ok(!$("lensSeg") && qa("#lensSeg button").length === 0, "检视倍率控件已移除（无 #lensSeg）");
  ok(!("previewUnit" in CS), "previewUnit 展示缩放已从门面移除（1 模型像素 = 1 CSS 像素是硬约束）");
  ok(!$("stageBadge"), "冗余的 1:1 徽标已移除");
  ok(!q(".stage-live"), "「1:1 预览」角标已整体移除（渲染恒为 1:1，无需文字标注）");
  ok(!$("previewStage").classList.contains("is-zoomed"), "舞台不再有检视缩放态（无 is-zoomed）");
  ok(!$("bgImg").style.transform, "背景不参与缩放（无 transform）");
  // 左右分栏：预览只有一个恒定形态，不再有吸附收缩的第二形态
  ok(!q(".preview-panel.is-stuck"), "吸附收缩态已整体移除（预览恒定，无两层设计）");
  // screenHeight 仍是模型字段：分享码 / 命令 / PNG 都携带它
  ok(cmdNames($("cfgOutput").value).indexOf("cl_crosshair_screen_height") > -1 &&
    /cl_crosshair_screen_height 960/.test($("cfgOutput").value),
    "模型 screenHeight = 用户屏幕高度 960，命令里始终带着它");
  const pasteHasSH = lines().some((l) => l.indexOf("cl_crosshair_screen_height 960") > -1);
  ok(pasteHasSH, "逐句命令里同样带 cl_crosshair_screen_height 960");

  section("⑤ 10 个样式 / 负间隙 / 静态样式禁用项");
  const styleSel = $("styleSel");
  const sGap = $("sGap");
  const sSpread = $("sSpread");
  const btnRecoil = $("btnRecoil");
  const spreadField = $("spreadField");
  ok(styleSel && styleSel.tagName === "SELECT" && styleSel.options.length === 10,
    "样式下拉共 " + (styleSel ? styleSel.options.length : 0) + " 项：" + (styleSel ? styleSel.options[4].textContent : ""));
  // 双击参数行 → 单项恢复默认
  const lenField = $("sLength").closest(".field");
  ok(lenField && lenField.title.indexOf("双击") > -1, "参数行带「双击恢复默认」提示");
  $("sLength").value = "40";
  fire($("sLength"), "input");
  lenField.dispatchEvent(new window.Event("dblclick", { bubbles: true }));
  ok($("sLength").value === "11" && $("vLength").textContent === "11",
    "双击参数行恢复默认（长度 40 → 11，实际 " + $("sLength").value + "）");
  let styleOk = true;
  let styleErr = "";
  for (let v = 0; v < 10; v++) {
    styleSel.value = String(v);
    fire(styleSel, "change");
    const first = lines()[0].split(";")[0].trim();
    if (first !== "cl_crosshairstyle " + v) { styleOk = false; styleErr = "样式 " + v + " → " + first; break; }
  }
  ok(styleOk, "0-9 十个样式都能选中并生效" + (styleErr ? "（" + styleErr + "）" : ""));
  styleSel.value = "2";
  fire(styleSel, "change");
  ok(parseFloat(sGap.min) < 0, "切到 style 2 后 gap 滑杆 min = " + sGap.min + "（允许负值）");
  ok(btnRecoil.disabled === false, "style 2 是动态样式，「动态预览」可用");
  styleSel.value = "4";
  fire(styleSel, "change");
  ok(parseFloat(sGap.min) === 0, "切回静态样式 gap min = " + sGap.min);
  ok(btnRecoil.disabled === true, "静态样式（style 4）禁用「动态预览」");
  ok(sSpread.disabled === true && spreadField.classList.contains("is-dim"), "静态样式 dynamicSpreadLimit 置灰并禁用");
  styleSel.value = "7";
  fire(styleSel, "change");
  ok(btnRecoil.disabled === false && sSpread.disabled === false, "切到 style 7（动态）后两项恢复可用");
  // style 5：静态形状 + 开火反馈 k（0xDA6B60）—— 预览可演示，但不吃散布上限
  styleSel.value = "5";
  fire(styleSel, "change");
  ok(btnRecoil.disabled === false, "style 5 有开火反馈：允许开启动态预览（k 脉冲）");
  ok(sSpread.disabled === true && spreadField.classList.contains("is-dim"),
    "style 5 不吃散布上限，dynamicSpreadLimit 仍置灰");
  click(btnRecoil);
  await new Promise((r) => setTimeout(r, 140));
  ok($("fmLabel").textContent === "FEEDBACK", "style 5 散布计标签 = FEEDBACK（反馈外推量）");
  const fbVal = parseFloat($("fmVal").textContent);
  ok(isFinite(fbVal) && fbVal >= 0 && fbVal <= 23,
    "style 5 反馈外推读数落在 0–23px（1080p 满量 22.5）：" + $("fmVal").textContent);
  click(btnRecoil);
  styleSel.value = "7";
  fire(styleSel, "change");
  // 动态预览：点按开始自动循环，散布计出现；再点停止
  click(btnRecoil);
  ok(btnRecoil.classList.contains("is-playing") && $("recoilChip").classList.contains("show"),
    "动态预览已启动（按钮进入播放态、开火标记可见）");
  await new Promise((r) => setTimeout(r, 90));
  ok($("fireMeter").classList.contains("show"), "散布计已显示：" + $("fmVal").textContent + "px");
  // style 0：扩散参数推动 gap
  const dynM = CS.normalizeModel(Object.assign(CS.defaultSettings(), { style: 0, followRecoil: true }));
  const ops0 = CS.buildDrawOps(dynM, { recoil: false, spreadPx: 0, climbPx: 0 });
  const ops1 = CS.buildDrawOps(dynM, { recoil: false, spreadPx: 6, climbPx: 4 });
  ok(ops1.x === ops0.x + 6 && ops1.dy === -4,
    "style 0 动画参数驱动几何：x +6 → " + (ops1.x - ops0.x) + "px，dy " + ops1.dy + "px");
  const staticM = CS.normalizeModel(Object.assign(CS.defaultSettings(), { style: 4 }));
  const ops2 = CS.buildDrawOps(staticM, { recoil: false, spreadPx: 6, climbPx: 4 });
  ok(ops2.x === CS.buildDrawOps(staticM, { recoil: false }).x && ops2.dy === 0,
    "静态样式忽略动态预览参数（几何不变）");
  // 游戏内预览校正（2026-10-21）：style 7 “Dynamic Quad” = 四臂静止 + 4 段 45° 象限弧
  // （弧心线半径 4→73px，张角固定 45°，弧粗 = thickness）
  const quadM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 7, length: 20, thickness: 4, gap: 10, screenHeight: 1080, outlineMode: 0,
  }));
  const q0 = CS.buildDrawOps(quadM, { spread01: 0 });
  const q1 = CS.buildDrawOps(quadM, { spread01: 1 });
  const arcsOf = (ops) => {
    const L = ops.layers.find((x) => x.arcs && x.arcs.length);
    return L ? L.arcs : null;
  };
  const a0 = arcsOf(q0), a1 = arcsOf(q1);
  const spanDeg = (a) => ((a.a1 - a.a0) * 180) / Math.PI;
  ok(CS.styleShape(7) === "quad" && q0.shape === "quad" &&
    q0.x === q1.x && a0 && a0.length === 4 && a1.length === 4 &&
    a0[0].r === 12 && a1[0].r === 84 && Math.abs(spanDeg(a1[0]) - 45) < 1e-6,
    "style 7 四臂不动、4 段 45° 象限弧 gap+thick/2→gap+72+thick/2（游戏 0xda6e60 / 0xda61c0）");
  // style 1：圆环半径 = gap + 散布（满散布 +70px @1080p），与臂长无关
  const circM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 1, length: 20, gap: 10, screenHeight: 1080,
  }));
  const circ0 = CS.buildDrawOps(circM, { spread01: 0 });
  const circ1 = CS.buildDrawOps(circM, { spread01: 1 });
  const circleR = (ops) => ops.layers.find((x) => x.rings && x.rings.length).rings[0].r;
  ok(circleR(circ0) === 11 && circleR(circ1) === 83,
    "style 1 圆环内径 = gap→gap+72px（满散布 = focal×0.1）+ half thickness");
  // 静态圆（style 3）：0xda6a80 → 内径 = max(1, gap)，环宽 = thickness（与 length 无关）
  const st3 = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 3, length: 20, thickness: 4, gap: 10, screenHeight: 1080,
  }));
  const ring3 = CS.crosshairRects(st3, {}).layers.find((x) => x.rings && x.rings.length).rings[0];
  ok(ring3.r === 12 && ring3.w === 4,
    "style 3 静态圆内径 = max(1,gap)+half thickness = " + ring3.r + "，环宽 = thickness = " + ring3.w);
  // 静态四分（style 9）：0xda7390 → 4 段 90° 轴向弧，半径 = max(1,gap)+thickness，无四臂
  const st9 = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 9, length: 20, thickness: 4, gap: 10, screenHeight: 1080,
  }));
  const ops9 = CS.crosshairRects(st9, {});
  const arcs9 = ops9.layers.find((x) => x.arcs && x.arcs.length).arcs;
  ok(arcs9.length === 4 && arcs9[0].w === 4 && Math.abs(spanDeg(arcs9[0]) - 90) < 1e-6 &&
    (ops9.layers[0].rects || []).length === 0,
    "style 9 = 4 段 90° 轴向弧、无四臂（游戏 0xda7390）");
  // clampR 的下界由 dot 决定，而不是 drawoutline（游戏 0xda0bc5：cmp byte [rdi+0x70],0）
  // gap=0 时，radius 会被夹到 lo：dot 关 → 0，dot 开 → thickness
  const loBase = Object.assign(CS.defaultSettings(), {
    style: 7, length: 12, thickness: 4, gap: 0, screenHeight: 1080, drawOutline: true,
  });
  const loDotOff = CS.crosshairRects(CS.normalizeModel(Object.assign({}, loBase, { centerDotEnabled: false })), {});
  const loDotOn = CS.crosshairRects(CS.normalizeModel(Object.assign({}, loBase, { centerDotEnabled: true })), {});
  const arcR = (ops) => ops.layers.find((x) => x.arcs && x.arcs.length).arcs[0].r;
  ok(arcR(loDotOn) - arcR(loDotOff) === 4,
    "clampR 下界 = dot ? thickness : 0（游戏 0xda0bc5），gap=0 时弧半径 " +
    arcR(loDotOff) + " → " + arcR(loDotOn));
  // 静态方形（style 8）：0xda7110 → 外沿 = max(0,gap)+thickness，边宽 = thickness
  const st8 = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 8, length: 20, thickness: 4, gap: 10, screenHeight: 1080,
  }));
  const rects8 = CS.crosshairRects(st8, {}).layers[0].rects;
  let s8x0 = 1e9, s8x1 = -1e9;
  rects8.forEach((r) => { s8x0 = Math.min(s8x0, r.x); s8x1 = Math.max(s8x1, r.x + r.w); });
  ok(rects8.length === 4 && s8x0 === -14 && s8x1 === 14,
    "style 8 = 4 条边矩形、外沿 ±(gap+thickness) = " + s8x0 + ".." + s8x1 + "（游戏 0xda7110）");
  // 实机 golden：1080p / style 7 / length 5 / thickness 2 / gap 3 → 16×16，臂厚 2，总间隙 6
  const gameM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 7, length: 5, thickness: 2, gap: 3, screenHeight: 1080, outlineMode: 0,
  }));
  const gameOps = CS.crosshairRects(gameM, {});
  let gx0 = 1e9, gx1 = -1e9, gy0 = 1e9, gy1 = -1e9;
  gameOps.layers.forEach((L) => (L.rects || []).forEach((r) => {
    gx0 = Math.min(gx0, r.x); gx1 = Math.max(gx1, r.x + r.w);
    gy0 = Math.min(gy0, r.y); gy1 = Math.max(gy1, r.y + r.h);
  }));
  ok(gx1 - gx0 === 16 && gy1 - gy0 === 16,
    "1080p style 7 5/2/3 外框 = " + (gx1 - gx0) + "×" + (gy1 - gy0) + "（游戏设置页实测 16×16）");
  // 亚像素：展示缩放 0.5 时，1px 厚度的臂必须保留 0.5px，而不是被垫成 1px
  const rayRects = [];
  const rayCtx = {
    save() {}, restore() {}, beginPath() {}, fill() {}, arc() {}, stroke() {},
    setTransform() {}, clearRect() {},
    rect(x, y, w, h) { rayRects.push([x, y, w, h]); },
    fillRect(x, y, w, h) { rayRects.push([x, y, w, h]); },
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
  };
  const rayM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 4, length: 2, thickness: 1, gap: 1, outlineMode: 0,
  }));
  CS.renderOpsSnapped(rayCtx, CS.buildDrawOps(rayM, {}), 100, 100, 0.5);
  ok(rayRects.some((r) => Math.abs(r[3] - 0.5) < 1e-9 || Math.abs(r[2] - 0.5) < 1e-9),
    "缩放 0.5 时保留 0.5px 的亚像素臂（不强制 1px）");
  // style 2 的分裂距离也由同一动态包络驱动。
  // 游戏 0xDA66C0：gapUnit = t×320（480p），split = min(gapUnit, splitdist)，
  // 内臂推进 shift(split)、外臂推进 shift(gapUnit) = 半径 R；臂长按 splitSizeRatio 切段。
  const splitM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 2, length: 20, gap: 7, splitDistance: 20, splitSizeRatio: 1,
    innerSplitAlpha: 0, outerSplitAlpha: 1, screenHeight: 1080,
  }));
  const splitMs = CS.crosshairMetrics(splitM, { spread01: 1 });
  ok(splitMs.spread === Math.round(splitMs.focal * 0.1) && splitMs.focal === 720 && splitMs.spread === 72,
    "满散布半径 = focal(H)×t = " + splitMs.spread + "px（1080p focal " + splitMs.focal + "，t 0.1）");
  const rightArm = (g) => g.layers[g.layers.length - 1].rects.find((r) => r.h === g.f && r.x > 0);
  const split0 = CS.crosshairRects(splitM, { splitScale: 0 });
  const split1 = CS.crosshairRects(splitM, { splitScale: 1 });
  const outerIn0 = split0.layers[0].rects.find((r) => r.h === split0.f && r.x > 0).x;
  const outerIn1 = rightArm(split1).x;
  ok(outerIn1 - outerIn0 === 72 && Math.abs(outerIn1) === 7 + 72,
    "style 2 外臂随包络推进到完整半径：内沿 " + outerIn0 + "→" + outerIn1 + "（gap 7 + R 72）");
  // splitdist 截断内臂：splitPx = round(20 × 1080/480) = 45 < R，故内臂只推进 45
  const cutM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 2, length: 20, gap: 7, splitDistance: 20, splitSizeRatio: 0.5,
    innerSplitAlpha: 0, outerSplitAlpha: 1, screenHeight: 1080,
  }));
  const cutG = CS.crosshairRects(cutM, { spread01: 1 });
  const cutInner = cutG.layers[cutG.layers.length - 2].rects.find((r) => r.h === cutG.f && r.x > 0);
  const cutOuter = rightArm(cutG);
  ok(cutG.splitPx === 45 && Math.abs(cutInner.x) === 7 + 45 &&
    Math.abs(cutOuter.x) - Math.abs(cutInner.x) === 72 - 45,
    "内臂被 splitdist 截断到 " + cutG.splitPx + "px，外臂仍推进 R（差 " + (Math.abs(cutOuter.x) - Math.abs(cutInner.x)) + "px）");
  // ratio = 0.5 时外臂长度减半（游戏按比例切段），外沿只多出 10px
  const halfM = CS.normalizeModel(Object.assign(CS.defaultSettings(), {
    style: 2, length: 20, gap: 7, splitDistance: 20, splitSizeRatio: 0.5,
  }));
  const halfOuter = (() => {
    const g = CS.crosshairRects(halfM, { recoil: true, splitScale: 1 });
    const L = g.layers[g.layers.length - 1];
    const r = L.rects.find((q) => q.h === g.f) || L.rects[0];
    return r.w === g.f ? r.h : r.w;
  })();
  ok(halfOuter === 10, "splitSizeRatio 0.5 → 外臂长度 10（实际 " + halfOuter + "）");
  click(btnRecoil);
  ok(!btnRecoil.classList.contains("is-playing"), "再次点击停止自动预览");
  styleSel.value = "4";
  fire(styleSel, "change");

  section("⑥ 描边三态与描边 RGBA 滑杆联动");
  const oBtns = qa("#outlineSeg button");
  ok(oBtns.length === 3, "描边分段按钮 " + oBtns.length + " 个：" + oBtns.map((b) => b.textContent).join("/"));
  ok(["sOR", "sOG", "sOB", "sOA"].every((id) => !!$(id)), "描边 RGBA 四个滑杆存在（sOR/sOG/sOB/sOA）");
  const outlineCmd = () => cmdNames($("cfgOutput").value);
  click(oBtns.find((b) => b.dataset.outline === "0"));
  ok(outlineCmd().indexOf("cl_crosshairoutline_r") === -1, "无描边：命令里没有描边颜色");
  ok($("outlineColorHost").classList.contains("is-dim"), "无描边：描边颜色置灰");
  ok($("sOR").disabled === true, "无描边：描边滑杆 disabled");
  click(oBtns.find((b) => b.dataset.outline === "1"));
  // 最小完备语义：默认黑色描边色与游戏出厂一致 → 单行粘贴里省略；拖动滑杆后条件恢复（下方 200 断言）
  ok(outlineCmd().indexOf("cl_crosshairoutline_r") === -1, "全描边 + 默认黑描边色：单行命令省略描边颜色（条件输出）");
  ok($("sOR").disabled === false, "全描边：滑杆恢复可用");
  ok($("outlineSeg").querySelector('button[data-outline="1"]').classList.contains("active"), "完整轮廓按钮处于选中态");
  $("sOR").value = "200";
  fire($("sOR"), "input");
  ok(/cl_crosshairoutline_r 200/.test($("cfgOutput").value), "拖动描边 R 滑杆 → 命令同步为 200");
  ok($("vOR").textContent === "200", "数值徽标同步：" + $("vOR").textContent);
  click(oBtns.find((b) => b.dataset.outline === "2"));
  ok($("cfgOutput").value.indexOf("cl_crosshair_drawoutline 2") > -1, "半描边：drawoutline = 2");
  ok($("outlineSeg").querySelector('button[data-outline="2"]').classList.contains("active"), "半轮廓按钮处于选中态");
  click(oBtns.find((b) => b.dataset.outline === "1"));
  // 颜色控件：游戏同款调色盘，直接内嵌在参数面板里（不是二级菜单）
  section("⑥.1 颜色控件：内嵌的游戏同款调色盘（无二级菜单 / 无候选色）");
  ok(qa("#xhairPalette, .color-palette, [data-rgb]").length === 0, "候选色板已移除（无 #xhairPalette / .color-palette）");
  ok(!$("sRed") && !$("sGreen") && !$("sBlue") && !$("sValue") && !$("sAlpha"),
    "旧滑杆全部移除（无 sRed/sGreen/sBlue/sValue/sAlpha）");
  ok(!$("cpDialog") && !$("cpTrigger") && !$("cpAccept") && !$("cpCancel"),
    "不再有二级菜单（无 #cpDialog / #cpTrigger / 取消-接受按钮）");
  ok($("cpSV").closest(".settings-panel") !== null, "调色盘直接嵌在参数面板里（不是浮层）");
  ok(!!$("cpSV") && !!$("cpHue") && !!$("cpAlpha"), "调色盘有 SV 方块 + 色相条 + 不透明度条");
  ok(["nRed", "nGreen", "nBlue", "nAlpha", "cpHexInput"].every((id) => !!$(id)),
    "调色盘有 R/G/B/#/A 五个数值框");
  ok($("cpSV").getAttribute("role") === "slider" && $("cpSV").getAttribute("tabindex") === "0",
    "SV 方块可键盘操作（role=slider + tabindex=0）");
  ok($("cpHue").getAttribute("role") === "slider" && $("cpAlpha").getAttribute("role") === "slider",
    "色相条 / 不透明度条也是 slider");
  // 数值框 → 命令 / 十六进制同步（没有「确定」，改完立即生效）
  $("nRed").value = "255"; fire($("nRed"), "change");
  $("nGreen").value = "0"; fire($("nGreen"), "change");
  $("nBlue").value = "0"; fire($("nBlue"), "change");
  ok(/cl_crosshaircolor_r 255/.test($("cfgOutput").value) && /cl_crosshaircolor_g 0/.test($("cfgOutput").value) &&
    /cl_crosshaircolor_b 0/.test($("cfgOutput").value), "RGB 数值输入 → 控制台命令同步");
  ok($("cpHexInput").value === "#FF0000", "十六进制回显同步：" + $("cpHexInput").value);
  // 不透明度：数值框 → 命令；方向键按 5 步进
  $("nAlpha").value = "128"; fire($("nAlpha"), "change");
  ok(/cl_crosshaircolor_a 128/.test($("cfgOutput").value), "不透明度数值框 → 命令同步");
  const alphaBefore = $("cpAlpha").getAttribute("aria-valuenow");
  fire($("cpAlpha"), "keydown", { key: "ArrowLeft" });
  ok($("cpAlpha").getAttribute("aria-valuenow") !== alphaBefore,
    "方向键改变不透明度：" + alphaBefore + " → " + $("cpAlpha").getAttribute("aria-valuenow"));
  // 色相条：方向键 5° 步进
  const hueBefore = $("cpHue").getAttribute("aria-valuenow");
  fire($("cpHue"), "keydown", { key: "ArrowRight" });
  ok($("cpHue").getAttribute("aria-valuenow") !== hueBefore,
    "方向键改变色相：" + hueBefore + "° → " + $("cpHue").getAttribute("aria-valuenow") + "°");
  // 十六进制输入框
  $("cpHexInput").value = "#00ff00"; fire($("cpHexInput"), "change");
  ok(/cl_crosshaircolor_r 0/.test($("cfgOutput").value) && /cl_crosshaircolor_g 255/.test($("cfgOutput").value) &&
    $("cpHexInput").value === "#00FF00", "十六进制输入 → 颜色同步：" + $("cpHexInput").value);
  // 复位到默认准星绿 + 满不透明度，后续用例从已知状态继续
  $("nAlpha").value = "255"; fire($("nAlpha"), "change");
  ok(/cl_crosshaircolor_a 255/.test($("cfgOutput").value) && $("cpHexInput").value === "#00FF00",
    "复位为绿色 / 不透明度 255：" + $("cpHexInput").value);

  section("⑦ 分享码输出 + CSGO- 旧码导入提示");
  const importInput = $("importInput");
  const codeInput = $("shareCodeInput");
  ok(codeInput.value.indexOf("CS") === 0 && codeInput.value.length === 46,
    "分享码是 CS 开头 46 字符：" + codeInput.value);
  ok(/新格式/.test($("codeFormat").textContent), "码格式标签：" + $("codeFormat").textContent);
  const rt = CS.decodeShareCode(codeInput.value);
  ok(rt && rt.format === "cs2-v1", "生成永远是 cs2-v1");
  // 旧码样例：优先真实数据（历史版本里的 legacy 条目），否则用合成旧码
  let legacyCode = "";
  for (const p of window.PRO_PLAYERS) {
    const h = (p.h || []).find((e) => e.lg);
    if (h) { legacyCode = h.c; break; }
  }
  if (!legacyCode) {
    legacyCode = CS.encodeLegacy({
      style: 4, centerDotEnabled: false, length: 2, thickness: 1, gap: -2,
      outlineEnabled: true, outline: 1, red: 0, green: 255, blue: 0,
      alphaEnabled: true, alpha: 200, tStyleEnabled: false, followRecoil: false,
      fixedCrosshairGap: 0, innerSplitAlpha: 1, outerSplitAlpha: 0.5, splitSizeRatio: 1,
      splitDistance: 7, deployedWeaponGapEnabled: false, color: 1,
    });
  }
  ok(/^CSGO-/.test(legacyCode), "找到旧码样例：" + legacyCode);
  importInput.value = legacyCode;
  fire(importInput, "input");
  ok($("importKind").textContent.indexOf("旧码") > -1, "导入框实时识别为：" + $("importKind").textContent);
  click($("btnImportCode"));
  const notice = $("legacyNotice");
  ok(notice.hidden === false, "预览区出现提示条");
  ok(/近似/.test(notice.textContent) && /游戏已不接受导入/.test(notice.textContent),
    "提示内容：" + notice.textContent.slice(0, 70));
  ok(notice.textContent.indexOf(legacyCode) > -1, "提示条附上原码便于核对");
  ok($("legacyNoticeShare").hidden === false, "分享区出现同一条提示");
  ok($("statusImport").className.indexOf("ok") > -1, "导入状态：" + $("statusImport").textContent);
  ok(codeInput.value.indexOf("CS") === 0 && codeInput.value.length === 46 && codeInput.value.indexOf("CSGO") === -1,
    "旧码不回显到可复制的分享码框，而是重新生成新码：" + codeInput.value);
  // 统一导入框也吃命令串
  importInput.value = "cl_crosshairstyle 4\ncl_crosshair_length 9\ncl_crosshair_gap 5";
  fire(importInput, "input");
  ok($("importKind").textContent.indexOf("命令") > -1, "导入框识别命令串：" + $("importKind").textContent);
  click($("btnImportCode"));
  ok(/cl_crosshair_length 9/.test($("cfgOutput").value) && /cl_crosshair_gap 5/.test($("cfgOutput").value),
    "新命令串导入生效");
  // 旧版命令串：同样自动识别，并按像素公式近似换算 + 提示
  importInput.value = "cl_crosshairsize 3\ncl_crosshairthickness 1\ncl_crosshairgap -2\ncl_crosshair_drawoutline 1";
  fire(importInput, "input");
  click($("btnImportCode"));
  ok($("legacyNotice").hidden === false && /近似/.test($("legacyNotice").textContent),
    "旧版命令串导入后同样出现「近似换算」提示");
  ok(/cl_crosshair_screen_height \d+/.test($("cfgOutput").value), "旧版命令串换算后输出完整的新命令集");
  // 新系统命令串（含旧 convar 残留，与 cs2_user_convars_*.vcfg 同形）：数值原样采用，不得标成「旧格式码/近似」
  importInput.value = [
    'cl_crosshairstyle "4"', 'cl_crosshair_gap "2"', 'cl_crosshair_length "4"',
    'cl_crosshair_thickness "2"', 'cl_crosshairsize "2"', 'cl_crosshairthickness "0.5"',
  ].join("\n");
  fire(importInput, "input");
  click($("btnImportCode"));
  const compatNotice = $("legacyNotice");
  ok(compatNotice.hidden === false && /原样/.test(compatNotice.textContent),
    "新系统文本夹旧残留：提示「数值原样采用」而不是「近似换算」");
  ok(compatNotice.textContent.indexOf("旧格式码") === -1 && compatNotice.textContent.indexOf("近似") === -1,
    "新系统文本不得被标成旧格式码：" + compatNotice.textContent.slice(0, 60));
  ok(/已忽略 \d+ 条旧 convar/.test(compatNotice.textContent), "同时列出被忽略的旧残留");
  importInput.value = "";
  fire(importInput, "input");
  click($("btnImportCode")); // 空输入不应报错
  ok(true, "空导入不抛错");

  section("⑧ 准星库双轨（旧码可转换 + 差异确认 / 新码完整功能）");
  click(q("#viewTabs .tab[data-view='pros']"));
  ok(qa(".player-card").length > 0, "选手卡片已渲染（" + qa(".player-card").length + " 张）");
  // 注入一位持旧码的合成选手：稳定验证「旧准星」分支（不依赖当前数据是否还有旧码当前准星）
  window.PRO_PLAYERS.push({
    // 挂在不存在的战队 key 下（hltvOf 返回 null ⇒ 现役过滤保留），不会被任何战队分组收录
    n: "ZZLegacy", t: "zztest", r: "Rifler", f: "se", c: legacyCode,
    i: { real: "Zz Legacy", dpi: 800, sens: 1, edpi: 800, res: "1280x960", extra: { sensor: "Test Sensor" } }, h: [],
  });
  const legacyCard = openPlayer("ZZLegacy");
  ok(!!legacyCard && $("playerModal").hidden === false, "打开旧码选手详情：ZZLegacy");
  // 主演区「复制分享码」与「应用到生成器」并排，其余次要动作在 #mActions
  const libBtn = (a) => q('#playerModal [data-lib="' + a + '"]');
  ok(!!libBtn("code") && !!libBtn("cmd") && !libBtn("cfg") && !libBtn("png"), "详情页只有码 / 命令两个库动作");
  ok($("mCopyCode").dataset.lib === "code" && $("mCopyCode").closest(".m-btns") !== null,
    "「复制转换码」上移到主演区，与「应用到生成器」并排");
  ok(qa("#mActions .lib-actions .btn").length === 1 && !libBtn("cmd").closest(".m-btns"),
    "次要动作只剩「复制命令」，且不出现在主演区");
  ok(libBtn("code").disabled === false && libBtn("cmd").disabled === false,
    "旧码：转换码 / 命令均可用");
  const reason = q("#mActions .lib-reason");
  ok(!!reason && /拒绝导入/.test(reason.textContent), "旧码原因可见：" + (reason ? reason.textContent.slice(0, 46) : "-") + "…");
  ok(/可转换/.test($("mKind").textContent), "详情页标注：" + $("mKind").textContent);
  ok(!!q("#mActions .orig-code"), "旧码：提供原始码存档折叠区");
  const gridCard = q('.player-card[data-pid="ZZLegacy"]');
  ok(!!gridCard && !!gridCard.querySelector('[data-act="convert"]'), "旧码卡片提供「转换」而非死按钮");
  click(gridCard.querySelector('[data-act="convert"]'));
  ok($("convertModal").hidden === false, "卡片「转换」同样打开差异确认");
  click($("cvCancel"));
  copied.length = 0;
  click(libBtn("code"));
  ok($("convertModal").hidden === false, "旧码：点击转换打开差异确认");
  ok(qa("#cvDiff li").length > 0, "差异列表非空（" + qa("#cvDiff li").length + " 项）");
  ok(/参考高度 960p/.test($("cvMeta").textContent), "确认框写明参考高度：" + $("cvMeta").textContent);
  const conv = CS.encodeShareCode(CS.decodeInfo(legacyCode, { screenHeight: 960 }).model);
  ok($("cvCode").textContent === conv, "确认框展示转换后的新码");
  click($("cvConfirm"));
  ok($("convertModal").hidden === true, "确认后关闭差异框");
  ok(copied[copied.length - 1] === conv, "确认后复制的是转换码");
  await new Promise((r) => setTimeout(r, 0));
  ok(/非选手原码/.test($("toast").textContent), "toast 明示「非选手原码」：" + $("toast").textContent);
  copied.length = 0;
  click(q('#mActions [data-lib="orig"]'));
  ok(copied[copied.length - 1] === legacyCode, "原始码可复制存档");
  copied.length = 0;
  click(libBtn("cmd"));
  ok(copied.length === 1 && /^cl_crosshairstyle /.test(copied[0]) && copied[0].indexOf(";") > -1,
    "旧码：可复制近似命令（" + (copied[0] || "").length + " 字符）");
  ok(downloads.length === 0, "库动作全程不触发下载");
  // 新码分支：注入一位持有 cs2-v1 码的选手，重新渲染后验证完整功能
  const cs2Code = CS.encodeShareCode(CS.defaultSettings());
  window.PRO_PLAYERS.push({
    n: "ZZTest", t: "zztest", r: "Rifler", f: "se", c2: cs2Code,
    i: { real: "Zz Test", dpi: 800, sens: 1, edpi: 800, extra: { sensor: "Test Sensor" } }, h: [],
  });
  closeIfOpen();
  click(q("#viewTabs .tab[data-view='generator']"));
  click(q("#viewTabs .tab[data-view='pros']"));
  const newCard = openPlayer("ZZTest");
  ok(!!newCard && $("playerModal").hidden === false, "新码选手卡片渲染并打开");
  ok(libBtn("code").disabled === false && libBtn("cmd").disabled === false, "新码：两个动作全部可用");
  ok(!q("#mActions .lib-reason"), "新码：不显示禁用原因");
  ok(/新准星/.test($("mKind").textContent), "详情页标注：" + $("mKind").textContent);
  copied.length = 0;
  click(libBtn("code"));
  ok(copied[copied.length - 1] === cs2Code, "新码：复制分享码内容正确");
  copied.length = 0;
  click(libBtn("cmd"));
  ok(copied.length === 1 && /^cl_crosshairstyle /.test(copied[0]) && copied[0].indexOf(";") > -1,
    "新码：复制控制台命令为单行分号格式（" + (copied[0] || "").length + " 字符）");
  ok(downloads.length === 0, "新码分支同样不触发下载");
  closeIfOpen();

  section("⑨ 详情页分组顺序与 Gear 内容");
  const modalCard = openPlayer("m0NESY");
  ok(!!modalCard, "打开 m0NESY 详情");
  // 弹窗头部选手照片：图源是 HLTV 阵容快照的 avatar（与详情卡 .td-avatar 同源）
  const face = $("mPlayerFace");
  ok(!!face && face.classList.contains("m-playerface"), "弹窗头部有选手照片位 #mPlayerFace");
  ok(face && face.hidden === false && /assets\/hltv\/players\//.test(face.getAttribute("src") || ""),
    "选手照片已注入（" + (face ? face.getAttribute("src") : "-") + "）");
  ok(face && face.getAttribute("alt") === "", "选手照片 alt 为空（纯装饰，昵称已在旁边）");
  ok(q(".modal-player > .m-playerface") === face, "照片在 .modal-player 内、与队标同级");
  const groups = qa("#mData .md-group .md-name").map((e) => e.textContent);
  const wantGroups = ["鼠标", "显示器", "外设", "Viewmodel", "雷达 / HUD", "视频画面"];
  ok(JSON.stringify(groups) === JSON.stringify(wantGroups),
    "分组与任务书顺序一致（" + groups.length + " 个）：" + groups.join(" → "));
  ok(qa("#mData .md-group .md-item").length > 20, "各分组字段共 " + qa("#mData .md-group .md-item").length + " 项");
  const gear = q('#mData .md-group[data-group="gear"]');
  ok(!!gear, "存在 Gear（外设）分组");
  ok(gear && /键盘|鼠标垫/.test(gear.textContent), "Gear 分组展示外设型号（键盘 / 鼠标垫）");
  const mouseGroup = q('#mData .md-group[data-group="mouse"]');
  const monGroup = q('#mData .md-group[data-group="monitor"]');
  ok(mouseGroup && /型号/.test(mouseGroup.textContent) && /Logitech|ZOWIE|SteelSeries|Razer|VAXEE|Pulsar/i.test(mouseGroup.textContent),
    "鼠标组带型号行：" + (mouseGroup ? (mouseGroup.textContent.match(/型号[A-Za-z0-9 +\-()·]*/g) || ["-"])[0] : "-"));
  ok(monGroup && /型号/.test(monGroup.textContent), "显示器组带型号行");
  ok(gear && /传感器|重量/.test(gear.textContent), "Gear 展示真实抓到的鼠标字段");
  const hist = qa("#mHistoryList .hist-entry");
  ok(hist.length > 0, "历史版本 " + hist.length + " 条");
  // 历史条目按采集时记录的 lg 标记逐条判定：旧时代走「转换 + 差异确认」，新格式直接复制
  const histLegacyBtns = qa('#mHistoryList [data-lib="code"][data-lg="1"]');
  const histNewBtns = qa('#mHistoryList [data-lib="code"]:not([data-lg])');
  ok(histLegacyBtns.length > 0 && histLegacyBtns.every((b) => !b.disabled),
    "历史旧码提供「转换」入口（" + histLegacyBtns.length + " 条）");
  ok(histNewBtns.length > 0 && histNewBtns.every((b) => !b.disabled),
    "历史新码条目复制可用（" + histNewBtns.length + " 条）");
  ok(qa("#mHistoryList .h-fmt.legacy").length === histLegacyBtns.length,
    "旧码历史条目标注「旧」（" + histLegacyBtns.length + " 条）");
  ok(qa("#mHistoryList .lib-reason-inline").length === 0, "不再用「仅可存图」灰字代替操作");
  click(histLegacyBtns[0]);
  ok($("convertModal").hidden === false, "历史旧码：转换前打开差异确认");
  click($("cvCancel"));
  ok($("convertModal").hidden === true, "取消后关闭差异框");
  ok(!!q('#mHistoryList [data-ha="apply"]'), "历史版本仍可应用到生成器");
  closeIfOpen();

  section("⑩ 位置筛选与排序");
  $("proSearch").value = "";
  fire($("proSearch"), "input");
  const allCount = qa(".player-card").length;
  ok(/^\d+ 位选手/.test($("playersCount").textContent), "全部：" + $("playersCount").textContent);
  const pickRole = (v) => { $("proRole").value = v; fire($("proRole"), "change"); };
  pickRole("AWPer");
  const awpCount = qa(".player-card").length;
  ok(awpCount > 0 && awpCount < allCount, "按位置筛选 AWPer：" + awpCount + " < " + allCount);
  ok(qa(".player-card").every((c) => (c.dataset.pid ? true : false)), "筛选后列表为平铺卡片");
  // 回归：下拉里「全部位置」的 value 曾是 "all"，被当成位置值去匹配 → 选中后 0 人
  ok($("proRole").querySelector('option[value=""]') !== null, "「全部位置」用空值哨兵（不是 all）");
  pickRole("");
  ok(qa(".player-card").length === allCount, "选「全部位置」恢复 " + allCount + " 人（回归：曾为 0）");
  // 回归：IGL 曾只认数据里的 r 字段（172 人里只有 2 人标 IGL），现按 HLTV 阵容的 IGL 标记
  pickRole("IGL");
  const iglCount = qa(".player-card").length;
  ok(iglCount > 10 && iglCount < allCount, "IGL 筛选覆盖各队指挥：" + iglCount + " 人");
  ok(qa(".player-card").every((c) => /指挥/.test(c.querySelector(".pc-role").textContent)),
    "IGL 结果的位置标签都含「指挥」");
  // 一人可同时是狙击手与指挥（FalleN / Jame）
  pickRole("AWPer");
  const bothRole = qa(".player-card").filter((c) => /指挥/.test(c.querySelector(".pc-role").textContent));
  ok(bothRole.length >= 1, "AWPer 里也有兼指挥的选手：" + bothRole.length + " 人");
  pickRole("");
  ok(qa(".player-card").length === allCount, "清空位置筛选后恢复 " + allCount + " 人");
  // 回归：搜索曾直接 return，把已选的战队条件顶掉（选 FaZe 再搜 z → 57 人）
  click(q('#teamList .team-item[data-team="faze"]'));
  const fazeOnly = qa(".player-card").length;
  $("proSearch").value = "z";
  fire($("proSearch"), "input");
  const fazeSearch = qa(".player-card").length;
  ok(fazeSearch > 0 && fazeSearch <= fazeOnly, "战队 + 搜索是「与」关系：" + fazeSearch + " ≤ " + fazeOnly);
  ok(qa(".player-card").every((c) => /faze/i.test(c.querySelector(".pc-logo").getAttribute("src") || "")),
    "搜索不会跨出所选战队（卡片队标仍全是 FaZe）");
  $("proSearch").value = "";
  fire($("proSearch"), "input");
  // 空结果给出口：条件回显 + 一键清除（曾只有一句「没有找到选手」）
  $("proSearch").value = "zzzz-no-such-player";
  fire($("proSearch"), "input");
  ok(qa(".player-card").length === 0 && /没有找到选手/.test($("proGrid").textContent), "无结果时显示空状态");
  ok(/搜索「zzzz-no-such-player」/.test($("proGrid").textContent), "空状态回显当前条件");
  const resetBtn = q('#proGrid [data-act="reset-filters"]');
  ok(!!resetBtn, "空状态提供「清除筛选条件」");
  click(resetBtn);
  ok(qa(".player-card").length === allCount && $("proSearch").value === "",
    "清除后恢复全部 " + allCount + " 人并清空搜索框");
  // 搜索词也能命中战队名
  $("proSearch").value = "faze";
  fire($("proSearch"), "input");
  ok(qa(".player-card").length === fazeOnly, "搜索队名可命中该队全部选手：" + qa(".player-card").length);
  $("proSearch").value = "";
  fire($("proSearch"), "input");
  click(q('#teamList .team-item[data-team=""]'));
  $("proSort").value = "edpi";
  fire($("proSort"), "change");
  const edpis = qa(".player-card .pc-edpi").slice(0, 12).map((e) => parseFloat(e.textContent.replace(/[^\d.]/g, "")));
  ok(edpis.length > 4 && edpis.every((v, i) => i === 0 || v >= edpis[i - 1]), "eDPI 升序：" + edpis.join(","));
  $("proSort").value = "name";
  fire($("proSort"), "change");
  const firstNames = qa(".player-card .pc-name").slice(0, 12).map((e) => e.textContent.replace(/^\S+\s+/, "").toLowerCase());
  ok(firstNames.every((v, i) => i === 0 || v >= firstNames[i - 1]), "姓名升序：" + firstNames.slice(0, 5).join(","));
  const edpiFirst = firstNames[0];
  $("proSort").value = "default";
  fire($("proSort"), "change");
  const defFirst = (qa(".player-card .pc-name")[0] || { textContent: "" }).textContent;
  ok(defFirst.trim() !== edpiFirst, "恢复默认排序后首张卡片变化：" + defFirst.trim());
  $("proSort").value = "name";
  fire($("proSort"), "change");
  $("proSort").value = "default";
  fire($("proSort"), "change");

  section("⑪ 战队详情卡（阵容 / 排名，无教练与外链）");
  ok($("teamDetail").hidden === true, "未选战队时详情卡收起");
  const fazeBtn = q('#teamList .team-item[data-team="faze"]');
  ok(!!fazeBtn, "战队侧栏有 FaZe 入口");
  click(fazeBtn);
  const td = $("teamDetail");
  ok(td.hidden === false, "选中 FaZe 后详情卡展开");
  ok(/FaZe/.test((q(".td-name") || {}).textContent || ""), "队名：" + ((q(".td-name") || {}).textContent || "-"));
  ok(!!q(".td-rankline") && /世界/.test(q(".td-rankline").textContent) && /Valve/.test(q(".td-rankline").textContent),
    "排名以行内文本展示（世界 / 区域 / Valve）：" + (q(".td-rankline") || {}).textContent);
  ok(qa(".td-lineup .td-player").length >= 5, "现役阵容 " + qa(".td-lineup .td-player").length + " 人");
  ok(qa(".td-player .td-mini-flag").length >= 5, "阵容每人带国旗/回退图标");
  // 长 ID 标注：昵称单独包一层负责省略，指挥徽标与国旗作为兄弟节点永远不会被截断或挤出卡片
  ok(qa(".td-player .td-nick > .td-nick-name").length === qa(".td-player .td-nick").length,
    "每个昵称都有独立的省略容器 .td-nick-name");
  ok(qa(".td-player .td-nick .td-igl").length === qa(".td-player .td-igl").length &&
    qa(".td-player .td-nick .td-mini-flag").length === qa(".td-player .td-mini-flag").length,
    "指挥徽标与国旗跟随昵称排在同一行（HLTV 式标注）");
  ok(qa(".td-player .td-nick-name .td-igl, .td-player .td-nick-name .td-mini-flag").length === 0,
    "指挥徽标/国旗不在省略容器内（长 ID 不会把它们吃掉）");
  const longNick = (window.HLTV_TEAMS && window.HLTV_TEAMS.lvg && window.HLTV_TEAMS.lvg.lineup || [])
    .filter(function (m) { return m.nick && m.nick.length >= 8; });
  ok(longNick.length > 0, "存在超长昵称样本用于标注回归：" + longNick.map(function (m) { return m.nick; }).join("/"));
  // 按要求移除「战队档案」「冠军荣誉」两栏，只保留横向阵容，让下方准星卡片尽快露出
  ok(qa(".td-facts, .td-trophies, .td-trophy, .td-trophy-col, .td-facts-col").length === 0 &&
    !/战队档案|冠军荣誉/.test($("teamDetail").textContent),
    "详情卡不含「战队档案」「冠军荣誉」两栏");
  ok(!q(".td-coach") && !/教练/.test($("teamDetail").textContent),
    "详情卡不展示教练（无 .td-coach，正文无「教练」字样）");
  ok(qa(".td-body > .td-col-head").length === 1, "详情卡主体只有「现役阵容」一栏");
  ok(!!q(".td-body > .td-lineup"), "阵容容器在详情卡主体内");
  // 任务书要求：详情卡不留「近期战绩 / 即将开赛」——比赛列表整体移除。
  ok(qa(".td-matches, .td-match, .td-fixtures").length === 0 &&
    !/近期战绩|即将开赛|赛程/.test($("teamDetail").textContent),
    "详情卡不渲染比赛列表（近期战绩/赛程已按任务要求移除）");
  ok(/HLTV\.org/.test((q(".td-foot") || {}).textContent || ""), "页脚标注数据来源 HLTV.org");
  ok(qa('#teamDetail a[href*="hltv.org"]').length === 0, "详情卡不再跳转 HLTV（无任何 hltv.org 外链）");
  // 3DMAX 已于 2026-10-24 整体移除：侧栏不再出现，全部战队均有 HLTV 阵容（不再有空态分支）
  ok(!q('#teamList .team-item[data-team="3dmax"]'), "3DMAX 已从战队侧栏移除");
  ok($("prosStats").textContent.indexOf("30") > -1 || document.body.textContent.indexOf("30 支战队") > -1 ||
    qa("#teamList .team-item").length === 31, "战队数量口径正确（30 支 + 「全部战队」入口）");
  click(q('#teamList .team-item[data-team=""]'));
  ok($("teamDetail").hidden === true && $("teamDetail").innerHTML === "", "点「全部战队」后详情卡收起并清空");

  section("⑫ 无障碍媒体查询（高对比 / 强制色 / 降低动效）");
  const cssText = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
  ok(/@media\s*\(prefers-contrast:\s*more\)/.test(cssText), "CSS 响应 prefers-contrast: more（抬高次要文字与分隔线）");
  ok(/@media\s*\(forced-colors:\s*active\)/.test(cssText), "CSS 响应 forced-colors: active（Windows 高对比度）");
  ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(cssText), "CSS 响应 prefers-reduced-motion: reduce");
  ok(/\.preview-stage[\s\S]{0,400}forced-color-adjust:\s*none/.test(cssText), "准星预览保留真实颜色（forced-color-adjust: none）");
  ok(/\.tab\.active[\s\S]{0,600}outline:\s*2px solid Highlight/.test(cssText), "选中态在强制色下改用系统高亮描边");

  section("⑬ 无管理入口 / 不发 /api 请求");
  ok(!$("adminLink"), "index.html 里没有 adminLink");
  ok(document.querySelectorAll('a[href*="/admin"], a[href*="/api"]').length === 0, "页面没有 /admin 或 /api 链接");
  ok(fetchCalls.length === 0, "页面没有发起任何 fetch 请求" + (fetchCalls.length ? "：" + fetchCalls.join(",") : ""));
  ok(document.documentElement.outerHTML.indexOf("adminLink") === -1, "DOM 中不存在 adminLink");

  section("⑭ 全程无 JS 错误");
  ok(errors.length === 0, "全程无 JS 错误" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));

  console.log("\n" + (fail ? "✗ " + fail + " 项未通过" : "✓ 全部通过"));
  process.exit(fail ? 1 : 0);
})();
