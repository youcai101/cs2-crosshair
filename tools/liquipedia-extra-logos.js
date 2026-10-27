/* 补齐 assets/teams 里「未被 PRO_TEAMS 引用」的队标：
 *   - fnatic.png / luminosity.png 实为 SVG 文本、phantomesports.png 实为 JPEG（坏文件）
 *   - 其余是 24×24 的小图，放大到 44px 显示会糊
 * 统一按液体百科重新抓一遍，输出与主流程完全一致（128×128 透明底、深色主题优先）。
 * 队名 → 液体百科页面名 的映射写在下面，都是人工核对过的现役/历史页面名。
 * 用法: node tools/liquipedia-extra-logos.js [--force]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./liquipedia-logos.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "assets", "teams");
const force = process.argv.includes("--force");

/* 本地 key → [显示名, 液体百科页面名] */
const EXTRA = {
  "100t": ["100 Thieves", "100 Thieves"],
  bcgame: ["BC.Game", "BC.Game"],
  fnatic: ["Fnatic", "Fnatic"],
  // 巴西 Imperial 的 CS 页面名就是 Imperial Esports（Imperial / Imperial (Brazilian team) 都不是它：
  // 前者是消歧义到 CS 饰品图标，后者页面不存在）
  imperialesports: ["Imperial", "Imperial Esports"],
  infiniteesports: ["Infinite", "Infinite Esports"],
  luminosity: ["Luminosity Gaming", "Luminosity Gaming"],
  metizport: ["Metizport", "Metizport"],
  // 页面名必须全大写 ODDIK，否则搜不到
  oddik: ["ODDIK", "ODDIK"],
  phantomesports: ["Phantom Esports", "Phantom Esports"],
  rebelsgaming: ["Rebels Gaming", "Rebels Gaming"],
  sashi: ["Sashi Esports", "Sashi Esports"],
  thehunsesports: ["The Huns Esports", "The Huns Esports"],
  unityesports: ["Unity Esports", "Unity Esports"],
  walczaki: ["Walczaki", "Walczaki"],
};

(async () => {
  let ok = 0, fail = 0, skip = 0;
  const report = [];

  for (const [k, [display, page]] of Object.entries(EXTRA)) {
    const outFile = path.join(OUT, k + ".png");
    if (!force && fs.existsSync(outFile)) {
      const st = L.pngSize(fs.readFileSync(outFile));
      if (st && st.w >= 64 && st.h >= 64) { skip++; report.push({ k, status: "skip" }); continue; }
    }

    console.log("\n→ " + display + "（" + page + "）");
    let cands = [];
    try { cands = await L.candidateImages(page); } catch (e) { console.log("  ✗ 候选解析失败：" + e.message); }
    if (!cands.length) { fail++; report.push({ k, status: "no-page" }); console.log("  ✗ 液体百科没有可用图片"); continue; }
    console.log("  候选 " + cands.length + " 张：" + cands.slice(0, 5).join("、"));

    let best = null, tried = 0;
    for (const name of cands) {
      if (tried >= 10) break;
      let meta;
      try { meta = await L.imageInfo(name); } catch (e) { continue; }
      if (!meta) continue;
      const ar = meta.fullWidth && meta.fullHeight ? meta.fullWidth / meta.fullHeight : 1;
      if (meta.mime === "image/jpeg" || ar > L.MAX_ASPECT || ar < 1 / L.MAX_ASPECT) continue;
      tried++;
      let built;
      try { built = await L.buildLogo(meta); } catch (e) { continue; }
      const short = Math.min(built.content.w, built.content.h);
      if (short < 24) continue;
      const shape = Math.max(built.content.w, built.content.h) / short;
      const score = Math.max(0, 2.2 - shape) * 100 + Math.min(built.contrast, 160) * 0.55 -
        (built.contrast < 45 ? 90 : 0);
      if (!best || score > best.score) best = { name, built, shape, score };
      if (shape <= 1.45 && built.contrast >= 45) break;
    }

    if (!best) { fail++; report.push({ k, status: "no-usable-image" }); console.log("  ✗ 没找到可用队徽"); continue; }
    fs.writeFileSync(outFile, best.built.buffer);
    ok++;
    report.push({
      k, name: display, status: "ok", image: best.name,
      content: best.built.content, shape: Number(best.shape.toFixed(2)),
      contrast: Number(best.built.contrast.toFixed(1)), file: "assets/teams/" + k + ".png",
    });
    console.log("  ✓ " + best.name + " → " + k + ".png（内容 " + best.built.content.w + "×" +
      best.built.content.h + "，形状 " + best.shape.toFixed(2) + "，可见度 " + best.built.contrast.toFixed(0) + "）");
  }

  const rf = path.join(__dirname, "cache", "logo-report-extra.json");
  try { fs.mkdirSync(path.dirname(rf), { recursive: true }); fs.writeFileSync(rf, JSON.stringify(report, null, 2)); } catch (e) {}
  console.log("\n完成：成功 " + ok + " · 跳过 " + skip + " · 失败 " + fail);
})();
