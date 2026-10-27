# CS2 准星重构 · 实现说明（准星自定义功能）

> 对应计划：`CS2准星库重构计划.md`
> 本次范围：**只重构「准星自定义」**（生成器 / 预览 / 分享码 / 控制台命令 / 导入）。
> ~~**「选手准星库」暂不实现**（数据迁移 Phase 2、抓取器适配 Phase 6 均未做）~~
> → **已过时**：准星库已于 2026-10-16 完成新系统迁移（第 8 节），2026-10-22 又接入 HLTV 战队档案（第 8.1 节）。

---

## 1. 一句话结论

内部模型已整体切换到 **CS2 新像素刻度（CrosshairV2）**，生成一律输出 **cs2-v1** 新分享码；
旧 CSGO- 码只进不出（解析 → 换算 → 新模型，并带近似标注）。
四布局编解码与 akiver/csgo-sharecode 7.0.1 **双向 100% 一致**，旧码迁移后与旧渲染器**逐像素一致**。

---

## 2. 目录结构（重构后）

| 文件 | 行数级 | 职责 |
|---|---|---|
| `js/core-alphabet.js` | ~150 | Base57 容器：码 ↔ 字节 ↔ 大整数、校验和、容器识别（与布局无关） |
| `js/core-layouts.js` | ~250 | **声明式字节表**：四种布局的字段/位偏移/位宽/步进/取值范围 + 位域读写引擎 |
| `js/core-codec.js` | ~180 | CrosshairV2 新像素模型 + cs2-v1 读写 + 样式表（0–9） |
| `js/core-legacy.js` | ~110 | legacy-v1 / v3 / v4 读写（仅供导入与对拍，**不参与生成**） |
| `js/core-convert.js` | ~200 | 旧刻度 → 新像素（单向），含丢字段计数与近似提示文案 |
| `js/core-convars.js` | ~330 | 新 convar 双向映射、样式条件输出、512 字符分段、旧命令兼容解析 |
| `js/render-model.js` | ~250 | 新像素度量 + 10 样式行为表 + rescale + scope dot |
| `js/render-canvas.js` | ~180 | Canvas 像素吸附渲染（10 样式、半描边、描边 RGBA） |
| `js/codec.js` | ~160 | **兼容门面**：合成 `window.CS2Crosshair`，统一容器分发（cs2 精确 / legacy 懒迁移） |
| `js/app.js` | ~2200 | UI 适配层（生成器 10 样式 / 像素滑杆 / 新控件 / 近似提示 / 选手库 / 战队详情卡） |
| `js/players.js` | 自动生成 | 选手准星数据（prosettings.net，172 人） |
| `js/hltv-teams.js` | 自动生成 | 战队档案快照（HLTV.org，31 队） |
| `index.html` | — | 按依赖顺序引入 9 个核心脚本 + players.js + hltv-teams.js + app.js |

**已删除**：`tools/rewrite-codec.js`、`tools/rewrite-app.js`、`tools/rewrite-html.js`、`tools/rewrite-generator-section.js`
（以及 app.js / index.html 里的 `toUI/fromUI` 换算链——那套 `gap+5 / length×3 / thickness×4` 线性换算是错的）。

`tools/build-dist.js` 无需修改：它整目录复制 `js/`，新模块会自动进入静态包。

---

## 3. 格式基准与验证证据

**唯一基准**：akiver/csgo-sharecode **7.0.1**（`_oracle/` 里以 devDependency 方式离线安装，**不进入生产代码**）。

- 用它的 **TypeScript 源码**逐字段核对布局表（`src/crosshair.ts`、`src/legacy-crosshair.ts`、`src/share-code.ts`）；
- 用它的**编码器**生成 494 条 cs2 + 751 条 legacy 离线向量 → `test/vectors/sharecode-vectors.json`（已入库，测试不再依赖网络）。

| 验收项 | 结果 |
|---|---|
| cs2-v1 解码 / 往返 / 由输入模型重编码 | **494 / 494 / 494 一致** |
| legacy-v1+v3+v4 解码 / 往返 | **751 / 751 一致** |
| 旧码迁移后像素度量 vs 旧公式 | **1213 / 1213 一致**（2026-10-18 数据快照，全库 legacy 码） |
| cs2 码解码 → 重编码 fixpoint | **488 / 488 精确往返** |
| 迁移后渲染 vs cs2util 官方移植（逐像素） | **39516 PASS / 0 FAIL**；全库真实旧码 **1209 一致 / 0 不一致**（492 跳过：cs2 新码与描边 ≥1.5 已知有损） |
| prosettings 官方矩形回归 | **legacy 源页面 30 一致 / 0 不一致**（142 跳过：新格式页面与无矩形） |
| 旧码 → cs2 码 → 模型 往返 | **1701 / 1701 语义一致** |

---

## 4. 新旧模型的关键差异（实现要点）

1. **单位**：`thickness / length / gap` 直接是**屏幕像素**，不再有 0.1 步进的任意刻度；
   码内记录 `screenHeight`，预览按 `当前高度 / screenHeight` 等比缩放（`CS.displayScale`）。
2. **样式 0–9，编号语义全变**。特别是旧「3 经典动态」在新系统是 **Static Circle**——禁止按编号直搬。
   默认样式保留 **4 Static Cross**（92% 选手在用），下拉里注明 **7 Dynamic Quad 是游戏全新安装的默认**。
3. **描边**：`outlineMode` 0/1/2（无/全/**半**）+ 独立 **描边 RGBA**。
   半描边**只绘制轮廓左上两条边**，不是「细描边」，UI 已明示。
4. **透明度**：`cl_crosshairusealpha` 删除，`cl_crosshaircolor_a` 常开。
5. **新增**：`cl_crosshair_dynamic_spread_limit`、`cl_crosshairoutline_r/g/b/a`、`cl_crosshair_screen_height`、`cl_ironsight_dot_scale`、`cl_ironsight_usecrosshaircolor`。
6. **旧 convar 的两种情况**（**输出中一律不出现**，有测试断言）。三份常量：
   `CS.REMOVED_CONVARS`(6) + `CS.HIDDEN_LEGACY_CONVARS`(3) = `CS.NEVER_OUTPUT`(9)。
   - 客户端**已移除**（6 条，本机用户配置里查不到）：
     `cl_crosshair_outlinethickness`、`cl_fixedcrosshairgap`、`cl_crosshairgap_useweaponvalue`、
     `cl_crosshairusealpha`、`cl_crosshaircolor`、`cl_crosshairgap`。
   - 客户端**仍保留但已 hidden、不参与渲染**（3 条）：`cl_crosshairsize`、`cl_crosshairthickness`、`cl_crosshairalpha`。
     实测（2026-10-15）客户端仍会把这三个写进用户配置，值还是旧刻度残留（0.5 / 2 / 255），
     **不要据此换算**。
   > 判定方法是「存在可证、不存在不可证」：用户配置是稀疏存档，只写非默认值，
   > 所以「不在配置里」只是「很可能已移除」的旁证，上面的常量是**输出策略**而非实测结论。
   （注意 `cl_crosshair_gap / _length / _thickness / color_a / color_r` 是**合法新命令**，只有下划线位置不同的那批才是旧名。）

7. **新旧混合文本**：客户端会把新命令与旧残留**同时**写进用户配置，
   所以解析器只在「出现旧名、且一个旧名之外的新名都没有」时才按旧系统换算，
   否则旧名当作存档残留忽略并在提示里列出。

---

## 5. 数据兼容：旧码懒迁移与三处「近似」

`CS.decodeInfo(code)` 返回 `{ model, container, format, migration }`：
cs2 容器精确解析，legacy 容器解析后换算并在 `model.migration.notes` 里给出人话提示，UI 必须显示。

换算（`core-convert.js`，legacy-v1 专用）：
```
f = max(1, floor((T + 0.2222) / 0.4444))   厚度像素
b = floor((L + 0.2222) / 0.4445)           臂长像素
x = trunc(G) + 5   (旧 style 2 静止)  /  gapRound(G) + 4  (其余)
gap = x + ceil(f/2)  → 默认（2026-10-16 离线裁决：新 gap 是中心起算，见 lab-report §6）
gap = x             → 应急出口（opts.gapOrigin === "arm"）
```

**渲染侧**：模型 `gap` 保持游戏语义（中心起算）；`render-model.js` 内部换算
`x = round(gap×scale) - ceil(f/2)` 后用旧公式的臂放置公式——258 个新格式页面官方矩形
实验中 255 个命中该关系（含奇数臂厚左右差 1px 的细节），迁移后 `x` 回到 `x_old`，
旧观感逐像素保留（verify.js ② 39516 个对拍用例全过）。

**三处必须让用户看见的近似**：
1. **负 gap**：换算后 gap < 0（全库 184 条）在新菜单里设不出来（菜单最小 0，仅 style 2 可负），仅控制台可设 → 标「近似」；
2. **细描边 0.5 → 半描边**：语义不等价（新版只描左上）→ 标「近似」；
3. **旧描边 ≥1.5**：新系统描边宽度固定 1px，无法再调 → 标「有损」。

其他：`fixedCrosshairGap`、`deployedWeaponGapEnabled`、`cl_crosshairusealpha` 被丢弃并计数（`migration.dropped`）。

---

## 6. 未决问题（需游戏内实验，代码里已留位）

> **2026-10-22 更新**：R1（各样式真实几何）已由 `client.dll` 反汇编定案，不再是近似。
> 完整逆向见 [`tools/re/CROSSHAIR-REVERSE.md`](tools/re/CROSSHAIR-REVERSE.md)：
> 调用链 `0x11d3100 → 0x180d9bc70 → 0x180da0610`，10 个样式的入口表与像素级公式、
> 6 个绘制原语（RECT / ARMS / RING / ARC / ARC_OUT / SQUARE）、
> 公共前奏（散布分数 → t → alpha → 半径 → clampR）全部已实读。

| # | 问题 | 代码位置 | 裁决实验 |
|---|---|---|---|
| ~~R1~~ | ~~新样式 1/3/7/8/9 的真实几何~~ → **已由反汇编定案（2026-10-22）**：style3 内径 `max(1,gap)`、style8 外沿 `max(0,gap)+thickness`、style7 弧半径 `clampR+thickness`、style9 `max(1,gap)+thickness` 且 90° 轴向、style6 在 dot 开时不画 | `render-model.js` 的 `SHAPE` | **已结项（静态反汇编）**，像素终验仍建议做 |
| ~~R3~~ | ~~旧 gap 换算取候选 A 还是 B~~ → **已离线裁决（2026-10-16）**：候选 B（中心起算），依据 258 新格式 + 82 旧格式页面样本；游戏内截图终验仍待做 | `core-convert.js`（默认 `"center"`） | **已结项（离线）**，E4 终验 |
| R4/E5 | 非 1080 高度的取整推广 | `render-model.js` 的 `displayScale` | E5 |
| ~~R6~~ | ~~`cl_crosshair_screen_height` 是否真实存在~~ → **已由实机证实存在**（2026-10-15，值 960 = 分辨率高度 1280×960）；默认值仍未验证 | — | **已结项（存在性）** |
| R11 | 游戏导入 cs2-v1 时的规范化规则 | `test/lab/roundtrip.js`（未建） | E2 |
| R12（新） | 动态半径的 3D 投影标定：算法已还原（`0x180d9e560`），但「朝向 / FOV / 视口三元组 → 像素」缺游戏内实测 | `render-model.js` 的 `spread` | 需 CS2 重开 |

⚠️ 上述未确认项**不影响编解码正确性**（与官方实现逐字节一致），只影响「在游戏里看起来对不对」。

---

## 7. 测试

```powershell
# 本机 Node 不在 PATH 上，用绝对路径：
$NODE = "C:\Users\26498\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $NODE test/run-all.js        # 一次跑完全部套件
& $NODE test/vectors-check.js  # Phase 0 向量
& $NODE test/check-codec.js    # Phase 1 四布局 + oracle 双向对拍
& $NODE test/verify.js         # Phase 3 渲染与迁移保真
& $NODE test/check-paste.js    # Phase 4 convar + 512 限制 + 无旧 convar
& $NODE test/check-dom.js      # Phase 5 DOM id 对齐
& $NODE test/check-page.js     # Phase 5 jsdom 整页回归
```

重新生成对拍向量（需要网络，仅维护时用）：

```powershell
cd _oracle; & $NODE gen-vectors.mjs
```

---

## 8. 「选手准星库 / 数据抓取」的适配（2026-10-16 已完成，闸门已移除）

> 历史备注：重构初期这三处（`auto-update.js` / `sync-prosettings.js` / `check-freshness.js`）
> 曾以退出码 3 的显式闸门拒绝运行，防止旧刻度数据覆盖 `players.js`。
> **该闸门已在 2026-10-16 抓取器适配完成后全部移除**，`sync-prosettings.js` 也被删除。

当前实现：prosettings 站点已迁移新准星系统，选手页给新 convar 名 + 文本样式名、不再给分享码；
抓取器（`tools/prosettings-parse.js` 共享解析）把新字段组装成新像素模型并生成 **cs2-v1 分享码**
（`players.js` 的 `c2` 字段），旧格式页面走 legacy 编码 + 按选手分辨率有损转换并打 `lg` 标记。
正确性证据：`test/check-scraper.js` 用真实页面断言「页面字段→模型→编码」与站点发布码逐字符一致。

2026-10-17 起，抓取范围收敛为**近两年 CS Major 参赛队**（`MAJOR_TEAMS` 白名单，详见 `REFACTOR.md` 第 6 节）。

### 8.1 战队档案接入 HLTV.org（2026-10-22）

准星库新增**战队详情卡**后，战队档案与准星数据分成两条独立数据线：

| 数据 | 来源 | 生成物 | 抓取脚本 |
| --- | --- | --- | --- |
| 选手名单、准星、分享码、历史版本、外设、视频设置 | prosettings.net | `js/players.js` | `tools/auto-update.js` |
| 队标、国家、Valve/世界排名、世界前 30 周数、平均年龄、教练、现役阵容、奖杯、社交、战绩（**界面只渲染队标 / 队名 / 国家 / 三枚排名 / 现役阵容**） | HLTV.org | `js/hltv-teams.js` + `assets/hltv/teams|players|flags` | `tools/hltv-sync.js` |

**为什么必须用浏览器抓**：HLTV 全站由 Cloudflare 挑战保护，Node/curl 直连一律 403；
图片 CDN（`img-cdn.hltv.org`）还会校验页面签名，站外直连返回 `sig_invalid`。
所以 `tools/hltv-sync.js` 通过 **CDP 驱动本机有头 Edge**：先让浏览器自己过盾，
再在页面上下文里提取 DOM + JSON-LD 字段，并在页面里 `fetch` 图片转 base64 回传落盘。
headless 模式会被识别拦下，必须带窗口运行（默认端口 9223，可用 `--port=` / `CDP_PORT` 改）。

**字段来源**：队标与国家旗取自 `div.profileTopBox`；五项 `div.profile-team-stat`
提供 Valve 排名、世界排名、top30 周数、平均年龄、教练（**教练自 2026-10-26 起不再在界面上展示，也不给 HLTV 外链**）；阵容优先用 JSON-LD 的
`SportsTeam.athlete`（最稳），并用 `div.bodyshot-team` 交叉校验 IGL 标；
战绩解析 `table.match-table` 的 `tr.team-row`。比赛表是 JS 后置渲染，脚本带轮询重试。

**数据形状**：`window.HLTV_TEAMS` 是**以战队 key 为键的对象**（与 `PRO_TEAMS` 的 key 一一对应），
`window.HLTV_META = {updated, source:"hltv.org", teams, withLineup, withRank}`。
前端不做任何 `fetch`（`test/check-dom.js` 现在硬约束 `fetch` 为 0 处、且不得出现任何 `/api/` 路径），
新增 `js/hltv-teams.js` 后两个测试的脚本顺序数组已同步更新。

**已知缺口**：

- **3DMAX**：HLTV 上只剩 2015 年的同名老队页（无阵容、无排名、队标是灰色盾牌占位 `.bin`），
  UI 走空态并回落本地 `assets/teams/3dmax.png`。这不是抓取失败，是源站确实没有当前队页。
- **国旗尺寸单一**：HLTV 只提供 30×20，个别国家缺图，前端回落 emoji 旗帜。
- **阵容与 prosettings 不同步**：本地 172 名选手里 141 人能在对应 HLTV 现役阵容中按昵称命中，
  卡片上的「HLTV 现役」标只按**精确同名**判定，匹配不到就不显示，不做模糊匹配或推测。

---

## 9. 已知取舍

- **控制台单行：一次性粘贴已达成**。准星本体命令 + 镜内准星点共 20 余条，
  默认配置 330 字符 / **1 段**；当前全库 1701 条码**全部 1 段**、最长段 486
  （2026-10-18 数据快照，`node tools/auto-update.js` 全量重抓后实测；2026-10-22 style 5 定为单套臂后刷新）。
  只剩「style 2 动态分裂 + 开启描边 + 自定义分裂参数」这类极端组合会超 512，此时按命令边界切 2 段并在 UI 说明。
  详见 `REFACTOR.md` 第 5 节。
  （2026-10-17 起投掷物准星命令已随功能精简移除，粘贴行更短。）
- **`cl_crosshair_screen_height`**：**已由实机 vcfg 证实存在**（2026-10-15，CS2 1.41.9.1，值 960 与分辨率 1280×960 一致）——R6 的存在性问题结项。
- **客户端版本比计划基准更新**：计划以 1.41.8.8 为基准，本机实机是 **1.41.9.1（2026-10-14）**。
  分享码布局（cs2-v1）来自 npm `csgo-sharecode@7.0.1`，**未对照 1.41.9.1 实测过**；
  建议用游戏内导出的分享码做一次 round-trip 确认（见 `tools/lab-report.md` 第 4 节）。

---

## 10. 实机比对（2026-10-15，只读）

完整报告：**`tools/lab-report.md`**；工具：`test/lab/read-vcfg.js`、`test/lab/compare-vcfg.js`。

结论摘要：生成器不需要结构性修改，核心假设全部被实机证实
（新命令名、样式 0–9 语义、`cl_crosshair_screen_height` 存在、旧 convar 为 hidden 残留）；
实机 convar 灌进生成器再导出 **15/15 项 1:1 还原**。
本次实机数据还揪出并已修复一个真实缺陷：**新旧混合文本被误判为纯旧文本**（见第 4 节第 7 条），
回归测试固化在 `test/check-paste.js` 第 ⑦ 节（fixture：`test/fixtures/vcfg-crosshair-20261015.txt`）。


---

## 11. 输出与预览的呈现方式（2026-10-18 UI 重构）

这一节说明「用户在页面上看到的东西」是怎么来的 —— 引擎（几何 / 编解码 / 命令）与呈现层（DOM / CSS）的分界。

### 11.1 控制台命令：显示逐句一行，复制单行分号

- `js/core-convars.js` **不参与**这个决定。它只负责按 512 字符切成「真正要粘贴的段」（`toPasteChunks`）。
- 呈现层在 `js/app.js`：`pasteCommands()` 把每段按 `;` 切开、trim、摊平；`renderPaste()` 用 `\n` 连接后写进 `#cfgOutput`。
- `copyPaste()` 与「复制命令」按钮始终复制 `chunks[0]` —— **单行分号版**。这就是控制台唯一接受的形式，与展示格式解耦。
- 因此「逐句换行」是纯展示优化：既方便逐项核对，又不改变任何实际粘贴内容。文本长度提示（`单行 n / 512 字符`）统计的仍是那一行真实长度。

### 11.2 预览：1 模型像素 = 1 CSS 像素

- `js/render-model.js` 只输出几何（模型像素），**不接收画布宽高或 DPR**；`js/render-canvas.js` 负责把几何映射到设备像素（整数吸附、半开区间 `[c-n, c+n)`、宽高恒偶）。
- `js/app.js` 的 `paint()` 传 `unit = dpr`（缩放恒 1），canvas 内部尺寸 = CSS 尺寸 × dpr。因此「屏幕上看多少像素，游戏里就是多少像素」。
- 浏览器实测：默认模型 4 / 11 / 2 / 7 在 368×206 画布上绘出 bbox 36×36，与 `crosshairRects` 的外沿 ±18 完全吻合。
- 实机复核（1920×1080）：style 1/4/5/7 与引擎一致；style 0（实机 50 vs 引擎 60）与 style 2（实机 70 vs 引擎 60）存在已知偏差，静息帧逐行结构已确认是真机行为，**尚未定标定函数**，本轮不动几何。

### 11.3 布局：预览常驻侧栏

- 宽屏：`.gen-layout` 两列，右列 `.gen-rail{position:sticky;top:74px}`，滚动时预览不离开视野。
- ≤1240px：单列，`.gen-rail{order:-1}` 让预览排到最前（先看到结果，再改参数）。
- 改任何参数都会同步触发 `updateAll()` → `renderPreview()` → `renderMainPreview()`，即改即见。

### 11.4 选手详情：当前准星并入历史

- `openModal(p)` 在 `p.h` 之前插一条 `.hist-entry.is-current`，用当前码 `p.c2 || p.c` 渲染，带 `<span class="h-now">当前</span>` 与来源「最新检测 · 正在使用」。
- 该条与历史条目走**同一套** `histActionsHTML` 规则：旧码显示「转换」（先弹出差异确认），新码显示「复制」，行首以 `旧/新` 徽章标注格式。
- 数据保障：172/172 人都有 `c2`，且 `h[0].c` 从不等当前码，不会重复。
