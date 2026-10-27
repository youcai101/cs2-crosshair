/* =========================================================================
 * hltv-sync.js — 从 HLTV 抓取战队档案，生成前端数据与本地图标
 *
 * 为什么需要浏览器：HLTV 全站由 Cloudflare 挑战保护，Node/curl 直连一律 403；
 * 而真实浏览器（有头 Edge）能自动过盾。所以本脚本通过 CDP 驱动本机 Edge：
 *   1) 打开 https://www.hltv.org/team/<id>/<slug>
 *   2) 在页面上下文里提取字段（DOM + JSON-LD）
 *   3) 在页面上下文里 fetch 图片并转 base64 回传（图片 CDN 校验页面签名，站外必 403）
 *   4) 落盘 assets/hltv/**，并生成 js/hltv-teams.js（window.HLTV_TEAMS / HLTV_META）
 *
 * 前置：启动有头 Edge（不能 headless）
 *   msedge.exe --remote-debugging-port=9223 --user-data-dir=.tmp-edge \
 *     --no-first-run --no-default-browser-check \
 *     --disable-blink-features=AutomationControlled about:blank
 *
 * 用法：
 *   node tools/hltv-sync.js                 # 全量 31 队
 *   node tools/hltv-sync.js --only=faze,navi
 *   node tools/hltv-sync.js --skip-images   # 只更新字段，复用已有图片
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { connect } = require("./cdp-client.js");

const ROOT = path.join(__dirname, "..");
const TEAMS_JSON = path.join(__dirname, "hltv-teams.json");
const OUT_JS = path.join(ROOT, "js", "hltv-teams.js");
const IMG_ROOT = path.join(ROOT, "assets", "hltv");

/* ---------------- 命令行 ---------------- */
const argv = process.argv.slice(2);
const opt = { only: [], skipImages: false, port: process.env.CDP_PORT || "9223", keep: false };
argv.forEach((a) => {
  if (a.startsWith("--only=")) opt.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--skip-images") opt.skipImages = true;
  else if (a.startsWith("--port=")) opt.port = a.slice(7);
  else if (a === "--keep") opt.keep = true; // 与 --only 合用时保留其它队的旧数据
});

/* ---------------- 页面内提取（被 toString 序列化后注入页面，不能引用外部变量） ---------------- */
function pageExtract() {
  const abs = (u) => (u ? new URL(u, location.href).href : null);
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const num = (s) => {
    const m = String(s == null ? "" : s).match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));

  let ld = null;
  try { ld = JSON.parse(q('script[type="application/ld+json"]').textContent); } catch (e) { ld = null; }
  const athletes = ld && Array.isArray(ld.athlete) ? ld.athlete : [];
  const byNick = {};
  athletes.forEach((a) => { if (a.alternateName) byNick[String(a.alternateName).toLowerCase()] = a; });

  /* 队标：day-only / night-only 两套（暗色主题用 night），有的队只有一张 teamlogo */
  const pickSrc = (img) => {
    if (!img) return null;
    const ss = img.getAttribute("srcset");
    if (ss) {
      const first = ss.split(",")[0].trim().split(/\s+/)[0];
      if (first) return abs(first);
    }
    return abs(img.getAttribute("src"));
  };
  const logoBox = q(".profile-team-logo-container");
  const logo = logoBox
    ? {
        day: pickSrc(q("img.day-only", logoBox)),
        night: pickSrc(q("img.night-only", logoBox)),
        single: pickSrc(q("img.teamlogo", logoBox)),
      }
    : { day: null, night: null, single: null };

  /* 档案五项：Valve 排名 / 世界排名 / Top30 周数 / 平均年龄 / 教练 */
  const stats = { valve: null, world: null, weeksTop30: null, avgAge: null, coach: null };
  const parseRegion = (el) => {
    if (!el) return null;
    const title = el.getAttribute("title") || "";
    const m = title.match(/#(\d+)\s+in\s+(.+?)\s+on the/i);
    return {
      rank: m ? Number(m[1]) : num(txt(el)),
      name: m ? m[2].trim() : null,
      short: txt(q(".regional-rank-region", el)) || null,
      href: abs(el.getAttribute("href")),
    };
  };
  qa(".profile-team-stat").forEach((el) => {
    const label = txt(q("b", el)).toLowerCase();
    const right = q(".right", el);
    if (!right) return;
    if (label.indexOf("valve") === 0) {
      const link = q("a", right);
      stats.valve = { rank: num(txt(link || right)), href: link ? abs(link.getAttribute("href")) : null };
      stats.valve.region = parseRegion(q(".regional-rank", right));
    } else if (label.indexOf("world") === 0) {
      const link = q("a", right);
      stats.world = { rank: num(txt(link || right)), href: link ? abs(link.getAttribute("href")) : null };
      stats.world.region = parseRegion(q(".regional-rank", right));
    } else if (label.indexOf("weeks") === 0) {
      stats.weeksTop30 = num(txt(right));
    } else if (label.indexOf("average") === 0) {
      stats.avgAge = num(txt(right));
    } else if (label.indexOf("coach") === 0) {
      const a = right.tagName === "A" ? right : q("a", right);
      const img = q("img", right);
      const href = a ? a.getAttribute("href") : null;
      const idm = href && href.match(/\/coach\/(\d+)\//);
      stats.coach = {
        name: txt(a || right),
        real: ld && ld.coach ? ld.coach.name : null,
        country: img ? img.getAttribute("title") : null,
        flag: img ? abs(img.getAttribute("src")) : null,
        id: idm ? Number(idm[1]) : null,
        url: abs(href),
      };
    }
  });

  /* 当前阵容：头像 + 昵称 + 国籍 + 指挥标记 */
  const lineup = qa(".bodyshot-team a.col-custom").map((a) => {
    const nick = a.getAttribute("title") || txt(q(".nickname-container", a));
    const img = q("img.bodyshot-team-img", a);
    const fl = q("img.flag", a);
    const href = a.getAttribute("href");
    const idm = href && href.match(/\/player\/(\d+)\//);
    const ath = byNick[String(nick).toLowerCase()] || null;
    const imgTitle = img ? img.getAttribute("title") || "" : "";
    const realFromImg = imgTitle ? imgTitle.replace(/^[^']*'([^']*)'?\s*/, "").trim() : "";
    return {
      nick: nick,
      real: ath ? ath.name : realFromImg || null,
      country: fl ? fl.getAttribute("title") : null,
      flag: fl ? abs(fl.getAttribute("src")) : null,
      igl: !!q(".role-pill--igl", a),
      id: idm ? Number(idm[1]) : null,
      url: abs(href),
      avatar: ath ? ath.image : null,
      body: img ? abs(img.getAttribute("src")) : null,
    };
  });

  /* 奖杯 */
  const trophies = qa(".trophyRow a.trophy").map((a) => {
    const d = q(".trophyDescription", a);
    return { name: d ? d.getAttribute("title") || txt(d) : "", url: abs(a.getAttribute("href")) };
  }).filter((t) => t.name);

  /* 社交 */
  const socials = qa(".socialMediaButtons a").map((a) => {
    const i = q("i", a);
    const cls = i ? i.className : "";
    let platform = "link";
    if (/twitch/.test(cls)) platform = "twitch";
    else if (/instagram/.test(cls)) platform = "instagram";
    else if (/youtube/.test(cls)) platform = "youtube";
    else if (/facebook/.test(cls)) platform = "facebook";
    else if (/discord/.test(cls)) platform = "discord";
    else if (/twitter|custom-x|(^|\s)x(\s|$)/.test(cls)) platform = "x";
    else if (/steam/.test(cls)) platform = "steam";
    return { platform: platform, url: a.href };
  }).filter((s) => s.url);

  /* 比赛：Upcoming 与 Recent 两张表；按比分是否可解析区分，避免表格顺序变化 */
  const matches = [];
  qa("table.match-table").forEach((tb) => {
    let event = "";
    Array.from(tb.children).forEach((node) => {
      if (node.tagName === "THEAD") {
        const head = q("tr.event-header-cell", node);
        if (head) event = txt(q("a", head)) || txt(head);
      } else if (node.tagName === "TBODY") {
        qa("tr.team-row", node).forEach((tr) => {
          const t = q("span[data-unix]", tr);
          const teams = qa(".team-flex", tr).map((f) => {
            const a = q("a.team-name", f);
            const href = a ? a.getAttribute("href") : null;
            const idm = href && href.match(/\/team\/(\d+)\//);
            return { name: txt(a), id: idm ? Number(idm[1]) : null };
          });
          const scores = qa(".score", tr).map((s) => txt(s));
          const mp = q("a.matchpage-button", tr) || q("a.stats-button", tr);
          if (teams.length < 2) return;
          matches.push({
            event: event,
            unix: t ? Number(t.getAttribute("data-unix")) : null,
            teams: teams,
            scores: scores,
            url: mp ? abs(mp.getAttribute("href")) : null,
          });
        });
      }
    });
  });

  return {
    name: txt(q("h1.profile-team-name")),
    country: txt(q(".team-country")),
    countryFlag: abs((q(".team-country img.flag") || {}).src || null),
    countryTitle: (q(".team-country img.flag") || {}).title || null,
    logo: logo,
    stats: stats,
    lineup: lineup,
    trophies: trophies,
    socials: socials,
    matches: matches,
    ldName: ld ? ld.name : null,
    ldCoach: ld && ld.coach ? ld.coach : null,
  };
}

/* ---------------- 页面内图片下载（返回 base64 映射） ---------------- */
function pageImages(urls) {
  const toB64 = (buf) => {
    const u8 = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  };
  const one = async (u) => {
    try {
      const r = await fetch(u);
      if (!r.ok) return { error: r.status };
      const b = await r.arrayBuffer();
      return { b64: toB64(b), type: r.headers.get("content-type") || "" };
    } catch (e) {
      return { error: String(e) };
    }
  };
  return Promise.all(urls.map(one)).then((list) => {
    const out = {};
    urls.forEach((u, i) => { out[u] = list[i]; });
    return out;
  });
}

/* ---------------- 工具 ---------------- */
const MAGIC = [
  { ext: "png", mime: "image/png", hex: "89504e47" },
  { ext: "jpg", mime: "image/jpeg", hex: "ffd8ff" },
  { ext: "webp", mime: "image/webp", hex: "52494646" },
  { ext: "gif", mime: "image/gif", hex: "47494638" },
];

function sniffExt(buf, fallbackUrl) {
  const hex = buf.slice(0, 4).toString("hex");
  const hit = MAGIC.find((m) => hex.startsWith(m.hex));
  if (hit) return hit.ext;
  const m = String(fallbackUrl || "").match(/\.(svg|png|jpe?g|webp|gif)(?:\?|$)/i);
  if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  return "bin";
}

function urlExt(url) {
  const m = String(url || "").match(/\.(svg|png|jpe?g|webp|gif)(?:\?|$)/i);
  return m ? (m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()) : "bin";
}

function flagCode(url) {
  const m = String(url || "").match(/\/([A-Za-z0-9-]+)\.(?:gif|png|svg)(?:\?|$)/);
  return m ? m[1].toUpperCase() : null;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function writeImg(rel, b64) {
  const file = path.join(ROOT, rel.split("/").join(path.sep));
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
}

function rel(p) { return p.split(path.sep).join("/"); }

function shortErr(e) { return String((e && e.message) || e).slice(0, 160); }

/* 把 HLTV 的原始比赛行整理成「以本队为中心」的结构 */
function normalizeMatches(raw, teamId) {
  const out = { upcoming: [], recent: [] };
  (raw || []).forEach((m) => {
    if (!m || !m.teams || m.teams.length < 2) return;
    const usIdx = m.teams.findIndex((t) => t.id === teamId);
    if (usIdx < 0) return;
    const themIdx = usIdx === 0 ? 1 : 0;
    const us = m.teams[usIdx], them = m.teams[themIdx];
    const ourScore = m.scores && m.scores[usIdx] != null ? m.scores[usIdx] : "-";
    const theirScore = m.scores && m.scores[themIdx] != null ? m.scores[themIdx] : "-";
    const done = /^\d+$/.test(ourScore) && /^\d+$/.test(theirScore);
    const row = {
      event: m.event || "",
      date: m.unix || null,
      opponent: them.name || "",
      opponentId: them.id || null,
      score: done ? ourScore + ":" + theirScore : null,
      win: done ? Number(ourScore) > Number(theirScore) : null,
      url: m.url || null,
    };
    if (done) out.recent.push(row);
    else out.upcoming.push(row);
  });
  out.upcoming.sort((a, b) => (a.date || 0) - (b.date || 0));
  out.recent.sort((a, b) => (b.date || 0) - (a.date || 0));
  out.upcoming = out.upcoming.slice(0, 5);
  out.recent = out.recent.slice(0, 8);
  return out;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const cfg = JSON.parse(fs.readFileSync(TEAMS_JSON, "utf8"));
  const all = cfg.teams || [];
  const targets = all.filter((t) => !opt.only.length || opt.only.indexOf(t.k) !== -1);
  if (!targets.length) { console.error("没有匹配的战队：" + opt.only.join(",")); process.exit(1); }

  let prev = {};
  if (opt.only.length && opt.keep && fs.existsSync(OUT_JS)) {
    const vm = require("vm");
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(OUT_JS, "utf8"), ctx);
    prev = ctx.window.HLTV_TEAMS || {};
  }

  const c = await connect(opt.port);
  console.log("CDP 已连接：" + c.browser + "（" + targets.length + " 队）");

  const store = Object.assign({}, prev);
  const report = [];

  for (const t of targets) {
    const t0 = Date.now();
    const ok = await c.nav(t.url, "h1.profile-team-name", 30000);
    if (!ok) { report.push({ k: t.k, ok: false, err: "页面未加载（Cloudflare 或超时）" }); console.error("✖ " + t.k + " 页面未加载"); continue; }
    await new Promise((r) => setTimeout(r, 500));

    /* 比赛表由页面脚本后置渲染：轮询直到出现数据，最多等 8 秒 */
    let d = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      try { d = await c.ev("(" + pageExtract.toString() + ")()"); }
      catch (e) { report.push({ k: t.k, ok: false, err: shortErr(e) }); console.error("✖ " + t.k + " 提取失败：" + shortErr(e)); d = null; break; }
      const n = d && d.matches ? d.matches.length : 0;
      if (n > 0 || attempt >= 6) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!d) continue;

    /* 图片清单：队标（两套）+ 国旗 + 阵容头像 */
    const jobs = []; // {url, rel}
    const dayUrl = d.logo.day || d.logo.single || null;
    const nightUrl = d.logo.night || d.logo.single || dayUrl;
    if (dayUrl) jobs.push({ url: dayUrl, kind: "logo", slot: "day" });
    if (nightUrl && nightUrl !== dayUrl) jobs.push({ url: nightUrl, kind: "logo", slot: "night" });
    const flagMap = {};
    const addFlag = (u) => { const code = flagCode(u); if (code && !flagMap[code]) flagMap[code] = u; };
    addFlag(d.countryFlag);
    (d.lineup || []).forEach((p) => addFlag(p.flag));
    if (d.stats && d.stats.coach) addFlag(d.stats.coach.flag);
    Object.keys(flagMap).forEach((code) => jobs.push({ url: flagMap[code], kind: "flag", code: code }));
    (d.lineup || []).forEach((p) => { if (p.avatar) jobs.push({ url: p.avatar, kind: "avatar", pid: p.id, nick: p.nick }); });

    let fetched = {};
    if (!opt.skipImages && jobs.length) {
      try { fetched = await c.ev("(" + pageImages.toString() + ")(" + JSON.stringify(jobs.map((j) => j.url)) + ")"); }
      catch (e) { console.error("  ⚠ " + t.k + " 图片下载失败：" + shortErr(e)); fetched = {}; }
    }

    const imgPath = (url, fallbackExt) => {
      const hit = fetched[url];
      if (hit && hit.b64) {
        const ext = sniffExt(Buffer.from(hit.b64, "base64"), url);
        return { rel: null, ext: ext, b64: hit.b64 };
      }
      return { rel: null, ext: fallbackExt || urlExt(url), b64: null };
    };

    const logo = { day: null, night: null };
    jobs.filter((j) => j.kind === "logo").forEach((j) => {
      const got = imgPath(j.url);
      const relPath = "assets/hltv/teams/" + t.k + "-" + j.slot + "." + got.ext;
      if (got.b64) writeImg(relPath, got.b64);
      logo[j.slot] = relPath;
      if (!got.b64 && opt.skipImages && !fs.existsSync(path.join(ROOT, relPath))) logo[j.slot] = null;
    });
    if (logo.day && !logo.night) logo.night = logo.day;
    if (logo.night && !logo.day) logo.day = logo.night;

    const flags = {};
    jobs.filter((j) => j.kind === "flag").forEach((j) => {
      const got = imgPath(j.url);
      const relPath = "assets/hltv/flags/" + j.code + "." + got.ext;
      if (got.b64) writeImg(relPath, got.b64);
      if (!got.b64 && opt.skipImages && !fs.existsSync(path.join(ROOT, relPath))) return;
      flags[j.code] = relPath;
    });

    const avatars = {};
    jobs.filter((j) => j.kind === "avatar").forEach((j) => {
      const got = imgPath(j.url);
      const relPath = "assets/hltv/players/" + t.k + "-" + (j.pid || j.nick) + "." + got.ext;
      if (got.b64) writeImg(relPath, got.b64);
      if (!got.b64 && opt.skipImages && !fs.existsSync(path.join(ROOT, relPath))) return;
      avatars[String(j.pid || j.nick)] = relPath;
    });

    const flagFor = (u) => { const code = flagCode(u); return code ? flags[code] || null : null; };

    const lineup = (d.lineup || []).map((p) => ({
      nick: p.nick,
      real: p.real || null,
      country: p.country || null,
      flag: flagFor(p.flag),
      igl: !!p.igl,
      id: p.id || null,
      url: p.url || null,
      avatar: p.id && avatars[String(p.id)] ? avatars[String(p.id)] : null,
    }));

    const coach = d.stats && d.stats.coach ? {
      name: d.stats.coach.name || null,
      real: d.stats.coach.real || null,
      country: d.stats.coach.country || null,
      flag: flagFor(d.stats.coach.flag),
      id: d.stats.coach.id || null,
      url: d.stats.coach.url || null,
    } : null;

    const valve = d.stats && d.stats.valve ? d.stats.valve : null;
    const world = d.stats && d.stats.world ? d.stats.world : null;

    store[t.k] = {
      k: t.k,
      id: t.id,
      name: d.name || t.n,
      localName: t.n,
      slug: t.slug,
      url: t.url,
      country: d.country || null,
      flag: flagFor(d.countryFlag),
      logo: logo.day ? logo : null,
      ranks: {
        valve: valve ? valve.rank : null,
        valveRegion: valve && valve.region ? valve.region.name : null,
        valveRegionShort: valve && valve.region ? valve.region.short : null,
        valveRegionRank: valve && valve.region ? valve.region.rank : null,
        world: world ? world.rank : null,
        worldRegion: world && world.region ? world.region.name : null,
        worldRegionRank: world && world.region ? world.region.rank : null,
      },
      weeksTop30: d.stats ? d.stats.weeksTop30 : null,
      avgAge: d.stats ? d.stats.avgAge : null,
      coach: coach,
      lineup: lineup,
      trophyCount: (d.trophies || []).length,
      trophies: (d.trophies || []).slice(0, 12),
      socials: d.socials || [],
      matches: normalizeMatches(d.matches, t.id),
    };

    report.push({ k: t.k, ok: true, lineup: lineup.length, trophies: (d.trophies || []).length, imgs: jobs.length, ms: Date.now() - t0 });
    console.log("✓ " + t.k.padEnd(11) + (d.name || "").padEnd(20) + "阵容 " + lineup.length + " · 奖杯 " + (d.trophies || []).length + " · 图 " + jobs.length + " · " + (Date.now() - t0) + "ms");
  }

  await c.close();

  /* 稳定排序：按 hltv-teams.json 的顺序输出 */
  const ordered = {};
  all.forEach((t) => { if (store[t.k]) ordered[t.k] = store[t.k]; });
  Object.keys(store).forEach((k) => { if (!ordered[k]) ordered[k] = store[k]; });

  const list = Object.keys(ordered);
  const withLineup = list.filter((k) => (ordered[k].lineup || []).length > 0).length;
  const meta = {
    updated: new Date().toISOString(),
    source: "hltv.org",
    teams: list.length,
    withLineup: withLineup,
    withRank: list.filter((k) => ordered[k].ranks && ordered[k].ranks.world != null).length,
  };

  const header =
    "/* =========================================================================\n" +
    " * HLTV 战队档案（自动生成，请勿手改）\n" +
    " * 生成脚本：tools/hltv-sync.js   ·   来源：https://www.hltv.org\n" +
    " * 字段：ranks（Valve / HLTV 世界排名 + 区域名次）、weeksTop30、avgAge、coach、\n" +
    " *       lineup（当前阵容：昵称/真名/国籍/指挥/头像）、trophyCount + trophies、\n" +
    " *       socials、matches（upcoming / recent，均以本队视角）。\n" +
    " * 说明：HLTV 不提供准星分享码，选手准星数据仍来自 prosettings.net。\n" +
    " * ====================================================================== */\n";

  fs.writeFileSync(OUT_JS,
    header +
    "window.HLTV_TEAMS = " + JSON.stringify(ordered, null, 0) + ";\n" +
    "window.HLTV_META = " + JSON.stringify(meta, null, 2) + ";\n", "utf8");

  console.log("\n写入 js/hltv-teams.js：" + list.length + " 队（" + withLineup + " 队有阵容） · " +
    Math.round(fs.statSync(OUT_JS).size / 1024) + " KB");
  const bad = report.filter((r) => !r.ok);
  if (bad.length) { console.log("失败 " + bad.length + " 队："); bad.forEach((b) => console.log("  " + b.k + " " + b.err)); process.exitCode = 1; }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
