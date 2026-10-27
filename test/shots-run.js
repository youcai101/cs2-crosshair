/* 批量截图驱动：在已启动的 Edge(CDP) 上依次截图
 * 用法:
 *   1) node server.js                     （另开一个窗口）
 *   2) msedge --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank
 *      （需要抓 HLTV 时必须有头模式；纯本地截图 headless 亦可）
 *   3) node test/shots-run.js             （浏览器不在 9222 时用 CDP_PORT=9223）
 * 用途：真实浏览器渲染取证（布局 / 1:1 预览 / 逐句命令 / 当前准星并入历史）。
 */
"use strict";
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = "http://127.0.0.1:3800";

function shot(name, js, settle, env) {
  const out = path.join(SHOTS, name + ".png");
  const args = [path.join(__dirname, "cdp-shot.js"), BASE + "/", out, js || "", String(settle || 900)];
  const r = execFileSync(process.execPath, args, { encoding: "utf8", env: Object.assign({}, process.env, env || {}) });
  process.stdout.write(r.replace(/^/gm, "  "));
}

// 选择器点击容错：控件改名时不要让整个批次挂掉
var q = function (sel, i) {
  return "(function(){var e=document.querySelectorAll(" + JSON.stringify(sel) + ")[" + i + "];if(e)e.click();return !!e})()";
};
var theme = function (t) {
  return "document.documentElement.dataset.theme=" + JSON.stringify(t) + ";";
};
var style = function (v) {
  return "(function(){var s=document.getElementById('styleSel');if(s){s.value=" + JSON.stringify(String(v)) + ";s.dispatchEvent(new Event('change'))}})()";
};
var scrollTo = function (sel, off) {
  return "(function(){document.documentElement.style.scrollBehavior='auto';var e=document.querySelector(" +
    JSON.stringify(sel) + ");if(e)window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-(" + (off || 70) + "))})()";
};
var importCode = function (expr) {
  return "(function(){var i=document.getElementById('importInput');i.value=" + expr +
    ";i.dispatchEvent(new Event('input',{bubbles:true}));var b=document.getElementById('btnImportCode');if(b)b.click()})()";
};

shot("01-gen-dark", theme("dark"), 900);
shot("02-gen-light", theme("light"), 900);
shot("03-gen-dynamic-quad", theme("dark") + ";" + style(7) + ";(function(){var b=document.getElementById('btnRecoil');if(b)b.click()})()", 1400);
shot("04-gen-half-outline", theme("dark") + ";" + q("#outlineSeg button", 2) + ";" + style(2), 1000);
shot("05-settings-scroll", theme("dark") + ";" + scrollTo(".group", 90), 900);
shot("06-share-panel", theme("dark") + ";" + scrollTo(".share-panel", 70), 1000);
// 07 选中一支队展开「战队详情卡」，07b 是不选队的默认列表
var pickTeam = q("#viewTabs .tab", 1) + ";" + q('#teamList .team-item[data-team="faze"]', 0);
shot("07-pros-list", theme("dark") + ";" + pickTeam, 1500);
shot("07b-pros-default", theme("dark") + ";" + q("#viewTabs .tab", 1), 1200);
shot("08-pros-detail", theme("dark") + ";" + q("#viewTabs .tab", 1) + ";" + q(".player-card .pc-name", 0), 1600);
shot("09-legacy-notice", theme("dark") + ";" +
  importCode("(window.PRO_PLAYERS||[]).reduce(function(a,p){var h=(p.h||[]).filter(function(e){return e.lg})[0];return a||(h&&h.c)||null},null)") +
  ";" + scrollTo(".preview-panel", 70), 1400);
shot("10-mobile-430", theme("dark"), 1000, { SHOT_W: "430", SHOT_H: "860" });
shot("11-mobile-modal-430", theme("dark") + ";" + q("#viewTabs .tab", 1) + ";" + q(".player-card .pc-name", 0), 1600, { SHOT_W: "430", SHOT_H: "860" });
shot("12-mobile-pros-430", theme("dark") + ";" + pickTeam, 1500, { SHOT_W: "430", SHOT_H: "900" });
shot("13-pros-980", theme("dark") + ";" + pickTeam, 1500, { SHOT_W: "980", SHOT_H: "900" });
shot("14-pros-1180", theme("dark") + ";" + pickTeam, 1500, { SHOT_W: "1180", SHOT_H: "1000" });

console.log("DONE");
