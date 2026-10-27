/* =========================================================================
 * Showkey · 静态发布包构建
 * 把纯静态资源复制到 cs2-crosshair/ ，用于 GitHub Pages / Vercel / 任意静态托管
 * 用法: node tools/build-dist.js
 * 作为模块: require("./build-dist.js").build({ silent: true })
 *
 * 注意：不再对整个目录做递归删除（那既危险，又会被宿主的安全删除策略拦截，
 * 导致自动更新在最后一步失败）。改为「就地覆盖 + 精确裁剪」——
 * 只有源目录里已不存在的文件才会被逐个删除，正常构建删除数为 0。
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "cs2-crosshair");
const ITEMS = ["index.html", "css", "js", "assets", "README-访问说明.md"];

function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 收集源侧相对路径清单，用于精确裁剪
function collect(src, rel, set) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(src)) collect(path.join(src, name), path.join(rel, name), set);
  } else {
    set.add(rel.replace(/\\/g, "/"));
  }
}

// 逐个删除 dist 中多余的文件（正常构建时不会有任何删除）
function prune(dir, rel, expected, removed) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const relPath = path.join(rel, name).replace(/\\/g, "/");
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      prune(full, path.join(rel, name), expected, removed);
      if (!fs.readdirSync(full).length) fs.rmdirSync(full);
    } else if (!expected.has(relPath)) {
      fs.unlinkSync(full);
      removed.push(relPath);
    }
  }
}

function build(opts) {
  const silent = !!(opts && opts.silent);
  const log = silent ? () => {} : (s) => console.log(s);

  const expected = new Set();
  for (const item of ITEMS) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) {
      log("  ⚠ 跳过（不存在）：" + item);
      continue;
    }
    collect(src, item, expected);
  }

  fs.mkdirSync(DIST, { recursive: true });

  // 1) 就地覆盖：所有源文件写进 dist
  for (const item of ITEMS) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    copy(src, path.join(DIST, item));
    log("  + " + item);
  }

  // 2) 精确裁剪：只删除源里已不存在的文件
  const removed = [];
  prune(DIST, "", expected, removed);
  if (removed.length) log("  - 清理 " + removed.length + " 个已移除的文件");

  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else { files++; bytes += st.size; }
    }
  };
  walk(DIST);

  const stats = { files, bytes, removed: removed.length, dir: DIST };
  log("✔ 已生成 cs2-crosshair/ · " + files + " 个文件 · " + (bytes / 1024 / 1024).toFixed(2) + " MB");
  if (!silent) log("  提示：直接把 cs2-crosshair/ 上传到 GitHub Pages / Vercel，或自行压缩成 zip。");
  return stats;
}

module.exports = { build };

if (require.main === module) build();
