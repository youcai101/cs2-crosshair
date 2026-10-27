"use strict";
/* =========================================================================
 * liquipedia-logos.js — 战队队标唯一来源：Liquipedia（液体百科）
 *
 * 为什么要有这个文件：
 *   原先队标是 auto-update.js 从 prosettings.net 的 <picture> 标签里抠的，
 *   于是混进了 SVG、JPEG，甚至 404 的 HTML。队标是「战队身份」的视觉锚点，
 *   应当来自 CS 领域最权威的公开维基：liquipedia.net/counterstrike。
 *
 * 用法（离线 CLI）：
 *   node tools/liquipedia-logos.js                  # 只补缺失/无效的
 *   node tools/liquipedia-logos.js --force          # 全部重新抓取
 *   node tools/liquipedia-logos.js --dry            # 只解析、不下载
 *   node tools/liquipedia-logos.js --only=navi,faze # 只处理指定 key
 *   node tools/liquipedia-logos.js --out=_logos     # 换输出目录（默认 assets/teams）
 *
 * 用法约束（Liquipedia API 使用条款）：
 *   · 必须带可识别的 User-Agent（含用途和联系方式），否则会被封禁
 *   · api.php 请求间隔 ≥2s；文件下载也限速
 *   · 一律取 128px 缩略图，不拉几 MB 的原图
 * ========================================================================= */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const TEAMS_JSON = path.join(__dirname, "teams.json");
const CACHE_DIR = path.join(__dirname, "cache");
const REPORT_FILE = path.join(CACHE_DIR, "logo-report.json");

const DEFAULT_OUT = path.join(ROOT, "assets", "teams");

const UA = "ShowkeyCS2Crosshair/1.0 (personal CS2 crosshair project; contact: local)";
const API = "https://liquipedia.net/counterstrike/api.php";
const COMMONS = "https://liquipedia.net/commons/api.php";
const SITE = "https://liquipedia.net/counterstrike/";

const THUMB_WIDTH = 128;   // 页面显示 44px，2x 屏需要 88，128 留余量
const API_GAP_MS = 2100;   // Liquipedia 硬性要求 ≥2s
const FILE_GAP_MS = 700;

/* 页面名覆盖：teams.json 的 site 名 → 液体百科页面名。
 * 只列「同名会撞到消歧义页 / 不存在」的；其余靠自动查询 + 搜索兜底。 */
const PAGE_OVERRIDE = {
  "Falcons Esports": "Team Falcons",
  "The Mongolz": "The MongolZ",
  Aurora: "Aurora Gaming",
  "B8 Esports": "B8",
  TyLoo: "TYLOO",
  "Lynn Vision": "Lynn Vision Gaming",
};

/* 人工钦定：个别队伍在液体百科上**没有**「方形 + 干净 + 现役」的队徽，自动评分
 * 反复挑错（或挑到选手照/愚人节图），就在这里按队 key 锁死图片名。
 * 值 = Commons 文件页名；仍走完整 buildLogo 管线（去白底/裁边/128 画布），
 * 形状与可见度照常写进报告；锁定图偏宽时不再重复告警（属于明知故犯的取舍）。 */
const FORCE_IMAGE = {
  // NRG：液体百科 Commons 前缀 NRG 共 106 个文件，能当队徽的只有 4 类，逐个否掉：
  //   · NRG_2024_allmode.png（=页面 infobox 的现役标）是**纯橙色字标**，比例 4.20，
  //     被 MAX_ASPECT 拒；即便塞进 128 画布，44px 方框里也只剩 ~10px 高，糊成一条。
  //   · NRG_Esports_2017_darkmode / NRG_eSports_darkmode 是「R + 飞掠弧」抽象标，
  //     同一剪影只差配色（暗红 / 品红），44px 下认不出是 NRG —— 用户报错的原始那张就是它。
  //   · NRG_2020_darkmode.png 比例 4.07，同样是字标。
  // 选 NRG_2019.png：地球经线 + 渐变「NRG」字母，是 NRG 最广为人知的厂牌标志，
  // 形状 1.77 / 深色可见度 133，字母自带彩色描边，深浅两个主题都看得清。
  // 注：2024 橙色字标才是「现役官方标」，若之后要换成它，把下面这行改掉即可
  //（前端是 object-fit: contain 的 44px 方框，字标会变成一条细横条）。
  nrg: "NRG_2019.png",
};

/* 明显不是队徽的图：合影/场地照基本是 JPG，横幅类宽高比 >3 的也不是队徽 */
const MIN_SIDE = 16;
const MAX_ASPECT = 3.2;

/* 站点深色主题的背景色（css/style.css:44 --bg: #08080a）。
 * 队徽选图时要拿它当底做 alpha 合成，判断「放上去还看不看得见」。*/
const SITE_BG = [0x08, 0x08, 0x0a];

/* 队徽是「方形符号」，横幅是「字标（wordmark）」——液体百科上这两者同名不同缀：
 *     Team Falcons 2022 allmode.png        ← 方形队徽（要的）
 *     Team Falcons 2022 full allmode.png   ← 宽横幅字标（不要）
 * 光看文件名不可靠（有的队 full 也是方的），所以真正的判据放在**裁掉透明边之后**：
 * 内容本身的比例才是形状。超过 ACCEPT_ASPECT 视为字标，继续找下一张。 */
const ACCEPT_ASPECT = 1.45;
const MIN_TRIM = 24;        // 裁边后短边至少占画布的 24/128，否则是细条/杂点

const args = process.argv.slice(2);
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : null;
};
const opt = {
  force: args.includes("--force"),
  dry: args.includes("--dry"),
  only: (argOf("only") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  out: argOf("out") ? path.resolve(ROOT, argOf("out")) : DEFAULT_OUT,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastApi = 0;
let lastFile = 0;
const warn = [];

function say(msg) { console.log(msg); }

/* =========================================================================
 * PNG 最小实现（只用 Node 内置 zlib，不引依赖）
 * 解码 8bit PNG → 去白底 → 裁透明边 → 等高缩放 → 居中放进正方形画布 → 重编码
 * ========================================================================= */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf) {
  return !!buf && buf.length > 8 && buf.slice(0, 8).equals(PNG_SIG);
}

function pngSize(buf) {
  if (!isPng(buf) || buf.length < 24) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngDecode(buf) {
  if (!isPng(buf)) throw new Error("不是 PNG");
  let off = 8;
  let w = 0, h = 0, bitDepth = 8, colorType = 6, interlace = 0;
  const idat = [];
  let palette = null;
  let trns = null;

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString("latin1");
    const data = buf.slice(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!w || !h) throw new Error("PNG 头缺损");
  if (bitDepth !== 8) throw new Error("仅支持 8bit PNG（实际 " + bitDepth + "bit）");
  if (interlace) throw new Error("不支持交错 PNG");

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error("未知颜色类型 " + colorType);

  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;

  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      line[i] = v & 0xff;
    }
    prev = line;

    for (let x = 0; x < w; x++) {
      const s = x * channels;
      const d = (y * w + x) * 4;
      let r, g, bl, al = 255;
      if (colorType === 0) { r = g = bl = line[s]; }
      else if (colorType === 4) { r = g = bl = line[s]; al = line[s + 1]; }
      else if (colorType === 2) { r = line[s]; g = line[s + 1]; bl = line[s + 2]; }
      else if (colorType === 6) { r = line[s]; g = line[s + 1]; bl = line[s + 2]; al = line[s + 3]; }
      else {
        const idx = line[s];
        if (palette && idx * 3 + 2 < palette.length) {
          r = palette[idx * 3]; g = palette[idx * 3 + 1]; bl = palette[idx * 3 + 2];
        } else { r = g = bl = 0; }
        if (trns && idx < trns.length) al = trns[idx];
      }
      out[d] = r; out[d + 1] = g; out[d + 2] = bl; out[d + 3] = al;
    }
  }
  return { w, h, data: out };
}

function pngEncode(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* 面积平均缩放；按 alpha 加权，避免透明边缘发灰 */
function pngResize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yr), y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xr), x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy++) {
        for (let xx = x0; xx < x1 && xx < sw; xx++) {
          const i = (yy * sw + xx) * 4;
          const al = src[i + 3];
          sr += src[i] * al; sg += src[i + 1] * al; sb += src[i + 2] * al; sa += al;
          n++;
        }
      }
      if (!n) n = 1;
      const d = (y * dw + x) * 4;
      if (sa > 0) {
        out[d] = Math.round(sr / sa);
        out[d + 1] = Math.round(sg / sa);
        out[d + 2] = Math.round(sb / sa);
      }
      out[d + 3] = Math.round(sa / n);
    }
  }
  return out;
}

/* 白底转透明：只在「四角几乎都是浅色」时启用，并从四边洪水填充，
 * 只清掉与边缘连通的浅色像素，徽标内部的白不会被掏空。 */
function stripWhiteBackground(img) {
  const { w, h, data } = img;
  const near = (i) => data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 232;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  const lightCorners = corners.filter((i) => near(i) && data[i + 3] > 200).length;
  if (lightCorners < 3) return { data, changed: false };

  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!near(i) || data[i + 3] < 40) continue;
    data[i + 3] = 0;
    cleared++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return { data, changed: cleared > w * h * 0.02 };
}

/* 裁掉透明边 */
function trimAlpha(img) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return img;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  if (cw === w && ch === h) return img;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    data.copy(out, y * cw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4);
  }
  return { w: cw, h: ch, data: out };
}

/* =========================================================================
 * Liquipedia API
 * ========================================================================= */

async function apiQuery(api, params) {
  const wait = API_GAP_MS - (Date.now() - lastApi);
  if (wait > 0) await sleep(wait);
  lastApi = Date.now();
  const url = api + "?" + new URLSearchParams(Object.assign({ action: "query", format: "json" }, params));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("API HTTP " + res.status);
  return res.json();
}

const mainQuery = (p) => apiQuery(API, p);
const commonsQuery = (p) => apiQuery(COMMONS, p);

async function pageProps(title) {
  const j = await mainQuery({ prop: "pageprops", titles: title, redirects: "1" });
  const pg = Object.values((j.query && j.query.pages) || {})[0];
  if (!pg || pg.missing !== undefined) return null;
  return pg;
}

const wtCache = new Map();
async function wikitext(title) {
  if (wtCache.has(title)) return wtCache.get(title);
  const j = await mainQuery({ prop: "revisions", rvprop: "content", rvslots: "main", titles: title });
  const pg = Object.values((j.query && j.query.pages) || {})[0];
  const txt = (pg && pg.revisions && pg.revisions[0].slots.main["*"]) || "";
  wtCache.set(title, txt);
  return txt;
}

/* 从 Infobox 里按优先级抠图片名：本站是深色主题，暗色版优先 */
const INFOBOX_KEYS = ["imageallmode", "imagedark", "image", "logo", "logodark", "logotype"];

function infoboxImages(text) {
  if (!text) return [];
  const i = text.indexOf("{{Infobox");
  const seg = i >= 0 ? text.slice(i, i + 6000) : text.slice(0, 3000);
  const out = [];
  for (const k of INFOBOX_KEYS) {
    const m = seg.match(new RegExp("\\|\\s*" + k + "\\s*=\\s*([^\\n|}]+)"));
    if (!m) continue;
    const v = m[1].trim().replace(/^File:/i, "");
    if (/\.(png|jpe?g|gif|webp)$/i.test(v) && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}

/* 名字里带 `full` 的多是字标横幅；去掉它往往就是同款的方形队徽：
 *     Team Falcons 2022 full lightmode.png  →  Team Falcons 2022 lightmode.png
 * 液体百科上这两张经常同时存在，而 infobox 偏偏引用完整版，所以要主动派生。 */
function withoutFull(name) {
  return name.replace(/\s+full(?=\s+(?:light|dark|all)mode\.)/i, "");
}

/* 【深浅主题孪生版】同一支队徽在液体百科上通常同时有 lightmode / darkmode 两份，
 * 形状、构图完全一致，只是墨迹颜色相反：
 *     Team_Spirit_2022_lightmode.png   深色墨迹 —— 给**浅色**背景用
 *     Team_Spirit_2022_darkmode.png    浅色墨迹 —— 给**深色**背景用
 * 本站默认深色主题（index.html data-theme="dark"），lightmode 版在深色底上几乎看不见
 * （实测 Team Spirit lightmode 与背景亮度差仅 26，darkmode 是 222）。
 * 因此拿到一张 lightmode 时必须先去要它的 darkmode 孪生版。*/
const MODE_SUFFIX_RE = /[ _](light|dark|all)mode\.png$/i;

function modeSiblings(name) {
  const m = name.match(MODE_SUFFIX_RE);
  if (!m) return [];
  const cur = m[1].toLowerCase();
  const base = name.slice(0, name.length - m[0].length);
  const sep = m[0].slice(0, m[0].length - (cur + "mode.png").length);  // 原始分隔符（空格或下划线）
  const out = [];
  // 深色主题优先：dark 在前；all 是中性版本，两套主题都能用；light 垫底
  for (const want of ["dark", "all", "light"]) {
    if (want === cur) continue;
    out.push(base + sep + want + "mode.png");
  }
  return out;
}


/* 战队页面名 → 候选图片名列表（有序） */
async function candidateImages(siteName) {
  const out = [];
  const push = (n) => { if (n && out.indexOf(n) === -1) out.push(n); };
  /* 顺序很有讲究，直接决定最终选到哪张：
   *   1) 先去 `full`（字标横幅）拿到同款方形版；
   *   2) **方形版的 darkmode 孪生版排最前** —— 深色主题下 lightmode 几乎看不见，
   *      而候选循环一旦遇到「形状合格且可见度达标」的就 break，排错了就再也不会看 darkmode；
   *   3) allmode（中性）次之；4) 不带后缀的方形版；5) 最后才是原图（可能是 full 横幅）。 */
  const pushSmart = (n) => {
    const alt = withoutFull(n);
    const base = alt !== n ? alt : n;
    const sibs = modeSiblings(base).filter((s) => /[ _]darkmode\.png$/i.test(s));
    sibs.forEach(push);                                  // darkmode 孪生版优先
    modeSiblings(base).filter((s) => !sibs.includes(s)).forEach(push);  // allmode / lightmode
    push(base);
    if (alt !== n) {                                     // 原图本身带 full，放最后
      modeSiblings(n).filter((s) => /[ _]darkmode\.png$/i.test(s)).forEach(push);
      push(n);
    }
  };

  const pageNames = [];
  if (PAGE_OVERRIDE[siteName]) pageNames.push(PAGE_OVERRIDE[siteName]);
  pageNames.push(siteName);

  for (const pn of pageNames) {
    const pg = await pageProps(pn);
    if (!pg) continue;
    const meta = pg.pageprops && pg.pageprops.metaimage;
    if (meta) pushSmart(meta);
    const imgs = infoboxImages(await wikitext(pg.title));
    imgs.forEach(pushSmart);
  }

  // Commons 按前缀兜底：方形优先（bigScore 里比例占大头）
  const prefix = (PAGE_OVERRIDE[siteName] || siteName).replace(/\s+/g, "_");
  try {
    const j = await commonsQuery({ list: "allimages", aiprefix: prefix, ailimit: "100", aiprop: "url|size" });
    const files = (j.query && j.query.allimages) || [];
    const scored = files
      .filter((f) => /\.png$/i.test(f.name))
      .filter((f) => !isJunk(f.name))
      .filter((f) => f.width && f.height && f.width / f.height <= MAX_ASPECT && f.height / f.width <= MAX_ASPECT)
      .filter((f) => f.width >= MIN_SIDE && f.height >= MIN_SIDE)
      .sort((a, b) => bigScore(b) - bigScore(a));
    scored.slice(0, 12).forEach((f) => push(f.name));
  } catch (e) {
    warn.push(siteName + " Commons 枚举失败：" + e.message);
  }
  return out;
}

/* 候选排序：**方形优先 + 正式版本优先 + 深色主题优先**。
 * 比例项给到 ±10 分，足以压过模式后缀的 ±5 分——「方形符号 vs 宽横幅字标」是形状差异，
 * 比 light/dark 的颜色差异重要得多。但模式后缀（lightmode/darkmode/allmode）是液体百科
 * 标注「这是队徽」的唯一可靠信号，所以给 +5：足以压过没有后缀的照片（如 NRG_Nafen.png）。
 *
 * 深浅主题：本站默认深色背景，lightmode 是「深色墨迹」版，放进深色底几乎看不见
 * （实测可见度只有 6–26，darkmode 是 140–235）。视觉层面有 darkContrast 兜底否决，
 * 但排序阶段就该把 lightmode 压到后面 —— 否则排在前面、又刚好过阈值，就永远不会去看
 * 排在后面的 darkmode 孪生版（这正是 faze / g2 / liquid 三队当初选错的原因）。 */
function bigScore(f) {
  const aspect = f.width && f.height ? f.width / f.height : 1;
  const sq = Math.max(0, 1 - Math.abs(Math.log(aspect)));   // 1 表示正方形
  let s = sq * 10;
  if (MODE_RE.test(f.name)) s += 5;                         // 官方队徽版本
  if (/allmode/i.test(f.name)) s += 6;                      // 中性透明版，深浅主题都适用
  if (/darkmode/i.test(f.name)) s += 5;                     // 深色主题首选
  if (/lightmode/i.test(f.name)) s -= 4;                    // 深色底上会消失，降权
  if (/\bfull\b/i.test(f.name)) s -= 7;                     // full 通常是字标横幅
  if (Math.min(f.width || 0, f.height || 0) < 100) s -= 3;  // 50×50 的 icon 放大到 128 会糊
  const y = f.name.match(/\b(20\d\d)\b/);
  if (y) s += Math.min(3, Math.max(0, (Number(y[1]) - 2015) / 3)); // 越新越可能是现役队徽
  return s;
}

/* 子品牌/分部标志：`MIBR_LOS_allmode`（英雄联盟分部）、`NRG_HG_icon`、`TES_CN_allmode`。
 * 特征：队名之后紧跟一段 2–5 个全大写的缩写。母队队徽不会有这种段。 */
const SUBBRAND_RE = /_[A-Z]{2,5}_[a-z0-9]/;

/* 队名后面多出来的一段「人名」：`FUT_Esports_Muj.png`、`NRG_Nafen.png`、`B8_Esports_Dawn.png`。
 * 判据：**没有** light/dark/allmode 后缀（官方队徽版本一定有），且最后一段既不是年份数字
 * 也不是 logo/icon 之类的通用词 —— 那就是选手或教练的署名图，不是队徽。
 * 注意：文件名只有一段（`MIBR.png`）时是队名本身，不能误杀。 */
const SAFE_TAIL = /^(logo|icon|teamcard|full|esports|esport|gaming|team|main|all|dark|light|new|logo\d)$/i;
const PERSON_CACHE = new Map();
function looksLikePerson(name) {
  if (PERSON_CACHE.has(name)) return PERSON_CACHE.get(name);
  let bad = false;
  if (!MODE_RE.test(name)) {
    const toks = name.replace(/\.png$/i, "").split(/[ _]+/).filter(Boolean);
    if (toks.length > 1) {
      const tail = toks[toks.length - 1];
      bad = !/^\d+$/.test(tail) && !SAFE_TAIL.test(tail);
    }
  }
  PERSON_CACHE.set(name, bad);
  return bad;
}

/* 直接排除，连候选都不进：季节活动/愚人节/选手照片/分部标志 */
function isJunk(name) {
  return NOVELTY_RE.test(name) || PLAYER_RE.test(name) || SUBBRAND_RE.test(name)
    || looksLikePerson(name) || /mlbb/i.test(name);
}

/* 绝对不是队徽的文件名特征。直接**排除**，不参与候选。
 * 液体百科的图片名用下划线分隔，所以模式里一律 `[ _]` 兼容两种写法。 */
const NOVELTY_RE = new RegExp([
  "april[ _]?fools", "\\bbrawl\\b", "[ _]pin\\b", "\\bxmas\\b", "prism",
  "charity", "[ _]card\\b", "teamcard", "[ _]mvp\\b", "invitational",
  "roster", "lineup", "[ _]flag\\b", "[ _]trophy\\b", "\\bhall[ _]of[ _]fame\\b",
].join("|"), "i");

/* 选手/教练/青训照片：`MIBR_BobZ_2022.png`、`PaiN_Gaming_Academy_cass1n_2022.png`。
 * 特征：队名前缀 + 昵称 + 年份，且**没有** light/dark/allmode 后缀。 */
const PLAYER_RE = new RegExp([
  "_academy_", "_youth_", "_talent_", "_female_", "_jersey", "_hoodie", "_shirt",
  "_(fe|fem)_", "_deadpool",
].join("|"), "i");

/* 正式队徽的命名特征：液体百科用 lightmode / darkmode / allmode 区分底色版本。 */
const MODE_RE = /(light|dark|all)mode\.png$/i;

async function imageInfo(imageName) {
  const j = await mainQuery({
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: String(THUMB_WIDTH),
    titles: "File:" + imageName,
  });
  const pg = Object.values((j.query && j.query.pages) || {})[0];
  const info = pg && pg.imageinfo && pg.imageinfo[0];
  if (!info) return null;
  return {
    url: info.thumburl || info.url,
    mime: info.mime,
    fullWidth: info.width,
    fullHeight: info.height,
  };
}

async function fetchBinary(url) {
  const wait = FILE_GAP_MS - (Date.now() - lastFile);
  if (wait > 0) await sleep(wait);
  lastFile = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: SITE } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

/* 下载 → 处理 → 得到 128×128 正方形 PNG buffer。
 * 关键产出是 `content`：**裁掉透明边之后**的内容尺寸。原图比例会被画布和留白骗过去，
 * 只有裁边后的比例才真实反映「这是方形队徽还是横条字标」。 */
async function buildLogo(meta) {
  const bin = await fetchBinary(meta.url);
  if (!isPng(bin)) throw new Error("下载内容不是 PNG（" + bin.slice(0, 4).toString("hex") + "）");
  let img = pngDecode(bin);
  const before = { w: img.w, h: img.h };
  const stripped = stripWhiteBackground(img);
  img = trimAlpha({ w: img.w, h: img.h, data: stripped.data });
  const content = { w: img.w, h: img.h };

  const canvas = THUMB_WIDTH;
  const scale = Math.min(1, canvas / Math.max(img.w, img.h));
  const tw = Math.max(1, Math.round(img.w * scale));
  const th = Math.max(1, Math.round(img.h * scale));
  const small = pngResize(img.data, img.w, img.h, tw, th);
  const canvasData = Buffer.alloc(canvas * canvas * 4);
  const ox = Math.floor((canvas - tw) / 2);
  const oy = Math.floor((canvas - th) / 2);
  for (let y = 0; y < th; y++) {
    small.copy(canvasData, ((y + oy) * canvas + ox) * 4, y * tw * 4, (y + 1) * tw * 4);
  }
  return {
    buffer: pngEncode(canvas, canvas, canvasData),
    before, content, bgStripped: stripped.changed,
    tw, th,
    // 队徽在深色底上的可辨识度：把半透明像素按网站背景合成后，算与背景的平均色差
    contrast: darkContrast(img),
  };
}

/* 队徽放在**深色背景**上还能不能看清。
 *
 * 为什么必须算这个：液体百科给同一支队徽存了 lightmode / darkmode 两份，墨迹颜色相反。
 * lightmode 是「深色墨迹」，放到本站 #08080a 的背景上几乎完全融进去 —— 实测
 * Team Spirit lightmode 与背景的亮度差只有 26，darkmode 是 222；
 * BIG、NiP、B8、paiN、FUT 也都是同样的问题。
 *
 * 做法：把每个半透明像素按站点背景做 alpha 合成，再取与背景的平均通道差（0–255）。
 * 低于 VISIBLE_MIN 说明「肉眼基本看不见」，应继续换候选。 */
const VISIBLE_MIN = 45;

function darkContrast(img) {
  const { w, h, data } = img;
  let n = 0, sum = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < 24) continue;                       // 几乎全透明，不参与
    const k = a / 255;
    const r = data[i * 4] * k + SITE_BG[0] * (1 - k);
    const g = data[i * 4 + 1] * k + SITE_BG[1] * (1 - k);
    const b = data[i * 4 + 2] * k + SITE_BG[2] * (1 - k);
    sum += (Math.abs(r - SITE_BG[0]) + Math.abs(g - SITE_BG[1]) + Math.abs(b - SITE_BG[2])) / 3;
    n++;
  }
  return n ? sum / n : 0;
}

/* 给一个液体百科队名，跑完「候选 → 逐张试图 → 综合评分」，返回最佳那张。
 * 供命令行主流程与 auto-update 共用；log 可选，传了才打印试图过程。
 * cands0 可传入已解析好的候选，避免重复打 API（液体百科限速 2s/次，重复一次就是白等）。 */
async function resolveLogo(siteName, log, cands0) {
  const out = log || (() => {});

  /* 人工钦定优先：跳过候选枚举（能省掉两次 2s 限速），直接构建锁定那张。
   * 只有构建失败才回退到自动流程 —— 钦定不能变成「整队缺图」。 */
  const forced = FORCE_IMAGE[String(siteName).toLowerCase()];
  if (forced) {
    try {
      const meta = await imageInfo(forced);
      if (meta) {
        const built = await buildLogo(meta);
        const shape = built.content.w && built.content.h
          ? Math.max(built.content.w, built.content.h) / Math.min(built.content.w, built.content.h)
          : 99;
        out("  ★ 钦定 " + forced + "（内容 " + built.content.w + "×" + built.content.h +
          "，形状 " + shape.toFixed(2) + "，深色可见度 " + built.contrast.toFixed(0) + "）");
        return { status: "ok", cands: [forced], imageName: forced, built, shape, contrast: built.contrast, forced: true };
      }
      out("  ⚠ 钦定图 " + forced + " 查不到，回退自动流程");
    } catch (e) {
      out("  ⚠ 钦定图 " + forced + " 构建失败（" + e.message + "），回退自动流程");
    }
  }

  let cands = cands0 || [];
  if (!cands.length) {
    try {
      cands = await candidateImages(siteName);
    } catch (e) {
      out("  ✗ 候选解析失败：" + e.message);
    }
  }
  if (!cands.length) return { status: "no-page", cands };
  out("  候选 " + cands.length + " 张：" + cands.slice(0, 6).join("、"));

  /* 逐个试，但**不拿到第一张就用**。两个维度都要过：
   *   ① 形状：裁边后的内容比例要接近正方形（`full` 横条字标必须排除）
   *   ② 可见度：放到站点深色背景上要看得见（lightmode 深色墨迹必须排除）
   * 两维都合格的立刻采用；都不合格时退回「形状 × 可见度」综合分最高的那张，绝不留空。 */
  let best = null;
  let triedN = 0;
  const MAX_TRY = 10;

  for (const imageName of cands) {
    if (triedN >= MAX_TRY) break;
    let meta;
    try { meta = await imageInfo(imageName); } catch (e) { continue; }
    if (!meta) continue;
    const aspect = meta.fullWidth && meta.fullHeight ? meta.fullWidth / meta.fullHeight : 1;
    if (meta.mime === "image/jpeg" || aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) {
      out("  · 跳过 " + imageName + "（" + meta.mime + "，比例 " + aspect.toFixed(2) + "）");
      continue;
    }
    triedN++;
    let built;
    try {
      built = await buildLogo(meta);
    } catch (e) {
      out("  · " + imageName + " 失败：" + e.message);
      continue;
    }
    const shape = built.content.w && built.content.h
      ? Math.max(built.content.w, built.content.h) / Math.min(built.content.w, built.content.h)
      : 99;
    const shortSide = Math.min(built.content.w, built.content.h);
    const contrast = built.contrast;
    const score = scoreOf(shape, contrast);
    out("  · 试 " + imageName + "（内容 " + built.content.w + "×" + built.content.h +
      "，形状 " + shape.toFixed(2) + "，深色可见度 " + contrast.toFixed(0) + "）");
    if (shortSide < MIN_TRIM) { out("    ↳ 太细，跳过"); continue; }
    if (!best || score > best.score) best = { imageName, built, shape, contrast, score };
    if (shape <= ACCEPT_ASPECT && contrast >= VISIBLE_MIN) break;   // 两项都合格，不必再试
  }

  if (!best) return { status: "no-usable-image", cands };
  return {
    status: "ok", cands,
    imageName: best.imageName, built: best.built,
    shape: best.shape, contrast: best.contrast,
  };
}

/* 综合分：形状权重更高（横条在 44px 方框里必然难看），可见度作为强否决项 */
function scoreOf(shape, contrast) {
  const shapePart = Math.max(0, 2.2 - shape) * 100;      // 正方形 100 分，2.2 倍以上 0 分
  const visPart = Math.min(contrast, 160) * 0.55;        // 可见度封顶 88 分
  const penalty = contrast < VISIBLE_MIN ? 90 : 0;       // 看不见的图重罚
  return shapePart + visPart - penalty;
}

/* =========================================================================
 * 主流程
 * ========================================================================= */

function logoState(file) {
  try {
    const buf = fs.readFileSync(file);
    if (!isPng(buf)) return { ok: false, why: "非 PNG" };
    const s = pngSize(buf);
    if (!s) return { ok: false, why: "PNG 头异常" };
    if (s.w < MIN_SIDE || s.h < MIN_SIDE) return { ok: false, why: s.w + "×" + s.h + " 太小" };
    return { ok: true, size: s };
  } catch (e) {
    return { ok: false, why: e.code === "ENOENT" ? "缺失" : e.code };
  }
}

function writeOut(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

/* 目标目录可能被 Windows 权限/沙箱挡住：探测一次，写不进去就整体退回 _logos，
 * 保证抓到的队徽不会因为权限问题静默丢失。 */
function pickOutDir(preferred) {
  const probe = path.join(preferred, ".write-probe");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    return preferred;
  } catch (e) {
    const fallback = path.join(ROOT, "_logos");
    fs.mkdirSync(fallback, { recursive: true });
    say("⚠ 无权限写入 " + path.relative(ROOT, preferred) + "（" + (e.code || e.message) +
      "），本次输出改到 " + path.relative(ROOT, fallback));
    return fallback;
  }
}

/* 允许被 require 出来做单图测试（不跑主流程） */
module.exports = {
  pngDecode, pngEncode, pngResize, pngSize, isPng, stripWhiteBackground, trimAlpha,
  buildLogo, candidateImages, imageInfo, bigScore, isJunk, looksLikePerson, withoutFull,
  resolveLogo, PAGE_OVERRIDE, FORCE_IMAGE,
  THUMB_WIDTH, MIN_SIDE, MAX_ASPECT, ACCEPT_ASPECT, VISIBLE_MIN,
};

(async () => {
  if (require.main !== module) return;   // 被 require 时只导出工具函数，不执行抓取
  const cfg = JSON.parse(fs.readFileSync(TEAMS_JSON, "utf8"));
  const teams = (cfg.teams || []).filter((t) => !opt.only.length || opt.only.indexOf(t.k.toLowerCase()) !== -1);

  // 沙箱/权限挡住 assets/teams 时退回一个可写的平级目录，保证结果不丢
  const outDir = pickOutDir(opt.out);

  const report = [];
  let ok = 0, skipped = 0, failed = 0;

  for (const t of teams) {
    const rel = t.logo.split("/").join(path.sep);
    const liveFile = path.join(ROOT, rel);
    const outFile = path.join(outDir, path.basename(rel));

    if (!opt.force && !opt.dry) {
      const st = logoState(liveFile);
      if (st.ok) {
        skipped++;
        report.push({ k: t.k, name: t.n, status: "skip", size: st.size });
        continue;
      }
    }

    say("\n→ " + t.n + "（" + (t.site || t.n) + "）");

    let cands = [];
    const isForced = !!FORCE_IMAGE[String(t.site || t.n).toLowerCase()];
    if (!isForced) {   // 钦定图不需要枚举候选（每次 2s 限速，白等）
      try {
        cands = await candidateImages(t.site || t.n);
      } catch (e) {
        say("  ✗ 候选解析失败：" + e.message);
      }
      if (!cands.length) {
        failed++;
        report.push({ k: t.k, name: t.n, status: "no-page" });
        say("  ✗ 液体百科没有可用图片");
        continue;
      }
    }

    if (opt.dry) {
      if (isForced) {
        const fn = FORCE_IMAGE[String(t.site || t.n).toLowerCase()];
        say("  ★ 钦定 " + fn + "（dry：不下载）");
        ok++;
        report.push({ k: t.k, name: t.n, status: "dry", image: fn, forced: true });
        continue;
      }
      // dry 不下载，只能靠文件名近似判断：带 full 的先记账，看到不带 full 的再覆盖
      say("  候选 " + cands.length + " 张：" + cands.slice(0, 6).join("、"));
      let dryPick = null;
      for (const imageName of cands) {
        let meta;
        try { meta = await imageInfo(imageName); } catch (e) { continue; }
        if (!meta) continue;
        const aspect = meta.fullWidth && meta.fullHeight ? meta.fullWidth / meta.fullHeight : 1;
        if (meta.mime === "image/jpeg" || aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) continue;
        const isFull = /\bfull\b/i.test(imageName);
        if (!dryPick || (/\bfull\b/i.test(dryPick.imageName) && !isFull)) {
          dryPick = { imageName, url: meta.url };
          say("  · dry 倾向于 " + imageName + " → " + meta.url);
        }
        if (!isFull) break;
      }
      if (!dryPick) {
        failed++;
        report.push({ k: t.k, name: t.n, status: "no-usable-image", tried: cands.slice(0, 6) });
        say("  ✗ 没找到可用队徽");
        continue;
      }
      ok++;
      report.push({ k: t.k, name: t.n, status: "dry", image: dryPick.imageName });
      continue;
    }

    const res = await resolveLogo(t.site || t.n, say, cands);
    if (res.status !== "ok") {
      failed++;
      report.push({ k: t.k, name: t.n, status: res.status, tried: cands.slice(0, 6) });
      say("  ✗ 没找到可用队徽");
      continue;
    }
    const best = res;
    const shapeOk = best.shape <= ACCEPT_ASPECT;
    const visOk = best.contrast >= VISIBLE_MIN;
    if (!shapeOk && !best.forced) warn.push(t.k + " 最佳候选仍偏宽（形状 " + best.shape.toFixed(2) + "，" + best.imageName + "）");
    if (!visOk) warn.push(t.k + " 在深色背景下偏暗（可见度 " + best.contrast.toFixed(0) + "，" + best.imageName + "）");
    writeOut(outFile, best.built.buffer);
    ok++;
    report.push({
      k: t.k, name: t.n, status: "ok",
      image: best.imageName,
      forced: !!best.forced,
      from: best.built.before,
      content: best.built.content,
      shape: Number(best.shape.toFixed(2)),
      shapeOk,
      contrast: Number(best.contrast.toFixed(1)),
      visOk,
      to: { w: THUMB_WIDTH, h: THUMB_WIDTH },
      bgStripped: best.built.bgStripped,
      bytes: best.built.buffer.length,
      file: path.relative(ROOT, outFile),
    });
    say("  ✓ " + best.imageName + " → " + path.relative(ROOT, outFile) +
      "（内容 " + best.built.content.w + "×" + best.built.content.h +
      "，形状 " + best.shape.toFixed(2) +
      "，可见度 " + best.contrast.toFixed(0) +
      "，PNG " + (best.built.buffer.length / 1024).toFixed(1) + "KB" +
      (best.built.bgStripped ? "，已去白底" : "") + "）");
  }

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    /* --only 只跑一部分队伍时，不要把其余队伍已有的报告条目冲掉：
       先读旧报告，用本次结果覆盖同名 key，其余原样保留（旧报告顺序优先）。 */
    let out = report;
    if (opt.only.length) {
      try {
        const prev = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
        if (Array.isArray(prev) && prev.length) {
          const mine = new Map(report.map((r) => [r.k, r]));
          const seen = new Set();
          out = prev.map((r) => {
            if (!mine.has(r.k)) return r;
            seen.add(r.k);
            return mine.get(r.k);
          });
          for (const r of report) if (!seen.has(r.k)) out.push(r);
        }
      } catch (e) { /* 没有旧报告就用本次的 */ }
    }
    fs.writeFileSync(REPORT_FILE, JSON.stringify(out, null, 2));
  } catch (e) { /* 报告写不下不影响结果 */ }

  say("\n完成：成功 " + ok + " · 跳过 " + skipped + " · 失败 " + failed);
  if (warn.length) say("提示：\n  · " + warn.join("\n  · "));
  if (outDir !== opt.out) say("输出目录：" + path.relative(ROOT, outDir));
  process.exitCode = failed ? 1 : 0;
})();
