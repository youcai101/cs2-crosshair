/* =========================================================================
 * Showkey · 数据自动更新工具
 * 从 prosettings.net 同步 CS2 职业选手的准星、外设、视频与历史记录
 * → 重新生成 js/players.js
 *
 * 用法:
 *   node tools/auto-update.js                 全量更新：所有页面重新抓取（默认，约 3-8 分钟）
 *   node tools/auto-update.js --cache         快速模式：6 小时内的缓存直接复用
 *   node tools/auto-update.js --max-age 1     配合 --cache，缓存有效期改为 1 小时
 *   node tools/auto-update.js --offline       只用本地缓存重建（不联网，秒级）
 *   node tools/auto-update.js --watch 6       每 6 小时自动全量更新一次
 *   node tools/auto-update.js --roster 8      每队最多保留 8 人
 *   node tools/auto-update.js --no-autoteam   不自动纳入新战队
 *   node tools/auto-update.js --logos          强制重抓全部队标（来源：液体百科）
 *   node tools/auto-update.js --no-dist       不重新生成 cs2-crosshair/ 静态包
 *
 * 队标来源：**液体百科（Liquipedia）**。默认只在本地文件缺失/损坏（非 PNG、<64px）时抓，
 * 想整体刷新用 --logos，或直接跑 node tools/liquipedia-logos.js --force。
 *
 * 数据格式（2026-10-16 起，prosettings 已完成新准星系统迁移）：
 *   选手页现在直接给新 convar 名（cl_crosshair_length / _thickness / _gap /
 *   _screen_height / cl_crosshairoutline_四通道 / cl_ironsight_ 系列）与文本样式名，
 *   不再给旧刻度、也不再给分享码；
 *   本脚本把新字段组装成 CrosshairV2 模型并生成 cs2-v1 分享码（c2 字段）。
 *   历史版本 API 每条带 legacy 标记：CSGO- 旧码与 CS 新码混合，按条目记录 lg。
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "js", "players.js");
const CACHE = path.join(__dirname, "cache");
const TEAMS_FILE = path.join(__dirname, "teams.json");
const STATE_FILE = path.join(__dirname, "last-update.json");
const REPORT_FILE = path.join(__dirname, "update-report.md");

const CS = require(path.join(ROOT, "js", "codec.js"));
// prosettings 页面解析（新旧双格式）抽成共享模块，check-freshness.js 也用同一份
const PS = require(path.join(__dirname, "prosettings-parse.js"));
// 队标来源：液体百科（Liquipedia），与 tools/liquipedia-logos.js 共用同一条图片管线
const LP = require(path.join(__dirname, "liquipedia-logos.js"));
const NEW_STYLE_MAP = PS.NEW_STYLE_MAP;
const UNKNOWN_STYLES = PS.UNKNOWN_STYLES;
const isNewFormatFields = PS.isNewFormatFields;
const fieldsToModelNew = PS.fieldsToModelNew;
const resH = PS.resHeight;

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/json,*/*",
};
const API = "https://prosettings.net/wp-json/pro/v2/players?game=468";
const HIST_API = "https://prosettings.net/wp-json/pro/v1/crosshair-pipeline/history?player_id=";

/* ---------------- 默认战队配置 ---------------- */
const DEFAULT_CONFIG = {
  version: 2,
  rosterLimit: 6,
  autoAddTeams: true,
  autoAddMinPlayers: 6,
  maxTeams: 64,
  excludePattern:
    "free agent|retired|content creator|academy|\\bjr\\b|\\bnxt\\b|impact|\\bfe\\b|female|streamer|unemployed",
  teams: [
    { k: "falcons", n: "Falcons", site: "Falcons Esports" },
    { k: "spirit", n: "Team Spirit", site: "Team Spirit" },
    { k: "furia", n: "FURIA", site: "FURIA Esports" },
    { k: "vitality", n: "Vitality", site: "Team Vitality" },
    { k: "mouz", n: "MOUZ", site: "MOUZ" },
    { k: "navi", n: "NAVI", site: "Natus Vincere" },
    { k: "9z", n: "9z", site: "9z Team" },
    { k: "aurora", n: "Aurora", site: "Aurora Gaming" },
    { k: "faze", n: "FaZe", site: "FaZe Clan" },
    { k: "g2", n: "G2", site: "G2 Esports" },
    { k: "astralis", n: "Astralis", site: "Astralis" },
    { k: "betboom", n: "BetBoom", site: "BetBoom Team" },
    { k: "mongolz", n: "The MongolZ", site: "The MongolZ" },
    { k: "parivision", n: "PARIVISION", site: "PARIVISION" },
    { k: "legacy", n: "Legacy", site: "Legacy" },
    { k: "pain", n: "paiN", site: "paiN Gaming" },
    { k: "fut", n: "FUT", site: "FUT Esports" },
    { k: "big", n: "BIG", site: "BIG" },
    { k: "b8", n: "B8", site: "B8 Esports" },
    { k: "liquid", n: "Liquid", site: "Team Liquid" },
    { k: "3dmax", n: "3DMAX", site: "3DMAX" },
    { k: "tyloo", n: "TYLOO", site: "TYLOO" },
    { k: "gamerlegion", n: "GamerLegion", site: "GamerLegion" },
    { k: "mibr", n: "MIBR", site: "MIBR" },
    { k: "nip", n: "NiP", site: "Ninjas in Pyjamas" },
    { k: "heroic", n: "HEROIC", site: "HEROIC" },
    { k: "100t", n: "100 Thieves", site: "100 Thieves" },
    { k: "lvg", n: "LVG", site: "Lynn Vision" },
    { k: "m80", n: "M80", site: "M80" },
    { k: "bcgame", n: "BC.Game", site: "BC.Game" },
    { k: "flyquest", n: "FlyQuest", site: "FlyQuest" },
  ],
};

/* 站名 → 本地 key 的兜底别名（规范化后仍对不上的） */
const NAME_ALIAS = {
  "natus vincere": "navi",
  navi: "navi",
  "ninjas in pyjamas": "nip",
  "lynn vision": "lvg",
  "lynn vision gaming": "lvg",
  "100 thieves": "100t",
};

/* 宽松匹配允许的附属词：Falcons Esports ✓ / Falcons Force ✗ / FUT Esports Academy ✗ */
const AFFIX = new Set([
  "", "esports", "gaming", "team", "the", "club", "gg", "official", "group",
  "organisation", "organization", "sports", "esport", "clan", "fc",
]);

/* =========================================================================
 * 【准星库范围 · 2026-10-17】只保留「近两年（2025-2026）打过 CS Major」的队伍。
 * 产品决策：库的定位是现役 Major 级选手的准星参考，非 Major 队不收录。
 *
 * 三届 Major 参赛队（来源：BLAST 官网 / StarLadder 官网 / IEM Cologne Major 2026
 * 官网与 ESL 公告，均为 32 队直邀制 VRS）：
 *   · BLAST.tv Austin Major 2025（06月，美国）
 *   · StarLadder Budapest Major 2025（11-12月，匈牙利）
 *   · IEM Cologne Major 2026（06月，德国）
 * 下面是与本站 teams.json 本地 key 的对应；站点侧出现新 Major 队时，
 * 需要在这里补 key（并在 tools/teams.json 加对应条目），否则不会被收录。
 * ========================================================================= */
const MAJOR_TEAMS = new Set([
  // —— 三届都参会的一线队 ——
  "falcons", "spirit", "furia", "vitality", "mouz", "navi", "aurora", "faze",
  "g2", "mongolz", "liquid", "tyloo", "flyquest",
  // —— Austin 2025 / Budapest 2025 ——
  "3dmax", "mibr", "m80", "pain", "legacy", "imperialesports", "metizport",
  "nemigagaming", "b8", "fluxo", "thehunsesports", "parivision",
  // —— Cologne 2026（及 Budapest 2025）——
  "astralis", "betboom", "fut", "big", "gamerlegion", "9z", "nip", "fnatic",
  "rareatom",   "heroic", "nrg", "lvg",
]);

/* 【2026-10-17 产品决策】以下战队的准星预览数据已按要求从库中移除，
 * 抓取与输出都必须排除；如后续需要恢复，删掉对应 key 后重跑更新即可。
 * 3dmax：2026-10-24 产品决策删除（HLTV 页是 2015 老队，阵容无法核验），
 * teams.json 已移除条目，这里再挡一道防止自动纳入。 */
const EXCLUDED_TEAMS = new Set([
  "imperialesports", "metizport", "nemigagaming",
  "thehunsesports", "fnatic", "fluxo",
  "3dmax",
]);

/* Major 参赛队的站点名（规范化后）→ 本地 key。
 * 运行时还会把 teams.json 里已跟踪的 Major 队并入本表（见 runUpdateInner），
 * 这里只补「尚未跟踪、但打过近两年 Major」的队（便于赛事后自动纳入）。 */
const MAJOR_SITE_EXTRA = {
  virtuspro: "virtuspro", complexity: "complexity", wildcard: "wildcard",
  bestia: "bestia", redcanids: "redcanids", sharksesports: "sharks",
  sinnersesports: "sinners", gaimingladiators: "gaimingladiators",
  thunderdownunder: "thunderdownunder", monte: "monte", passionua: "passionua",
  og: "og", chinggiswarriors: "chinggiswarriors",
};

const STYLE_MAP = {
  classic: 2,
  "classic static": 4,
  legacy: 5,
  "default dynamic": 0,
  "default static": 1,
  "classic dynamic": 3,
};
const COLOR_MAP = { red: 0, green: 1, yellow: 2, blue: 3, cyan: 4 };

/* ---------------- 新准星系统（2026-09-22 起）页面字段 ----------------
 * prosettings 改版后：准星表给的是新 convar 名 + 文本值（样式是名字、布尔是 Yes/No），
 * 且不再提供分享码 —— 由本脚本组装成 CrosshairV2 模型后生成 cs2-v1 码。
 * 解析逻辑（样式文本表 / 字段→模型 / 页面正则）见 tools/prosettings-parse.js，
 * 与 test/check-freshness.js 共用同一份，避免两处漂移。 */

/* 选手页上额外可抓取的设置项：[页面字段, 本地短键, 取值方式]
 *   默认按 data-field 取值；第三项为 "th" 时按 <th>文本</th> 取值。 */
const EXTRA_FIELDS = [
  ["windows_sensitivity", "winSens"],
  ["cl_crosshair_sniper_width", "sniperWidth"],
  ["brightness", "brightness"],
  ["display_mode", "displayMode"],
  ["boost_player_contrast", "boostContrast"],
  ["wait_for_vertical_sync", "vsync"],
  ["nvidia_reflex_low_latency", "reflex"],
  ["max_fps", "maxFps"],
  ["global_shadow_quality", "shadowQuality"],
  ["dynamic_shadows", "dynamicShadows"],
  ["model_texture_detail", "textureDetail"],
  ["texture_filtering_mode", "textureFiltering"],
  ["shader_detail", "shaderDetail"],
  ["particle_detail", "particleDetail"],
  ["ambient_occlusion", "ao"],
  ["high_dynamic_range", "hdr"],
  ["fidelityfx_super_resolution", "fsr"],
  ["Panel Tech", "panel", "th"],
  ["dyac", "dyac"],
  ["black_equalizer", "blackEq"],
  ["color_vibrance", "vibrance"],
  ["low_blue_light", "lowBlue"],
  ["picture_mode", "pictureMode"],
  ["contrast", "contrast"],
  ["sharpness", "sharpness"],
  ["gamma", "gamma"],
  ["color_temperature", "colorTemp"],
  ["ama", "ama"],
  ["digital_vibrance", "digitalVibrance"],
  ["Sensor", "sensor", "th"],
  ["Shape", "shape", "th"],
  ["Weight", "weight", "th"],
  ["Connection", "connection", "th"],
  ["actuation_point_l", "actL"],
  ["actuation_point_r", "actR"],
  ["rapid_trigger_l", "rtL"],
  ["rapid_trigger_r", "rtR"],
  ["click_feedback_l", "cfL"],
  ["click_feedback_r", "cfR"],
  ["lift_off_distance", "lod"],
  ["bhop_mode", "bhop"],
];

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function thField(html, label) {
  const m = html.match(new RegExp("<th>" + escapeRe(label) + "</th>\\s*<td[^>]*>([\\s\\S]*?)</td>"));
  return m ? strip(m[1]) : "";
}

/* ---------------- 小工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const strip = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).slice(0, 24) || "team";

/* prosettings 页面里的 <picture> 图标地址。**队标已不再用它**（改走液体百科），
 * 但外设/赞助等其它字段仍可能复用，保留。 */
function imgFromPicture(html, size) {
  const m = String(html || "").match(new RegExp('src="([^"]*' + size + '[^"]*)"'));
  if (m) return m[1];
  const any = String(html || "").match(/src="([^"]+)"/);
  return any ? any[1] : "";
}

/* 现有队标文件能不能直接用：必须是 PNG（历史上出现过 SVG 文本冒充 PNG、
 * JPEG 冒充 PNG 的坏文件）、且不小于 64px（曾经的 24×24 小图放大到 44px 会糊）。
 * 不合格就当作「缺失」，交给液体百科重抓。 */
function isUsableLogo(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return false;
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    return w >= 64 && h >= 64;
  } catch (e) {
    return false;
  }
}

/* HLTV 阵容快照（js/hltv-teams.js，由 tools/hltv-sync.js 生成）里的现役名单。
 * prosettings 的归队信息滞后于 HLTV：转会窗后索引里还挂着已离队/退役的人，
 * 新援也常没有自己的索引条目。这里只做「现役过滤 + 补漏」，不引入 HLTV 的任何外链。 */
function readHltvLineups() {
  const file = path.join(ROOT, "js", "hltv-teams.js");
  const out = new Map();
  try {
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx);
    const teams = ctx.window.HLTV_TEAMS || {};
    Object.keys(teams).forEach((k) => {
      const lineup = (teams[k] && teams[k].lineup) || [];
      if (lineup.length) out.set(k, lineup);
    });
  } catch (e) { /* 没有快照就退回纯 prosettings 口径 */ }
  return out;
}

/* 昵称归一：与前端 js/app.js 的 nickKey 保持同一套规则，避免两边口径漂移 */
const NICK_ALIAS = { techno4k: "techno" };
const nickKey = (s) => {
  const n = String(s || "").toLowerCase().trim().replace(/[-_.]+$/, "");
  return NICK_ALIAS[n] || n;
};

/* 补漏用的玩家条目：HLTV 阵容里有、prosettings 索引里查不到的人，
 * 用 hl-<team>-<nick> 作为稳定 id，url 直接指向其 prosettings 主页 slug，
 * 抓不到页面时按「无数据」跳过（不写空记录）。 */
function synthPlayer(teamKey, member) {
  const nick = String(member.nick || "").trim();
  if (!nick) return null;
  return {
    name: nick,
    id: "hl-" + teamKey + "-" + norm(nick),
    url: "https://prosettings.net/players/" + norm(nick) + "/",
    nationality: member.country || "",
    image: "",
    team: null,
    synthetic: true,
  };
}

/* 中断信号：用户主动取消时必须「整体中止且不写盘」。
 * 曾经的 bug：中途 break 后仍继续走完写盘流程，把空名单写进 players.js，
 * 造成 300+ 名选手被清空。现在统一抛 UpdateAborted，由 runUpdate 捕获。 */
class UpdateAborted extends Error {
  constructor(msg) {
    super(msg || "更新已取消");
    this.name = "UpdateAborted";
    this.aborted = true;
  }
}

/* 写盘前的数据量守卫：
 *   真实抓取失败（断网、站点改版、反爬）往往表现为「成功 0 人」或「人数骤降」，
 *   此时宁可保留旧数据并报错，也绝不写入残缺名单。 */
function rosterGuard(prosOut, oldPros) {
  var MIN_PLAYERS = 20;      // 少于该人数一律视为抓取异常
  var MIN_KEEP_RATIO = 0.5;  // 相对现有规模骤降超过一半同样视为异常
  if (!prosOut.length) {
    return "本次抓取得到 0 名选手（网络异常或站点结构变化），已放弃写入以保护现有数据";
  }
  if (prosOut.length < MIN_PLAYERS) {
    return "本次仅抓取到 " + prosOut.length + " 名选手（低于安全阈值 " + MIN_PLAYERS +
      "），已放弃写入以保护现有数据";
  }
  if (oldPros.length >= MIN_PLAYERS * 2) {
    // 「只收 Major 队」是有意的范围过滤：基线取旧数据里同属 Major 队的人数，
    // 避免把有意缩减误判为抓取异常（2026-10-17 加入）。
    var majorOld = oldPros.filter(function (p) { return MAJOR_TEAMS.has(p.t); }).length;
    var base = majorOld >= MIN_PLAYERS ? majorOld : oldPros.length;
    if (prosOut.length < Math.floor(base * MIN_KEEP_RATIO)) {
      return "本次仅抓取到 " + prosOut.length + " 名选手，远少于现有的 " + base +
        " 名（Major 范围），已放弃写入以保护现有数据";
    }
  }
  return null;
}

/* ========================= 主流程 ========================= */
async function runUpdate(opts = {}) {
  const onLine = typeof opts.onLine === "function" ? opts.onLine : (s) => console.log(s);
  try {
    return await runUpdateInner(opts);
  } catch (e) {
    if (e && e.aborted) {
      onLine("  ⏹ 更新已取消 · js/players.js 与现有数据均未改动");
      return {
        ok: false,
        aborted: true,
        kept: true,
        error: "更新已取消，数据未改动",
        durationMs: 0,
      };
    }
    throw e;
  }
}

async function runUpdateInner(opts = {}) {
  const started = Date.now();
  const cfg = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
  const offline = !!opts.offline;
  // 默认「全量最新」：只要联网就重新抓取，缓存仅作为失败回退与 --cache 加速用
  const fresh = offline ? false : opts.fresh === undefined ? !opts.useCache : !!opts.fresh;
  const maxAgeHours = Number(opts.maxAgeHours || (opts.useCache ? 6 : 0));
  const rosterLimit = Number(opts.rosterLimit || cfg.rosterLimit || 6);
  const autoAddTeams = opts.autoAddTeams === undefined ? cfg.autoAddTeams !== false : !!opts.autoAddTeams;
  const autoAddMin = Number(opts.autoAddMinPlayers || cfg.autoAddMinPlayers || 6);
  const maxTeams = Number(opts.maxTeams || cfg.maxTeams || 64);
  const onLine = typeof opts.onLine === "function" ? opts.onLine : (s) => console.log(s);
  const shouldStop = typeof opts.shouldStop === "function" ? opts.shouldStop : () => false;

  const say = (s) => onLine(String(s));

  fs.mkdirSync(CACHE, { recursive: true });

  // 载入现有数据（保留 logo / 位置 / 做差异对比）
  let OLD_TEAMS = [];
  let OLD_PROS = [];
  if (fs.existsSync(OUT)) {
    try {
      const ctx = { window: {} };
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(OUT, "utf8"), ctx);
      OLD_TEAMS = ctx.window.PRO_TEAMS || [];
      OLD_PROS = ctx.window.PRO_PLAYERS || [];
    } catch (e) {
      say("⚠ 读取旧数据失败：" + e.message);
    }
  }

  // 载入 / 初始化战队配置
  let fileCfg = null;
  if (fs.existsSync(TEAMS_FILE)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(TEAMS_FILE, "utf8"));
    } catch (e) {
      say("⚠ teams.json 解析失败，使用内置默认值：" + e.message);
    }
  }
  if (fileCfg && Array.isArray(fileCfg.teams) && fileCfg.teams.length) {
    cfg.teams = fileCfg.teams;
    if (fileCfg.excludePattern) cfg.excludePattern = fileCfg.excludePattern;
    if (typeof fileCfg.autoAddTeams === "boolean" && opts.autoAddTeams === undefined) {
      cfg.autoAddTeams = fileCfg.autoAddTeams;
    }
  }
  const excludeRe = new RegExp(cfg.excludePattern || DEFAULT_CONFIG.excludePattern, "i");

  /* ---------- 0. Major 范围过滤（产品决策：只收近两年 Major 队） ---------- */
  const teamsAll = cfg.teams;
  const beforeTeams = teamsAll.length;
  const excluded = teamsAll.filter((t) => EXCLUDED_TEAMS.has(t.k)).length;
  cfg.teams = teamsAll.filter((t) => MAJOR_TEAMS.has(t.k) && !EXCLUDED_TEAMS.has(t.k));
  const droppedTeams = beforeTeams - cfg.teams.length;
  if (droppedTeams > 0) {
    say("  ℹ 已按范围过滤，跳过 " + droppedTeams + " 支战队（非 Major " +
      (droppedTeams - excluded) + " · 手动排除 " + excluded + "）");
  }
  // 站点名 → Major 本地 key：已跟踪的 Major 队 + 尚未跟踪的 Major 队
  const majorSiteKey = Object.assign({}, MAJOR_SITE_EXTRA);
  teamsAll.forEach((t) => { if (MAJOR_TEAMS.has(t.k) && t.site) majorSiteKey[norm(t.site)] = t.k; });

  /* ---------- 1. 选手索引 ---------- */
  say("① 拉取 prosettings.net 选手索引…");
  const index = await fetchIndex({ fresh, offline, maxAgeHours, say, shouldStop });
  const siteTeams = new Map();
  const playersById = new Map();
  index.players.forEach((p) => {
    if (!playersById.has(p.id)) playersById.set(p.id, p);
  });
  index.teams.forEach((t) => siteTeams.set(t.name, t));
  say("  站点返回 " + playersById.size + " 名选手 · " + siteTeams.size + " 支战队");

  const bySiteTeam = new Map();
  playersById.forEach((p) => {
    const t = siteTeams.get(index.teamNameById.get(p.team));
    if (!t) return;
    if (!bySiteTeam.has(t.name)) bySiteTeam.set(t.name, []);
    bySiteTeam.get(t.name).push(p);
  });

  /* ---------- 2. 战队匹配 ---------- */
  say("② 匹配战队…");
  // 精确匹配：规范化后完全相等，或命中别名表
  const exactSite = (name) => {
    const alias = NAME_ALIAS[String(name).toLowerCase()];
    if (alias) return alias;
    const n = norm(name);
    for (const t of cfg.teams) {
      if (t.site && norm(t.site) === n) return t.k;
      if (n === norm(t.k) || n === norm(t.n)) return t.k;
    }
    return null;
  };
  // 宽松匹配：只允许「Esports / Gaming / Team / Club …」这类无意义附属词，
  // 避免 Falcons Force、FUT Esports Academy、MOUZ NXT 抢走正队。
  const looseSite = (name) => {
    const n = norm(name);
    for (const t of cfg.teams) {
      for (const cand of [norm(t.k), norm(t.n)]) {
        if (cand.length < 2 || n === cand) continue;
        if (n.indexOf(cand) === 0 && AFFIX.has(n.slice(cand.length))) return t.k;
        if (n.length > cand.length && n.lastIndexOf(cand) === n.length - cand.length &&
            AFFIX.has(n.slice(0, n.length - cand.length))) return t.k;
      }
    }
    return null;
  };

  const assignedSite = new Set();
  cfg.teams.forEach((t) => {
    if (t.site && bySiteTeam.has(t.site)) assignedSite.add(t.site);
  });
  cfg.teams.forEach((t) => {
    if (t.site && bySiteTeam.has(t.site)) return;
    let hit = null;
    for (const st of siteTeams.keys()) {
      if (assignedSite.has(st)) continue;
      if (exactSite(st) === t.k) { hit = st; break; }
    }
    if (!hit) {
      for (const st of siteTeams.keys()) {
        if (assignedSite.has(st)) continue;
        if (looseSite(st) === t.k) { hit = st; break; }
      }
    }
    if (hit) {
      t.site = hit;
      assignedSite.add(hit);
    } else {
      delete t.site;
    }
  });
  const unmatchedLocal = cfg.teams.filter((t) => !t.site);
  if (unmatchedLocal.length) {
    say("  ⚠ 未在站点找到的战队（将跳过）：" + unmatchedLocal.map((t) => t.n).join("、"));
  }

  const knownKeys = new Set(cfg.teams.map((t) => t.k));
  const candidates = [];
  bySiteTeam.forEach((list, siteName) => {
    if (cfg.teams.some((t) => t.site === siteName)) return;
    if (excludeRe.test(siteName)) return;
    candidates.push({ siteName, count: list.length });
  });
  candidates.sort((a, b) => b.count - a.count || a.siteName.localeCompare(b.siteName));

  const addedTeams = [];
  if (autoAddTeams) {
    for (const c of candidates) {
      if (cfg.teams.length >= maxTeams) break;
      if (c.count < autoAddMin) continue;
      // 只自动纳入「近两年 Major 参赛队」；新 Major 队需在 MAJOR_TEAMS 补 key
      const mk = majorSiteKey[norm(c.siteName)];
      if (!mk || EXCLUDED_TEAMS.has(mk)) continue;
      let key = mk;
      let n = 2;
      while (knownKeys.has(key)) key = mk + n++;
      knownKeys.add(key);
      const entry = { k: key, n: c.siteName, site: c.siteName, auto: true };
      cfg.teams.push(entry);
      addedTeams.push(entry);
      say("  ＋ 自动纳入新战队 " + c.siteName + "（" + c.count + " 人）");
    }
  }
  const rest = candidates
    .filter((c) => c.count >= 4 && !cfg.teams.some((t) => t.site === c.siteName))
    .slice(0, 14);
  if (rest.length) {
    say("  ℹ 未纳入的战队（可在 tools/teams.json 手动添加）：" +
      rest.map((c) => c.siteName + "(" + c.count + ")").join(", "));
  }
  say("  实际跟踪 " + cfg.teams.length + " 支战队");

  /* ---------- 3. 补齐缺失队标（来源：液体百科 Liquipedia） ----------
   * 曾经这里从 prosettings 的 48x48 图标下载，但那是**第三方缩略图**：尺寸小、格式杂，
   * 还出现过 SVG 文本冒充 PNG、JPEG 冒充 PNG 的坏文件。现在统一改走液体百科：
   * 取站点官方队徽（lightmode/darkmode/allmode 三版之一），去白底、裁边、
   * 居中压成 128×128 透明 PNG，并挑「接近正方形 + 在深色主题下看得见」的那张。
   * 本地已有合法 PNG 的直接跳过（不重复打接口，液体百科硬性限速 2s/次）。 */
  const oldLogo = new Map(OLD_TEAMS.map((t) => [t.k, t.logo]));
  let logoDone = 0, logoFail = 0;
  for (const t of cfg.teams) {
    t.logo = oldLogo.get(t.k) || "assets/teams/" + t.k + ".png";
    const abs = path.join(ROOT, t.logo.split("/").join(path.sep));
    if (!opts.forceLogos && isUsableLogo(abs)) continue;
    if (offline) { say("  · 离线模式，跳过队标 " + t.k); continue; }
    try {
      say("  ⤓ 从液体百科取队标 " + t.k + "（" + (t.site || t.n) + "）");
      const res = await LP.resolveLogo(t.site || t.n, (m) => say("     " + m.trim()));
      if (res.status !== "ok") { logoFail++; say("  ⚠ 液体百科没有可用队徽 " + t.k + "（" + res.status + "）"); continue; }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, res.built.buffer);
      logoDone++;
      say("    ✓ " + res.imageName + "（形状 " + res.shape.toFixed(2) +
        "，深色可见度 " + res.contrast.toFixed(0) + "）");
    } catch (e) {
      logoFail++;
      say("  ⚠ 队标抓取失败 " + t.k + "：" + e.message);
    }
  }
  if (logoDone) say("  共写入 " + logoDone + " 个队标（液体百科）");
  if (logoFail) say("  " + logoFail + " 支队伍暂时没取到队标，沿用了原有文件");

  /* ---------- 4. 抓取选手页 ---------- */
  // 名单口径：有 HLTV 快照的战队按「现役阵容」取人（转会/退役即时生效），
  // 没有快照的战队退回 prosettings 的归队信息（按人数取前 rosterLimit 名）。
  const hltvLineups = readHltvLineups();
  // 昵称可能重名（如 Zero 同时属于 TYLOO 与已退役名单）：按「战队 → 昵称」两级索引，
  // 先认同一支战队的人，再退回全库第一个同名条目。
  const nickToPlayers = new Map();
  playersById.forEach((p) => {
    const k = nickKey(p.name);
    if (!nickToPlayers.has(k)) nickToPlayers.set(k, []);
    nickToPlayers.get(k).push(p);
  });
  const siteNameOf = (p) => index.teamNameById.get(p.team) || "";
  const pickPlayer = (nick, site) => {
    const list = nickToPlayers.get(nickKey(nick)) || [];
    if (!list.length) return null;
    const sameTeam = list.filter((p) => siteNameOf(p) === site);
    return sameTeam[0] || list[0];
  };
  const jobs = [];
  const seenJob = new Set();
  let filled = 0, missing = 0;
  cfg.teams.forEach((t) => {
    const lineup = t.site ? hltvLineups.get(t.k) : null;
    if (lineup && lineup.length) {
      lineup.forEach((m) => {
        const hit = pickPlayer(m.nick, t.site);
        const player = hit || synthPlayer(t.k, m);
        if (!player) return;
        const jk = t.k + "|" + nickKey(player.name);
        if (seenJob.has(jk)) return;
        seenJob.add(jk);
        if (!hit) missing++;
        jobs.push({ player: player, teamKey: t.k, siteTeam: t.site });
      });
    } else {
      (bySiteTeam.get(t.site) || []).slice(0, rosterLimit).forEach((p) => {
        const jk = t.k + "|" + nickKey(p.name);
        if (seenJob.has(jk)) return;
        seenJob.add(jk);
        filled++;
        jobs.push({ player: p, teamKey: t.k, siteTeam: t.site });
      });
    }
  });
  say("③ 抓取选手页（" + jobs.length + " 名 · 索引缺条目补抓 " + missing + " 名 · 回退归队口径 " + filled + " 名）…");

  const oldByName = new Map(OLD_PROS.map((p) => [String(p.n).toLowerCase(), p]));
  const results = [];
  const failed = [];
  let done = 0;
  for (const job of jobs) {
    if (shouldStop()) throw new UpdateAborted();
    const slugName = job.player.url.replace(/\/$/, "").split("/").pop();
    try {
      const html = await fetchText(job.player.url, "pl-" + slugName + ".html", { fresh, offline, maxAgeHours, say });
      const parsed = parseCrosshair(html);
      const info = parseInfo(html);
      const newFmt = isNewFormatFields(parsed.fields);
      if (!newFmt && !parsed.fields["cl_crosshairsize"] && !parsed.rects.length) {
        failed.push(job.player.name);
        continue;
      }
      let c2 = null;
      let cLegacy = null;
      let meta = null;
      if (newFmt) {
        // 新格式页面：新 convar 名 → CrosshairV2 模型 → cs2-v1 分享码（精确，无换算）
        const model = fieldsToModelNew(parsed.fields);
        // 页面缺 screen_height 时（见过个案），用该选手的分辨率高度兜底，不猜 1080
        if (!parsed.fields["cl_crosshair_screen_height"]) {
          model.screenHeight = resH(info);
        }
        c2 = CS.encodeShareCode(model);
        meta = { fmt: "cs2-v1", from: "prosettings", h: model.screenHeight, lossy: false };
      } else {
        // 旧格式页面（站点过渡期残留）：旧 convar 名 → 旧刻度 → legacy 码，再按该选手分辨率有损转换
        const settings = fieldsToSettings(parsed.fields);
        cLegacy = CS.encodeLegacy(settings);
        const conv = CS.decodeInfo(cLegacy, { screenHeight: resH(info) });
        c2 = CS.encodeShareCode(conv.model);
        meta = { fmt: "cs2-v1", from: "legacy-v1", h: conv.model.screenHeight, lossy: true };
      }
      results.push({
        player: job.player,
        teamKey: job.teamKey,
        slug: slugName,
        c2: c2,
        c: cLegacy,
        m: meta,
        rects: parsed.rects,
        info: info,
      });
    } catch (e) {
      failed.push(job.player.name + "(" + e.message + ")");
    }
    done++;
    if (done % 5 === 0 || done === jobs.length) {
      onLine("  进度 " + done + "/" + jobs.length + " · 成功 " + results.length + " · 失败 " + failed.length);
    }
    await sleep(120);
  }
  say("  抓取完成：成功 " + results.length + " · 失败/无数据 " + failed.length);

  /* ---------- 5. 历史版本 ---------- */
  say("④ 同步官方历史检测记录…");
  const prosOut = [];
  const changes = [];
  let migrated = 0; // 旧数据无 c2 可比 → 首次迁移（不计入「准星变动」）
  for (const r of results) {
    if (shouldStop()) throw new UpdateAborted();
    let hist = [];
    try {
      hist = await fetchHistory(r.player.id, r.slug, { fresh, offline, maxAgeHours, say });
    } catch (e) { /* 单条失败忽略 */ }
    const old = oldByName.get(String(r.player.name).toLowerCase());
    const oldC2 = old && old.c2 ? old.c2 : null;
    if (old && oldC2 && oldC2 !== r.c2) changes.push({ name: r.player.name, from: oldC2, to: r.c2 });
    else if (old && !oldC2) migrated++;
    // 与当前码相同的那条历史带着「何时 / 哪场比赛检测到」，单独存进 cs 再过滤，不随 h 丢弃
    const curHit = hist.find((e) => e.c === r.c2) || null;
    prosOut.push({
      n: r.player.name,
      t: r.teamKey,
      r: (old && old.r) || "Rifler",
      f: String(r.player.nationality || "").toLowerCase(),
      c: r.c || undefined,          // 旧格式分享码：仅当源页面仍是旧格式时才存在
      c2: r.c2,                      // cs2-v1 新分享码（当前准星）
      m: r.m,                        // 迁移元数据 {fmt, from, h, lossy}
      cs: curHit ? { d: curHit.d || "", s: curHit.s || "", n: curHit.n || 1 } : undefined,
      x: r.rects,
      i: r.info,
      u: r.player.url,
      h: hist.filter((e) => e.c !== r.c2).slice(0, 12),
    });
    onLine("  历史 " + prosOut.length + "/" + results.length);
    await sleep(90);
  }
  if (UNKNOWN_STYLES.size) {
    say("  ⚠ 未能识别的样式文本（按默认样式 4 处理，请反馈给维护者）：" +
      [...UNKNOWN_STYLES].join("、"));
  }
  if (PS.UNKNOWN_OUTLINES.size) {
    say("  ⚠ 未能识别的描边文本（按无描边处理，请反馈给维护者）：" +
      [...PS.UNKNOWN_OUTLINES].join("、"));
  }

  /* ---------- 6. 写出 ---------- */
  // 安全闸门：抓取结果异常（0 人 / 人数骤降）时绝不覆盖现有数据
  const guardError = rosterGuard(prosOut, OLD_PROS);
  if (guardError) {
    say("");
    say("✖ 更新中止：" + guardError);
    const failedSummary = {
      ok: false,
      error: guardError,
      kept: true,
      players: OLD_PROS.length,
      teams: OLD_TEAMS.length,
      withHistory: OLD_PROS.filter((p) => p.h && p.h.length).length,
      addedTeams: [],
      addedPlayers: [],
      removedPlayers: [],
      changedCrosshairs: [],
      failed: failed.slice(0, 20),
      updatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(failedSummary, null, 2), "utf8");
    fs.writeFileSync(REPORT_FILE, buildReport(failedSummary), "utf8");
    say("  → 已保留原有 " + OLD_PROS.length + " 名选手数据，js/players.js 未做任何改动");
    return failedSummary;
  }

  const teamsOut = cfg.teams.map((t) => ({ k: t.k, n: t.n, logo: t.logo }));
  const oldNames = new Set(OLD_PROS.map((p) => p.n));
  const newNames = new Set(prosOut.map((p) => p.n));
  const added = prosOut.filter((p) => !oldNames.has(p.n)).map((p) => p.n);
  const removed = OLD_PROS.filter((p) => !newNames.has(p.n)).map((p) => p.n);
  const updatedAt = new Date().toISOString();

  const meta = {
    updated: updatedAt,
    source: "prosettings.net",
    players: prosOut.length,
    teams: teamsOut.length,
    withHistory: prosOut.filter((p) => p.h.length).length,
    codeFormat: "cs2-v1",
    newFormat: prosOut.filter((p) => p.m && p.m.from === "prosettings").length,
    legacyFormat: prosOut.filter((p) => p.m && /^legacy/.test(p.m.from)).length,
  };

  const header =
    "/* CS2 职业选手准星数据 · 由 tools/auto-update.js 自动生成，请勿手改\n" +
    " * 数据源: prosettings.net · 更新于 " + updatedAt + "\n" +
    " * 更新方式: node tools/auto-update.js（离线 CLI，详见 README 第三节）\n" +
    " * 已排除战队: Imperial / Metizport / Nemiga Gaming / The Huns / Fnatic / Fluxo（见 EXCLUDED_TEAMS）\n" +
    " * PRO_META:    {updated, source, players, teams, withHistory, codeFormat, newFormat, legacyFormat}\n" +
    " * PRO_TEAMS:   {k: 战队标识, n: 队名, logo: 队标路径}\n" +
    " * PRO_PLAYERS: {n: 姓名, t: 战队标识, r: 位置, f: 国家码,\n" +
    " *               c:  旧格式分享码（仅当源页面仍是旧格式时存在）,\n" +
    " *               c2: cs2-v1 新分享码（当前准星，新准星系统唯一有效格式）,\n" +
    " *               m:  {fmt, from, h, lossy} 迁移元数据 ——\n" +
    " *                   from=prosettings 表示抓自新格式页面（精确）；\n" +
    " *                   from=legacy-v1 表示旧码/旧页面有损转换而来（前端按源数据时代判新旧）,\n" +
    " *               x: 当前准星官方矩形数据 [x,y,w,h,r,g,b,a],\n" +
    " *               cs: 当前准星的检测来源 {d:日期, s:比赛来源, n:出现次数}（取自与 c2 相同的历史条目）,\n" +
    " *               i: {real,born,country,dpi,sens,edpi,zoom,hz,res,aspect,scaling,refresh,\n" +
    " *                   vm:{fov,ox,oy,oz,preset,...}, radar:{scale,hudScale,centered,...}},\n" +
    " *               u: prosettings 主页链接,\n" +
    " *               h: 历史准星 [{c:码, d:检测日期, s:比赛来源, n:出现次数, lg:是否旧时代源数据}]}\n" +
    " */";

  // 写前备份：把现有 players.js 复制到 tools/cache/（gitignored），保证可回滚
  try {
    if (fs.existsSync(OUT)) {
      fs.copyFileSync(OUT, path.join(CACHE, "players-backup-" + updatedAt.slice(0, 10) + ".js"));
    }
  } catch (e) { /* 备份失败不阻断更新（rosterGuard 仍会防异常覆盖） */ }

  const body =
    header + "\n" +
    "window.PRO_META = " + JSON.stringify(meta) + ";\n" +
    "window.PRO_TEAMS = " + JSON.stringify(teamsOut) + ";\n" +
    "window.PRO_PLAYERS = " + JSON.stringify(prosOut) + ";\n";

  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, OUT);

  // 版本号缓存击穿：把 index.html 里的 ?v=xxx 换成新版本，
  // 否则浏览器会一直用旧的 players.js（这正是「更新了但不是最新」的常见原因）
  const assetVer = bumpAssetVersion();
  say("  ↻ 资源版本号 -> ?v=" + assetVer);

  const cfgOut = Object.assign({}, DEFAULT_CONFIG, fileCfg || {}, {
    version: 2,
    rosterLimit,
    autoAddMinPlayers: autoAddMin,
    maxTeams,
    teams: cfg.teams,
  });
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(cfgOut, null, 2), "utf8");

  const summary = {
    ok: failed.length === 0,
    players: prosOut.length,
    teams: teamsOut.length,
    withHistory: meta.withHistory,
    addedTeams: addedTeams.map((t) => t.n),
    addedPlayers: added,
    removedPlayers: removed,
    changedCrosshairs: changes,
    migrated: migrated,
    newFormat: meta.newFormat,
    legacyFormat: meta.legacyFormat,
    unknownStyles: [...UNKNOWN_STYLES].concat([...PS.UNKNOWN_OUTLINES].map((t) => "描边文本:" + t)),
    failed,
    updatedAt,
    durationMs: Date.now() - started,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(REPORT_FILE, buildReport(summary), "utf8");

  say("");
  say("✔ 更新完成 · " + summary.teams + " 队 " + summary.players +
    " 人（含历史 " + summary.withHistory + " 人）· 用时 " + Math.round(summary.durationMs / 1000) + "s");
  say("  准星码格式：新格式页面 " + summary.newFormat + " 人 · 旧格式页面 " + summary.legacyFormat + " 人" +
    (summary.migrated ? " · 首次迁移 " + summary.migrated + " 人（旧数据无 c2 可比）" : ""));
  if (addedTeams.length) say("  ＋ 新战队 " + addedTeams.map((t) => t.n).join("、"));
  if (added.length) say("  ＋ 新选手 " + added.length + " 名：" + added.slice(0, 20).join("、") + (added.length > 20 ? " …" : ""));
  if (removed.length) say("  － 离队/移除 " + removed.length + " 名：" + removed.slice(0, 20).join("、"));
  if (changes.length) say("  ↻ 准星变动 " + changes.length + " 名：" + changes.slice(0, 12).map((c) => c.name).join("、") + (changes.length > 12 ? " …" : ""));
  say("  → 已写入 js/players.js · 报告 tools/update-report.md");

  // 同步刷新静态发布包（如果之前生成过）
  if (!opts.noDist && fs.existsSync(path.join(ROOT, "cs2-crosshair"))) {
    try {
      const { build } = require("./build-dist.js");
      if (typeof build === "function") {
        build({ silent: true });
        say("  → 已同步 cs2-crosshair/ 静态包");
      }
    } catch (e) {
      say("  ⚠ 静态包同步失败：" + e.message);
    }
  }

  return summary;
}

/* 把 index.html 里 css/js 的 ?v= 换成新的时间戳版本号 */
function bumpAssetVersion() {
  try {
    const idx = path.join(ROOT, "index.html");
    const html = fs.readFileSync(idx, "utf8");
    const ver = String(Math.floor(Date.now() / 1000)).slice(-7);
    const next = html.replace(/(\.(?:css|js))\?v=[A-Za-z0-9._-]+/g, "$1?v=" + ver);
    if (next !== html) fs.writeFileSync(idx, next, "utf8");
    return ver;
  } catch (e) {
    return "?";
  }
}

/* ========================= 抓取 ========================= */
async function fetchIndex(o) {
  const players = [];
  const teams = [];
  const teamNameById = new Map();
  for (let page = 1; page < 200; page++) {
    if (o.shouldStop && o.shouldStop()) throw new UpdateAborted();
    const raw = await fetchText(API + "&page=" + page + "&per_page=20", "idx-" + page + ".json", o);
    const j = JSON.parse(raw);
    (j.teams || []).forEach((t) => {
      teamNameById.set(t.id, t.name);
      if (!teams.some((x) => x.name === t.name)) teams.push(t);
    });
    (j.players || []).forEach((p) => players.push(p));
    o.say("  索引页 " + page + " · 累计 " + players.length + " 名选手");
    if (!j.players || j.players.length === 0) break;
    await sleep(80);
  }
  return { players, teams, teamNameById };
}

async function fetchText(url, cacheName, o) {
  const cf = cacheName ? path.join(CACHE, cacheName) : null;
  if (cf && fs.existsSync(cf) && cacheFresh(cf, o)) return fs.readFileSync(cf, "utf8");
  if (o.offline) {
    if (cf && fs.existsSync(cf)) return fs.readFileSync(cf, "utf8");
    throw new Error("离线模式下无缓存：" + cacheName);
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (cf) fs.writeFileSync(cf, text);
      return text;
    } catch (e) {
      lastErr = e;
      await sleep(900 * (attempt + 1));
    }
  }
  if (cf && fs.existsSync(cf)) {
    o.say("  ⚠ 网络失败，回退到旧缓存：" + cacheName);
    return fs.readFileSync(cf, "utf8");
  }
  throw lastErr;
}

async function fetchBinary(url, cacheName, o) {
  const cf = cacheName ? path.join(CACHE, cacheName) : null;
  if (cf && fs.existsSync(cf) && cacheFresh(cf, o)) return fs.readFileSync(cf);
  if (o.offline) return cf && fs.existsSync(cf) ? fs.readFileSync(cf) : null;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (cf) fs.writeFileSync(cf, buf);
  return buf;
}

function cacheFresh(file, o) {
  if (o.fresh) return false;
  try {
    return Date.now() - fs.statSync(file).mtimeMs < (o.maxAgeHours || 24) * 3600 * 1000;
  } catch (e) {
    return false;
  }
}

async function fetchHistory(id, slugName, o) {
  try {
    const raw = await fetchText(HIST_API + id, "hist-" + slugName + ".json", o);
    const j = JSON.parse(raw);
    // 每条历史带 legacy 标记（API 字段）；没有该字段时按容器兜底判定。
    // 只存原码 + 时代标记，换算交给前端按需做（前端知道该选手的分辨率，换算更准）。
    return (j.history || [])
      .map((e) => {
        const code = e.crosshair_code;
        const lg = e.legacy === true || (e.legacy == null && /^CSGO-/.test(code || ""));
        return {
          c: code,
          d: (e.detected_at || "").slice(0, 10),
          s: e.source || "",
          n: e.seen_count || 1,
          lg: lg,
        };
      })
      .filter((e) => e.c);
  } catch (e) {
    return [];
  }
}

/* ========================= 解析 ========================= */
function parseCrosshair(html) {
  return { fields: PS.parseCrosshairFields(html), rects: PS.parseCrosshairRects(html) };
}

function field(html, name) {
  return PS.fieldOf(html, name);
}

/* Equipment 区的外设型号（cta-box 卡片：h4 里是型号名，尾部 tag 是类目）。
 * 必须先截取 equipment 区段——页面更早的皮肤推广位也用 cta-box，会把
 * "Knives / Gloves" 之类的类目混进来。没有 Equipment 区或没匹配到就返回空。 */
const GEAR_CATS = { Monitor: "monitor", Mouse: "mouse", Keyboard: "keyboard", Headset: "headset", Mousepad: "mousepad" };
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function parseGear(html) {
  const start = html.indexOf('id="equipment-settings"');
  if (start < 0) return null;
  const end = html.indexOf('<section id="setupstreaming"', start);
  const section = html.slice(start, end > 0 ? end : undefined);
  const gear = {};
  const re = /<div class="cta-box[^"]*js-promo-gear[^"]*"[^>]*>\s*<h4><a[^>]*>([\s\S]*?)<\/a><\/h4>[\s\S]*?<div class="cta-box__tag[^"]*">([^<]+)<\/div>/g;
  for (let m; (m = re.exec(section)); ) {
    const cat = GEAR_CATS[strip(m[2])];
    if (!cat || gear[cat]) continue;
    const name = decodeEntities(strip(m[1]));
    if (name) gear[cat] = name;
  }
  return Object.keys(gear).length ? gear : null;
}

function parseInfo(html) {
  const grab = (re) => {
    const m = html.match(re);
    return m ? strip(m[1]) : "";
  };
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : "";
  };
  const info = {};
  info.real = grab(/<th>Name<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  const born = grab(/<th>Birthday<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  if (born) {
    const d = new Date(born);
    info.born = isNaN(d.getTime()) ? born : d.toISOString().slice(0, 10);
  }
  info.country = grab(/<th>Country<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  info.dpi = num(field(html, "dpi"));
  info.sens = num(field(html, "sensitivity"));
  info.edpi = num(field(html, "edpi"));
  info.zoom = num(field(html, "zoom_sensitivity_ratio_mouse"));
  info.hz = num(field(html, "hz"));
  const reso = [...html.matchAll(/<th>Resolution<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
  if (/^\d{3,4}x\d{3,4}$/.test(reso[0] || "")) info.res = reso[0];
  const aspect = grab(/<th>Aspect Ratio<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  if (aspect) info.aspect = aspect;
  const scaling =
    grab(/<th>Scaling Mode<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/) ||
    grab(/<th>Scaling<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  if (scaling) info.scaling = scaling;
  const refresh = grab(/<th>Refresh Rate<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  if (refresh) info.refresh = num(refresh) || refresh;

  const b01 = (v) => {
    const t = String(v).toLowerCase();
    if (["yes", "true", "enabled"].includes(t)) return 1;
    if (["no", "false", "disabled"].includes(t)) return 0;
    return num(v);
  };
  const clean = (o) => {
    const out = {};
    for (const k in o) if (o[k] !== "" && o[k] != null) out[k] = o[k];
    return out;
  };
  info.vm = clean({
    fov: num(field(html, "viewmodel_fov")),
    ox: num(field(html, "viewmodel_offset_x")),
    oy: num(field(html, "viewmodel_offset_y")),
    oz: num(field(html, "viewmodel_offset_z")),
    preset: num(field(html, "viewmodel_presetpos")),
    newBob: b01(field(html, "cl_usenewbob")),
    bobLower: num(field(html, "cl_bob_lower_amt")),
    bobLat: num(field(html, "cl_bobamt_lat")),
    bobVert: num(field(html, "cl_bobamt_vert")),
    bobCycle: num(field(html, "cl_bobcycle")),
  });
  info.radar = clean({
    scale: num(field(html, "cl_radar_scale")),
    hudScale: num(field(html, "cl_radar_hud_scale")),
    centered: b01(field(html, "cl_radar_always_centered")),
    rotate: b01(field(html, "cl_radar_rotate")),
    square: b01(field(html, "cl_radar_square_with_scoreboard")),
    hudScaling: num(field(html, "hud_scaling")),
    hudColor: field(html, "cl_hud_color"),
  });

  // 视频画面 / 显示器 / 外设等附加设置（保持原文本，界面按 label 表展示）
  const extra = {};
  for (const [src, key, how] of EXTRA_FIELDS) {
    const raw = how === "th" ? thField(html, src) : field(html, src);
    if (raw === "" || raw == null) continue;
    const asNum = parseFloat(raw);
    extra[key] = Number.isFinite(asNum) && String(asNum) === String(raw).trim() ? asNum : raw;
  }
  info.extra = extra;
  // 外设型号（Equipment 区）：显示器/鼠标/键盘/耳机/鼠标垫的实际型号名
  const gear = parseGear(html);
  if (gear) info.gear = gear;
  return info;
}

// 旧格式页面字段 → 纯 legacy 形状设置（与 check-freshness 共用共享模块）
function fieldsToSettings(f) { return PS.fieldsToLegacySettings(f); }

/* ========================= 报告 ========================= */
function buildReport(s) {
  const out = [];
  out.push("# 数据更新报告");
  out.push("");
  out.push("- 更新时间：" + new Date(s.updatedAt).toLocaleString("zh-CN"));
  out.push("- 数据源：prosettings.net");
  if (s.error) {
    out.push("- 结果：**更新中止 · 已保留原有数据**（现有 " + (s.players || 0) + " 名选手）");
    out.push("- 原因：" + s.error);
    out.push("- 用时：" + Math.round((s.durationMs || 0) / 1000) + " 秒");
    out.push("");
    if (s.failed && s.failed.length) {
      out.push("## 抓取失败 / 无准星数据");
      out.push("");
      s.failed.forEach((f) => out.push("- " + f));
      out.push("");
    }
    out.push("---");
    out.push("");
    out.push("生成方式：node tools/auto-update.js");
    return out.join("\n");
  }
  out.push("- 结果：**" + s.teams + " 支战队 / " + s.players + " 名选手**（含历史记录 " + s.withHistory + " 人）");
  out.push("- 准星码格式（cs2-v1）：新格式页面 " + (s.newFormat || 0) + " 人 · 旧格式页面 " + (s.legacyFormat || 0) + " 人" +
    (s.migrated ? " · 首次迁移 " + s.migrated + " 人（旧数据无 c2 可比，未计入变动）" : ""));
  out.push("- 用时：" + Math.round(s.durationMs / 1000) + " 秒");
  out.push("");
  if (s.addedTeams && s.addedTeams.length) {
    out.push("## 自动纳入的新战队");
    out.push("");
    s.addedTeams.forEach((t) => out.push("- " + t));
    out.push("");
  }
  out.push("## 选手变动");
  out.push("");
  out.push("- 新增 " + s.addedPlayers.length + " 名" + (s.addedPlayers.length ? "：" + s.addedPlayers.join("、") : ""));
  out.push("- 移除 " + s.removedPlayers.length + " 名" + (s.removedPlayers.length ? "：" + s.removedPlayers.join("、") : ""));
  out.push("- 准星变动 " + s.changedCrosshairs.length + " 名");
  out.push("");
  if (s.changedCrosshairs.length) {
    out.push("| 选手 | 原分享码 | 新分享码 |");
    out.push("| --- | --- | --- |");
    s.changedCrosshairs.forEach((c) => out.push("| " + c.name + " | " + c.from + " | " + c.to + " |"));
    out.push("");
  }
  if (s.unknownStyles && s.unknownStyles.length) {
    out.push("## ⚠ 未能识别的样式文本（按默认样式 4 处理）");
    out.push("");
    s.unknownStyles.forEach((t) => out.push("- `" + t + "`"));
    out.push("");
  }
  if (s.failed && s.failed.length) {
    out.push("## 抓取失败 / 无准星数据");
    out.push("");
    s.failed.forEach((f) => out.push("- " + f));
    out.push("");
  }
  out.push("---");
  out.push("");
  out.push("生成方式：node tools/auto-update.js");
  return out.join("\n");
}

/* ========================= CLI ========================= */
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fresh") o.fresh = true;
    else if (a === "--cache" || a === "--quick") o.useCache = true;
    else if (a === "--offline") o.offline = true;
    else if (a === "--no-dist") o.noDist = true;
    else if (a === "--no-autoteam") o.autoAddTeams = false;
    else if (a === "--logos") o.forceLogos = true;
    else if (a === "--watch") o.watch = Number(argv[++i]) || 6;
    else if (a === "--max-age") o.maxAgeHours = Number(argv[++i]) || 24;
    else if (a === "--roster") o.rosterLimit = Number(argv[++i]) || 6;
    else if (a === "--max-teams") o.maxTeams = Number(argv[++i]) || 64;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("====")[0]);
    return;
  }
  if (o.watch) {
    const everyMs = Math.max(1, o.watch) * 3600 * 1000;
    console.log("⏱ 自动更新已启动：每 " + o.watch + " 小时检查一次（Ctrl+C 退出）");
    for (;;) {
      console.log("\n===== [" + new Date().toLocaleString("zh-CN") + "] 开始更新 =====");
      try {
        await runUpdate(Object.assign({}, o, { watch: 0, useCache: false, maxAgeHours: 0 }));
      } catch (e) {
        console.error("更新失败：" + e.message);
      }
      console.log("下次更新：" + new Date(Date.now() + everyMs).toLocaleString("zh-CN"));
      await sleep(everyMs);
    }
  }
  await runUpdate(o);
}

module.exports = { runUpdate, rosterGuard, DEFAULT_CONFIG };

if (require.main === module) {
  main().catch((e) => {
    console.error("\n✖ 更新失败：" + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
