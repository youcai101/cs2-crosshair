# REFACTOR.md — 架构优化 · 渲染重构 · 准星库更新

> 对应任务书：`C:/Users/26498/WorkBuddy/crosshair-re/dsh提示词-架构优化与准星库重构.md`
> 项目：`D:/Documents/cscrosshair` · 完成日期 2026-10-15
> 相关文档：`CS2准星重构-实现说明.md`（格式与迁移细节）、`tools/lab-report.md`（实机参数比对）
>
> **后续变更（2026-10-17）**：按产品要求移除 Imperial、Metizport、Nemiga Gaming、The Huns、Fnatic、Fluxo
> 六支战队的准星数据，当前库为 **31 队 172 人**；本文中「37 队 208 人」为移除前的基线数字。
> 同批次上线了等比预览、动态预览与 UI 视觉/交互升级。

### 2026-10-17 增量：预览比例 / 动态预览 / UI

- **等比预览**（已废止，见下方「1:1 收敛」）：曾用 `previewUnit(stageHeight, screenHeight, lens)` 把背景与准星同步缩放，提供 1× 整屏 / 1:1 原生像素 / 2× / 4× 四档。**该函数与四档控件已于 2026-10-18 全部删除**。
- **亚像素渲染**：展示缩放 < 1 时取消「最小 1 设备像素」吸附，改用浮点坐标抗锯齿；否则 1080p 下 1px 厚的小准星在 560px 舞台里会被画粗约 2 倍，这正是实机对比中最明显的偏差。
- **动态预览**：`render-model` 新增 `spreadPx / climbPx / splitScale` 动画参数；UI 用 rAF 模拟连发扩散、后坐力上抬与回落，支持自动循环与按住画面连发；style 2 的分裂距离也走同一条 0→1 包络，所有动态样式共用同一套时序与上限。静态样式禁用。详情页动态样式另有播放按钮。
- **动态几何实机校正（1920×1080 逐像素）**：用本机 CS2 本地图 + AK 连发采集了 style 0/1/2/5/7 的静息与开火帧（`shots/matrix-style*.bmp`）。
  - style 0：四臂 gap 外扩（0.35s +7px），length/thickness 不变。
  - style 1：**圆环**，基准外径 18px（外半径 9），开火扩到约 32px；与 length/gap 无关。
  - style 2/5：外臂整体外推、内臂按 innermod 淡出（innermod=1 时内臂完全隐藏）。
  - style 7：**四臂固定 + 中心菱形环**；菱形环静息 16×16（外半径 8），AK 连发扩到约 60×60（外半径 30），四臂不动。`SHAPE[7]` 从 `quad` 改为 `crossRing`。（**2026-10-21 已纠正**：实为四段 45° 象限弧 4→73px，见下「样式 7 几何纠正」）
  - gap 语义再次实锤：style 7 大尺寸静息 60×60、臂 20px、gap 10 → 中心到臂内沿 10px。
- **准星库**：移除 Imperial、Metizport、Nemiga Gaming、The Huns、Fnatic、Fluxo 六队（36 人），当前 31 队 172 人；`tools/auto-update.js` 增加 `EXCLUDED_TEAMS` 防止回填。
- **UI**：预览舞台加大、地图改为常显胶囊栏、新增常用色快捷按钮、选手库搜索栏吸顶、面板/按钮/滑杆视觉细化，深浅色主题同步校准。

### 2026-10-22 增量（三）：style 5 反馈半径落地（v4.1）—— k 的来源定案

- **由**：v4 把动态半径/clampR/门控/style2 都对齐了，只剩 style 5 的 `k` 未定位（差异表里唯一 ⚠️）。
- **取证**（`0xda6b60` 全函数 + `0x18015a220` 实读）：
  - `k_state = [drawState+8]`（+4 是浮点 k）；`k = clampf(k, 0, 25)`（0x41c80000 = 25.0）。
  - 预览分支 `[+0x5c] && [+0x5d]`（**不是开镜**）：每帧 `k += 15`（0x1af3d1c）→ 很快饱和到 25。
  - 非预览分支：按武器表字节（`0x2233ed2`/`0x2233f62`，stride 0x1c）判断命中反馈武器，取射击计数 n，`k += n/3.5`（0x1bb6c08）。
  - 衰减：`k -= frametime × 42`（0x1cbbc74，每秒 42）。
  - 半径：`r = roundf(max(0, gap) + screenHeight × k / 1200)`（0x1c0a240），只调一次 ARMS；不吃 clampR、不吃 spread_limit。
- **落码**：
  - `js/render-model.js`：新增 `SPREAD_UNIT_BASE_HEIGHT = 1200`、`SHOT_FEEDBACK_MAX_K = 25`；metrics 新增 `shotK/shotR/style/shotFeedback/armStart`；
    `armStart = (radiusStyle ? clampR : style5 ? shotR : gapPx) - ceil(f/2)` —— 臂根口径收敛到一处（此前是 `x + spread` 二次拼装）；`span` 改按 armStart；四臂不再局部加 spread。
  - `js/core-codec.js`：`STYLES[5]` 加 `feedback: true`（形状静态、但有反馈脉冲），新增 `hasFireFeedback(model)`；`js/codec.js` 透出。
  - `js/app.js`：`isDynStyle()` 改为「动态散布 或 有开火反馈」，style 5 因此可开「动态预览」；散布计标签新增 `FEEDBACK`，读数 = `shotR - gapPx`；
    style 5 的提示文案改写（k 模型、上限 25、每秒衰减 42、满量 +22.5px @1080p）；预览按钮 / recoilRow / railHint 改用 `animatable`（散布滑杆仍按 `dynamic` 禁用）。
- **数值**：1080p 满量 `round(22.5) = 23`（gap 6 → 29）；720p 满量 `round(15) = 15`。
- **测试**：`test/verify.js` 新增 6 条 style5 断言（不分裂 / 静止 = gap / k=25 / +23@1080p / +15@720p / 右臂内沿落在 shotR）；
  `test/check-page.js` 新增 4 条 UI 断言（预览可用 / 散布上限仍置灰 / 标签 FEEDBACK / 读数 0–23）；8 套件全绿。
### 2026-10-22 增量（二）：绘制引擎 v4 —— 按 client.dll 反汇编定案

- **依据**：CS2 `game/csgo/bin/win64/client.dll` 静态反汇编（完整报告见 `tools/re/CROSSHAIR-REVERSE.md`）。
  - 调用链：`0x180DB8E80 EnqueuePreviewDrawCommand → 0x180DA0610`（CrosshairParamBuffer_t 消费者，按 `[rdi+0x64]` style 查跳表 `0xDA108C` 分派到 10 个样式实现）。
  - 绘制原语：`0x180DA8410` RECT（x/w 各 -1）、`0x180DA6290` RING（内径 r、向外扩 w、中心 -0.5 半像素）、`0x180DA61C0` ARC（type 2，外径 r、向内收 w）、`0x180DA6080` ARC 描边变体（type 1）、`0x180DA63F0` ARMS（四臂，T 型跳上臂）、`0x180DA7510` 中心方块。
- **逐样式几何（本次落码）**：
  - style 0/4：ARMS(gap=`[+0xb4]`/`[+0x74]`, len=`[+0x7c]`, thick=`[+0x78]`)。
  - style 1：RING 内径 = dist，宽 = thickness。
  - style 3（0xda6a80）：RING 内径 = `max(1, gap)`，**与 length 无关**（旧 v3 用 gap+length，已改）。
  - style 7（0xda6e60）：先 ARC 再 ARMS；弧张角 `45 - clamp((s48 - s4c)/(0.2 - s4c),0,1)×40`（45°→5°），外径 = clampR + thickness，其中 `clampR = min(limit+64, max(dot? thickness : 0, softClamp(dist, (limit+64)×0.75, limit+64)))`。
  - style 8（0xda7110）：四边 RECT，外沿 = `max(0, gap) + thickness`、边宽 = thickness（不是四角块）。
  - style 9（0xda7390）：单条 ARC × 90° 平铺 4 段（轴向），外径 = `max(1, gap) + thickness`。
  - style 6（0xda6e30）：`dot`（`[+0x70]`）非 0 时**直接不画**（中心点已在公共前奏画过）；否则中心 thickness² 方块。
  - style 2（0xda66c0）：`(s48+s50)×320/(s54×0.0174533×0.5)` 得分裂量，内/外两套 ARMS，alpha 分别 ×`[+0x94]`。
- **API 变化**：`crosshairMetrics` 新增 `squareOuter`；`ringR` 统一为「基准 + thickness/2」（RING 从内径外扩 / ARC 从外径内收的折中）；`quadrantArcs(r,w,axisAligned)` 的 axisAligned 张角改 90°；`clampR` 的下界改按 **dot** 判定（`0xda0bc5 cmp byte [rdi+0x70],0`），不再按描边判定。
- **测试**：`test/check-page.js` 的 style 7 期望改 `12 → 82`、style 1 改 `11 → 81`，并新增 `clampR 下界 = dot ? thickness : 0` 断言；8 套件全绿。
- **注意**：`gap` 的像素换算（`0x180D9E560` 把 (gap,length,thickness) 归一化方向 × t 投影后量距离）仍以 1080p 实测 70px 反推为主，未做逐分辨率定标。→ **v4 已定标**：`R = focal(H) × t`、`focal = 2H/3`（见下方 v4 增量）。

### 2026-10-22 增量：绘制引擎 v3 —— 按游戏 ConVar 语义重写

- **依据**（四条互相验证）：
  1. **client.dll 里的 ConVar 帮助文本**（字符串区 0x1CB4600–0x1CB5C00）：`cl_crosshair_gap` = “Offset added to the gap between the crosshair center and the bars”；`cl_crosshair_length` / `cl_crosshair_thickness` = “scaled with screen resolution（minimum 1 pixel）”；`cl_crosshair_dynamic_spread_limit` = “additional distance the dynamic elements are allowed to spread out to from the baseline of 128 pixels”；`cl_crosshair_drawoutline` = “0 No outline / 1 Full outline / 2 Half outline”。
  2. **设置结构体布局**（client.dll 0x180DBAFB0 读写器）：0 长度、1 间隙、2 粗细、3 中心点、4 T 型、9–12 颜色 RGBA、17 描边、18 描边色、19 后坐力、20 散布上限、21 样式。
  3. **CS:GO 绘制算法**（fivem `DrawImNatives.cpp` 移植版）：`dist = m·h/1200 + gap`、`barsize = length·h/480 + 1`、`thickness = max(1, round(thickness·h/480))`。
  4. **游戏内 1:1 预览实测**（2026-10-21，1080p）：style 7 弧环 4→73、弧粗=thickness、4×45°。
- **新语义**：所有动态样式共用一个「散布距离」`dist = gap + spread01 × 散布上限/255 × 70px @1080p`；style 0 用 dist 推四臂；style 1 圆环半径 = dist；style 7 弧环半径 = dist；style 2/5 仍走 split 公式；style 3/8/9 半径 = gap + length（静态）。
- **API 变化**：`SHAPE` 改为 `cross / crossSplit / circle / quad / square / dot`；`crosshairMetrics` 新增返回 `spread / dist / ringW`；`buildDrawOps` 的 layer 统一 `{rects, rings, arcs}`；`SPREAD_MAX_PX = 70`（取代旧 16 / RING_MAX 73 / CIRCLE_MAX 30）。
- **动画节奏**：`DYN_CYCLE_MS 2400 → 2950`（1250 开火 + 1300 回落 + 400 静息），dynTick 速率 1.6/s 升、3.2/s 落，对齐游戏预览 2.7–3s 一轮。
- **测试**：`test/check-page.js` 与 `test/verify.js` 的样式 1 / 7 / 9 期望值同步；8 套件全绿。
- **未完成**：dist 的"满散布 70px"是 1080p 实测反推值（对应 limit 255）；低分辨率/非 1080p 基准的换算与武器散布曲线仍按比例近似，`tools/lab-report.md` §9.4 保留为未覆盖项。→ **v4 已替换为投影模型**（70px 退役，改为 `2H/3 × 0.1` = 72px @1080p）。


### 2026-10-21 增量：样式 7 几何纠正（四段象限弧）

- **证据来源**：游戏本体的「准星 / 瞄准镜」设置页实时预览（Dust II 背景）。预览是 **1:1 真实像素**——1080p 窗口对应 1080 基准，不做缩放；滑块值与量到的像素逐项吻合。
- **实测几何**（样式 = 动态象限，length 8 · gap 4 · thickness 2 · 完整轮廓 · 中心点 否）：
  - 四臂：内沿 4.5px、外沿约 11.5–12px、绿色厚 2px + 1px 黑描边；整段动画中四臂**完全静止**。
  - 圈：**四段 45° 圆弧**，圆心分别落在 45°/135°/225°/315°（轴向 0/90/180/270 各留空约 44°）；弧粗 = thickness（2px + 1px 描边），角度跨度恒定 45°，不随半径变。
  - 半径：静息时中心线半径 ≈4（弧正好贴在十字臂外沿），满散布演示峰值 ≈73；可见循环约 2.7s（出 → 扩 → 收 → 隐）。
- **实现**：`js/render-model.js` 新增 `ARC_SPAN_DEG = 45` 与 `quadrantArcs()`；样式 7 的第 5 层由 `diamonds` 换成 `arcs: [{r, w, a0, a1}] × 4`；`RING_BASE_PX 8 → 4`、`RING_MAX_PX 30 → 73`；样式 1 的上限独立成 `CIRCLE_MAX_PX = 30`（行为不变）；弧宽不再按散布收窄（游戏实测恒定 = thickness）。
- **渲染**：`js/render-canvas.js` 按层画弧——先 `stroke(arc, lw = 弧粗 + 2×描边)` 补外轮廓，再 `stroke` 主色，`lineCap = butt`（游戏弧端是平头）。
- **推翻的旧结论**：2026-10-17 的「中心菱形环 8→30px」是实机连发截图在低分辨率下的推断；本次以游戏原生预览逐帧测量为准，旧图（`shots/matrix-style7-*.bmp`）已不在仓库，无法再复核。

---

## 0. 结论摘要

| 目标 | 状态 | 关键证据 |
|---|---|---|
| 架构优化（拆分单体、内部模型统一像素刻度） | ✅ | `js/codec.js` 828 行 → 8 个单职责模块（合计 1865 行）+ 180 行门面 |
| 渲染与分辨率/比例/DPR 无关 | ✅ | `test/check-render-invariance.js` 6 组断言全绿；小数 DPR 下外沿偏差 ≤ 0.33 游戏像素 |
| 控制台命令一次性粘贴 | ✅ | 默认配置 330 字符 1 段；全库 **1701/1701 条全部一次粘贴**（2026-10-22 style 5 定为单套臂后，原先 21 条 2 段清零） |
| 准星库新旧规则 | ✅ | 旧准星：应用/预览可用，复制走「转换 + 差异确认」，原码可存档；新准星完整功能分支已实现 |
| 功能精简 | ✅ | 删除 15 项（含网页后台、/api、5 个部署类 .bat、垃圾目录与 zip） |
| 无构建步骤 / 双端兼容 | ✅ | 仍是 vanilla JS + `<script>` 顺序加载；Node 端 `require` 全部通过 |

---

## 1. 架构变化

### 1.1 模块划分（`js/`）

| 模块 | 行数 | 职责 |
|---|---|---|
| `core-alphabet.js` | 196 | Base57 容器：码 ↔ 字节 ↔ 大整数、校验和、容器识别（与布局无关） |
| `core-layouts.js` | 309 | **声明式字节表**：四种布局的字段/位偏移/位宽/步进/取值范围 + 位域读写引擎 |
| `core-codec.js` | 182 | 新像素模型 CrosshairV2 + cs2-v1 读写 + 样式表（0–9） |
| `core-legacy.js` | 90 | legacy-v1 / v3 / v4 读写（**只进不出**，仅供导入与对拍） |
| `core-convert.js` | 198 | 旧刻度 → 新像素（单向），含丢弃字段计数与近似提示文案 |
| `core-convars.js` | 448 | 新 convar 双向映射、样式条件输出、量程裁剪、一次性粘贴分段 |
| `render-model.js` | 242 | 新像素度量 + 10 样式行为表 + `displayScale` + scope dot |
| `render-canvas.js` | 200 | Canvas 像素吸附渲染 + canonical PNG 导出 |
| `codec.js` | 180 | **兼容门面**：合成 `window.CS2Crosshair`，统一容器分发（cs2 精确 / legacy 懒迁移） |
| `app.js` | — | UI 层（生成器 + 准星库），不含任何几何计算 |
| `players.js` | — | 选手数据（自动生成，勿手改） |

依赖方向（单向，无环）：

```
core-alphabet ──> (无依赖)
core-layouts  ──> (无依赖)
core-codec    ──> core-alphabet, core-layouts
core-legacy   ──> core-alphabet, core-layouts
core-convert  ──> core-codec, core-legacy
core-convars  ──> core-codec, core-convert
render-model  ──> core-codec
render-canvas ──> render-model
codec.js(门面) ──> 以上全部
app.js        ──> codec.js(门面) only
```

**双端兼容约定**：每个模块用同一段 UMD 头 —— Node 分支显式 `require` 依赖，浏览器分支把导出挂到共享命名空间 `window.CS2XH`。新增模块只加一行 `<script>`，不需要构建步骤。

### 1.2 内部模型

统一为新像素刻度：`thickness / length / gap` 为 **屏幕像素**，加 `screenHeight`、`outlineMode`(0/1/2)、描边 RGBA、`scopeDot*`。
旧刻度（0.1 步进）只存在于 `core-legacy.js` 与 `core-convert.js` 内部，全工程其它地方一律使用新模型。

### 1.3 server.js

286 行 → **92 行**：只做静态文件服务（MIME、路径穿越防护、no-cache、启动横幅）。
删掉了管理员令牌、`/api/status`、`/api/update`、`/api/update/stop`、更新任务队列与 `/admin` 注入。

路径穿越防护已实测：`/../secret.txt`、`/..%2fsecret.txt`、`/%2e%2e/secret.txt`、`/js/../../secret.txt` 全部 403。

---

## 2. 删除清单（每项：删了什么 / 为什么 / 影响谁）

| # | 删除项 | 为什么 | 影响谁 |
|---|---|---|---|
| 1 | `admin.html`、`js/admin.js`、`css/admin.css` | 数据更新改为离线 CLI，网页后台不再需要 | 以前用「数据更新」页的人 → 改用 `node tools/auto-update.js` |
| 2 | server.js 里的 `/api/*` 与管理员令牌 | 同上；服务器只应做静态服务 | 同上；顶栏后台入口一并移除 |
| 3 | `更新数据.bat` | 同上，改为 CLI | 双击更新的人 → 命令行执行 |
| 4 | `安装每日自动更新任务.bat`、`卸载自动更新任务.bat` | 计划任务属部署杂项，与「精简」目标冲突 | 想定时更新的用户 → 自行用 Windows 任务计划指向 CLI |
| 5 | `防火墙放行3800端口.bat` | 一次性管理员操作，命令写在 README 即可 | 局域网共享的人 → 按 README 执行 netsh |
| 6 | `打包发布.bat` | 只为压缩两个 zip；`node tools/build-dist.js` 已足够 | 发布者 → 用 build-dist.js（zip 自行压缩） |
| 7 | `cs2-crosshair.zip`、`cs2-crosshair-github.zip` | 构建产物（各 2.7MB），可随时重建 | 无（发布时重新生成） |
| 8 | `_updated-hist.json` | 抓取器中间产物，可重建 | 无 |
| 9 | `.tmp-edge/` | Edge 用户数据目录，纯垃圾（56 项） | 无 |
| 10 | `backup/` | 手工历史备份（11 项），与 git/当前代码无关 | 无（最早备份是 2026-08） |
| 11 | `.ref/` | 旧格式参考实现；对拍向量已迁移到 `test/vectors/` + `csgo-sharecode@7.0.1` | 无（测试不再依赖它） |
| 12 | `test/shots/` | 重构期的旧 UI 截图，已失真且会误导 | 无（截图脚本保留，可随时重拍） |
| 13 | `test/check-update-api.js` | 它测的 `/api/update` 已不存在 | 无 |
| 14 | `tools/rewrite-*.js`（4 个，上一轮已删） | 9.25 基于错误公式的字符串替换式改写 | 无 |
| 15 | app.js / index.html 里的 `toUI/fromUI` 换算链（上一轮已删） | 那套 `gap+5 / length×3 / thickness×4` 换算是错的 | 无 |
| 16 | `tools/自动更新-静默.bat` | 计划任务专用包装脚本；任务的安装/卸载 bat 已删，它成了孤儿 | 无 |
| 17 | `tools/inspect-cs2util.js`、`inspect-cs2util2.js`、`find-cs2util-draw.js` | 针对旧参考实现 cs2util 的一次性逆向调试脚本；输入取自系统临时目录（文件早已不存在），现在**跑不起来** | 无 |
| 18 | `tools/sync-prosettings.js`（2026-10-16 删） | 被 `tools/auto-update.js` 取代的旧独立抓取器；两者都曾加闸门，保留两份等于留隐患 | 无（统一入口 auto-update.js） |
| 19 | `test/check-freshness.js` 旧版对拍逻辑（2026-10-16 重写） | 原按「旧 convar 名 + 旧刻度」与本地 `p.c` 比对；站点改版后本地当前准星已是 `c2` 新码 | 改用共享解析模块按新字段现场重算比对 |

**保留但需注意（未删，供你决定）**：

| 项 | 情况 | 说明 |
|---|---|---|
| `team/`（30 个队标 PNG） | 产品代码未引用 | 是 `assets/teams/` 里队标的**原图来源**，抓取器入库时用；保留以便重新生成。 |
| `_oracle/`（gitignored） | 开发依赖 | `csgo-sharecode@7.0.1` 的离线安装 + `gen-vectors.mjs`，**对拍向量的再生入口**；不进产品、不进 git。 |
| `tools/cache/`、`tools/logs/`（gitignored） | 抓取缓存与日志 | 可随时删，重抓会重建（README 已写明）。 |
| `test/shots/`（gitignored） | 验证截图 | 由 `test/shots-run.js` 生成，可随时重拍；已加入 gitignore。 |

**保留并说明理由**：`test/cdp-shot.js` 与 `test/shots-run.js` —— 任务三（分辨率与比例）与任务五（准星库规则）的验收需要在**真实浏览器**里取证，jsdom 的 canvas 是打桩的，截不出画面。它们是纯读取工具，不参与产品运行。

`tools/build-dist.js` 保留（静态发布包构建）；`cs2-crosshair/` 目录保留（发布产物，每次构建就地覆盖）。

---

## 3. 新旧准星规则（任务五）

### 3.1 判定依据：**源数据时代**，不是迁移后的格式

```js
// 当前准星：m.from 以 legacy 开头 → 旧准星；否则（prosettings 新格式页面）→ 新准星
// 历史条目：h.lg（采集时记录的 legacy 标记）优先，老数据按码容器兜底
function playerLegacy(p) {
  if (p.m && /^legacy/.test(p.m.from || "")) return true;
  if (p.c2) return false;
  var info = CS.decodeInfo(p.c);   // 兜底
  return !!info && info.container === "legacy";
}
```

2026-10-16 全量更新后的 `js/players.js`（58 队 331 人）：**新格式页面 265 人走「新准星」完整功能分支；
旧格式页面 66 人走「旧准星」分支（仅存图）**；历史版本按各自 `lg` 标记逐条判定（新旧混合）。

### 3.2 旧准星（双轨：可用优先，差异显式）

| 能力 | 状态 |
|---|---|
| 保存预览图 | ✅ 可用（基于迁移后的近似值渲染，文件名带 `-approx`） |
| 查看参数 / 选手信息 / 历史版本 | ✅ 可用 |
| 应用到生成器（调参用） | ✅ 可用，应用后提示「旧码已近似转换」 |
| **复制转换码** | ✅ 可用：先弹出差异确认（`migration.notes` + 参考高度 + 有损/直搬），确认后复制 cs2-v1 转换码；toast 明示「非选手原码」 |
| **复制命令 / 下载 .cfg** | ✅ 可用：基于转换后的模型；toast 与 .cfg 文件名标注「近似换算」 |
| **复制原始码** | ✅ 仅存档：`<details>` 折叠区，复制时提示「游戏已不支持导入」 |

原因文案：**「旧格式码已被游戏拒绝导入。下面复制的码与命令都是按参考分辨率换算出的新值，转换前会列出差异；原始码仅保留作存档。」**

实现要点：

- 差异列表直接复用 `model.migration.notes`（样式映射、负 gap、描边模式、超量程等），不再另造一套文案；
- 确认框展示 `原格式 / 参考高度 / 目标 cs2-v1 / 有损换算`，并显式写出「不代表选手当前设置」；
- 卡片动作：旧码给「应用 + 转换」，新码给「应用 + 复制码」；不再出现死按钮；
- 历史条目：旧码给「应用 + 转换 + 存图」，新码给「应用 + 复制 + 存图」，行首加 `旧/新` 徽章，去掉「仅可存图」灰字；
- 转换路径统一走 `openConvertDialog()`，当前码、历史码、卡片入口共用同一套确认与文案。

### 3.3 新准星

复制分享码 / 复制控制台命令 / 下载 .cfg / 保存预览图 **全部可用**。

### 3.4 历史版本

`p.h[]` 每一条（含码、日期、来源赛事、`lg` 时代标记）**独立按同一规则判定**，不与选手当前准星状态耦合。旧码显示 `转换`，新码显示 `复制`，格式以 `旧/新` 徽章标注。

## 7. 页面信息架构（任务六）

### 7.1 生成器（默认页）

页面结构：`.gen-layout` 三块，按两行网格摆放 —— **第一行** `.panel.preview-panel`（实时预览，左，主视觉）
+ `.panel.share-panel`（分享与导入，右）；**第二行** `.gen-main`（参数面板，跨整行）。

`.gen-layout{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(0,1fr);
grid-template-areas:"preview share" "settings settings";gap:var(--s4);align-items:stretch}`，
三个面板各自 `grid-area`。**目标是一屏看全**：1600×1000 / 1440×900 / 1280×900 实测文档高度均 ≤1000，无需滚动。

预览面板内容：地图背景 + 准星画布（`.preview-stage`，`flex:1 1 auto` 吃掉同排剩余高度，`min-height:260px`）
+ 舞台底部一条 46px 的 `.stage-rail` 信息条（左侧 `.preview-hud` 读数、右侧地图切换 `#mapDots`——每个点自带 `.txt` 图名，
  当前图名随按钮的选中态表达，**不再单设 `#mapName` 文本节点**）。

- **预览置顶且最大**：宽屏下预览占左列 `1.62fr`，是页面第一视觉主体；不再有 sticky 右栏，也不再有悬浮小窗（`.mini-preview` 与 `updateMiniPreview()` 已整体删除）。
- **面板等高**：`.preview-panel` 与 `.share-panel` 在同一行 `align-items:stretch`，两块面板等高；分享面板内部固定高度（`#cfgOutput` 84px、`#importInput` 56px），命令框不再按内容自动撑高（`autoSize()` 已删除），否则会把预览一起拉高。
- **操作条**：动态预览 / 随机 / 重置 + **复制分享码** / 命令 / 存图，整组收进预览面板头部右侧（`.preview-actions`）。
- 舞台角落只留「1:1 预览」，读数下沉到底部信息条（HUD 11px、`.hud-rgb` 9px）；`#stageBadge` / `#stageScale` / `#railHint` 三个冗余提示已删除。
- 舞台右下角「细节」放大窗（104×104，按内容自适应 2–6×）；主画布仍 1:1，≤620px 隐藏。
- **响应式**：≤1240px 两列改 `1.45fr / 1fr`、按钮缩小；**≤1100px** 才单列（`"preview" "share" "settings"`），预览改成 `height:clamp(240px,46vw,400px)`、分享面板恢复两列；≤860px 参数单栏、预览头部动作换行、信息条换行。

参数面板用 **CSS 多栏 masonry** 排布（`.groups{column-count:4;column-gap:0}`，`.group{break-inside:avoid}`），
六个分组按高度自动分配到各栏；**≥1200px 铺 5 栏**（一屏看全的关键），≤1240px 两栏，≤860px 单栏。分组内容：

| 分组 | 内容 |
|---|---|
| 样式设置 | 10 项下拉（`编号 · 中文名（English）`，中文名与游戏内一致）+ 长度 / 粗细 / 间隙 / 动态扩散限制 |
| 颜色和透明度 | R / G / B 三滑杆 + 不透明度 `cl_crosshaircolor_a` + 色块预览 |
| 轮廓 | 三态分段按钮（无轮廓 / 完整轮廓 / 半轮廓）+ 轮廓 RGBA 四滑杆（关轮廓时置灰禁用） |
| 瞄准镜准星点 | `cl_ironsight_dot_scale` + `cl_ironsight_usecrosshaircolor` + 小预览 |
| 开关 | 中心点 dot / T 形准星 / 跟随后坐力 |
| 高级 | 开火分裂（分裂距离 / 内外透明度 / 长度比例），样式 2 时高亮（其余样式置灰） |

> 2026-10-17 精简：移除了「分辨率与缩放」组（预览屏幕高度选择器 + 宽高比/放大倍率工具条）与
> 「投掷物准星」组。理由见第 8 节。
> 2026-10-23 再精简：**删除「制作基准」组**（`#screenHeightSel` / `#vScreenHeight` / `#screenHeightNote` 三个元素
> 与对应 JS 全部移除）。CS2 的准星几何本就随屏幕高度自动等比缩放，让用户选基准分辨率反而误导。
> 模型里 `screenHeight` 字段保留（首次加载取用户屏幕高度），只用于导出 PNG 尺寸、分享码/命令里的
> `cl_crosshair_screen_height` 与库页缩略图等比还原。

分享与导入面板（`.share-panel`，与预览同排放在右上；`.share-body` 宽屏单列两段 —— 分享码/导入在上、控制台命令在下；≤1100px 单列视图下恢复两列并排）：

- **分享码输出**（只读，永远是 `CS` 开头的 46 字符新码）+ 一键复制 + 格式标签（`CS2 新格式 · 46 字符` / `CSGO 旧格式 · 游戏已不接受导入`）
- **统一导入框**（`#importInput`）：自动识别 4 类输入 —— CS 新码 / CSGO 旧码 / 控制台命令串 / .cfg 文本，输入时实时提示识别结果
- **控制台命令区**：单行分号串 + 实时字符计数 `n / 512` + 「复制命令」+「**下载 .cfg**」

### 7.2 准星库

列表页：左侧战队侧栏 252px（**HLTV 队标 26px + 世界排名 + 人数**）· 顶部搜索（姓名 / 真实姓名 / 战队名）· **位置筛选**（全部 / AWPer / Rifler / IGL）· **排序**（默认 / 姓名 / eDPI，升降序）·
键盘友好：`/` 聚焦搜索框，`Esc` 清空搜索。

**选手卡片尺寸锁定**（2026-10-23 最后一版）：`.player-card{display:grid;grid-template-rows:112px 1fr;height:250px}`（≤760px 时 `100px / 238px`），
准星画布取 `min(104, .pc-xhair 实测高 - 8)`（`cardCanvasSide()`：>760px 为 104px、≤760px 为 92px，四周各留 4px 呼吸，见 7.2.2），`.pc-top` 22px / `.pc-meta` 19px / `.pc-tags` 19px 三段固定行高 ——
徽标缺失也占位，昵称长短只影响省略号位置，**卡片永远同高同宽**。网格 `repeat(auto-fill,minmax(224px,1fr))`、gap 12px。

三个筛选维度是**与**关系（`visiblePlayers()`）：位置 × 战队 × 搜索词同时生效，互不顶掉。
位置口径由 `rolesOf(p)` 统一计算：`AWPer` 取源数据 `r` 字段，`IGL` 取 HLTV 现役阵容的 `igl` 标记，
其余归 `Rifler`；一人可命中多个位置（如 FalleN / Jame 同时是狙击手与指挥），展示用 `roleLabel()` 拼成「狙击手 / 指挥」。
「全部位置」的 `option` 用空值哨兵（`value=""`）。无结果时空状态回显当前条件并提供「清除筛选条件」。

#### 7.2.1 战队详情卡（2026-10-22 新增，数据来自 HLTV.org）

选中侧栏任一战队时，工具栏下方展开一张战队详情卡；选「全部战队」时收起（`#teamDetail[hidden]`）。
**头部一行 + 阵容横向一排**，让下方准星卡片尽早上屏：

```
头部：队标 56px · 短名 22px + 全名 · 国家/地区旗 · 行内排名（世界 #N · 区域 #N · Valve #N）·「教练 名字 ↗」·「HLTV 档案 ↗」
body：h4「现役阵容 · HLTV 当前名单 · N 人」+ ul.td-lineup 横向一排（每卡固定 196×56px：头像 40px + 昵称 14px + 指挥标 + 真实姓名 12px + 国旗），窄屏可横滑
页脚：队名 / 队标 / 阵容 / 排名 / 教练来自 HLTV.org（快照日期）· 准星与分享码来自 prosettings.net
```

> 2026-10-23 最后一版：三枚大排名块（84px 宽）改为标题行内的 `.td-rankline`（13px 行内文本），
> 详情卡整体高度从 281px 压到 239px（头部 85 + 阵容 117 + 页脚 38）；阵容卡改**固定宽高** `flex:0 0 196px;width:196px;height:56px`，
> 昵称过长只截断不撑宽 —— 不同战队的阵容行视觉完全一致。

> 2026-10-23 精简：删掉「战队档案」（教练 / 世界前 30 周数 / 平均年龄 / 冠军奖杯）与「冠军荣誉」
> 两栏，教练并入头部 `.td-meta`；`TROPHY_SVG` 常量删除。快照里这些字段仍在，只是不渲染。

字段映射见 `README-访问说明.md` 第一节「战队详情卡」。实现要点：

- 数据是**静态快照** `js/hltv-teams.js`（`window.HLTV_TEAMS` 以战队 key 为键），前端不做任何 `fetch`
  （`test/check-dom.js` 硬约束 0 处 `fetch`、无任何 `/api/` 路径）。
- `teamLogo(t, h)`：**按主题选变体** —— 深色主题且该队有 `logo.night` 时用 night，否则用 `logo.day`；扩展名必须是
  png/svg/webp/jpg（HLTV 对停更队页返回 `.bin` 灰盾占位），不合格时回落 `logo.day` → `assets/teams/<k>.png`（液体百科兜底）。
- ~~`logoFx(t)`~~：**已于 2026-10-27 整体删除**（连同 `LOGO_DARK`、`.logo-glow` / `.logo-glow-dark`、`refreshLogoFx()`）。
  night 变体已解决纯黑队标问题，额外的 `drop-shadow` 描边会在深色界面上放大视觉尺寸、糊掉小图标细节，
  用户要求「取消为了增强对比度给队标加发光边框的操作」。现在队标一律按 night/day 变体原样渲染。
  **浅色底板方案（旧 `.logo-plate` / `.logo-plate-inv`）此前已被否决并删除**。
- `lineupOf(p)`：选手卡片上的「HLTV 现役」标只在昵称与 HLTV 阵容**精确同名**时出现，不猜、不模糊匹配。
- `hltvFlag(path, cc)`：国旗缺图回落 emoji（HLTV 只有 30×20 一种尺寸）。
- 缺数据走空态：无阵容的队（当前 3DMAX）显示「HLTV 暂无现役阵容记录（该队页已停更）。」

#### 7.2.2 卡片画布的呼吸与断点跟随（2026-10-24）

卡片准星区 `.pc-xhair` 是 112px 高的定高容器，画布并不铺满它，而是取 **`min(104, 容器高 - 8)`**：

```js
function cardCanvasSide(wrap) {
  var box = wrap ? Math.round(wrap.getBoundingClientRect().height) : 0;
  if (!box) return CARD_XHAIR;
  return Math.max(40, Math.min(CARD_XHAIR, box - 8));
}
```

- >760px：容器 112px → 画布 **104px**，上下左右各留 4px，准星不会顶到分隔线；
- ≤760px：容器收到 100px → 画布 **92px**，同样保持 4px 呼吸；
- 下限 40px 只是防止极端容器塌陷时画出 0×0。

**为什么必须跟随容器**：早期写死 104px，窄屏容器只有 100px，画布会高出 4px 并被 `.player-card` 的 `overflow:hidden` 裁掉底部（canvas 底部通常是透明的，肉眼很难发现，但属于真实的布局溢出）。
现在 `paintCardCanvases(root)` 是唯一入口，`renderPlayers()` 渲染完调用它；
`window.resize` 也用 `raf()` 合并后重绘（只在选手库可见时），跨 760px 断点时画布跟着改尺寸。

#### 7.2.3 详情页（弹窗）

详情页按 prosettings 的维度顺序组织（**无数据的分组整块不渲染**）：


```
选手头部（国旗 姓名 · 战队 · 位置 · 国籍）
  ↓
Crosshair（预览 + 参数 chip + 四个动作按钮，按第 3 节新旧规则）
  ↓
鼠标 Mouse（DPI / 灵敏度 / eDPI / 开火灵敏度 / 回报率 / Windows 灵敏度）
  ↓
显示器 Monitor（分辨率 / 比例 / 缩放模式 / 刷新率 + 面板与色彩项）
  ↓
外设 Gear（传感器 / 握持形状 / 重量 / 连接方式 / 按键触发点 / Rapid Trigger / 点击反馈 / LOD / BHOP）
  ↓
Viewmodel（FOV / Offset XYZ / Presetpos / bob 参数）＋ 一键复制指令
  ↓
雷达 & HUD（缩放 / 居中 / 旋转 / 方形 / HUD 颜色）＋ 一键复制指令
  ↓
视频画面（亮度 / 显示模式 / 对比度增强 / 垂直同步 / Reflex / 最大 FPS / 画质各项）
  ↓
历史版本（按日期倒序：预览 + 日期 + 来源赛事 + 码 + 动作，逐条按新旧规则处理）
```

> ⚠️ **Gear 不含键盘与鼠标垫**：`js/players.js` 的抓取结果里**没有**这两个字段。
> 按「不为已删/无数据的功能留空状态」的原则，不渲染、也不造假数据。

### 7.3 已移除的入口

顶栏后台入口、网页「数据更新」页、旧「互转」页**全部移除**，且不留死代码与空状态：
`index.html` 无 `adminLink` / `/admin` / `/api`；`js/app.js` 无 `detectAdmin()`、无任何 `fetch()`。
（`test/check-dom.js` 与 `test/check-page.js` 都对此加了断言。」

### 7.4 视觉

沿用 `css/style.css` 既有的 Apple HIG 设计系统（间距 / 字阶 / 圆角 / 动效统一），暗色可读；
此前新增 `13.5` / `13.6` 两节样式：下拉与数字输入、字段说明、旧码提示条、统一导入框、
准星库动作区与禁用原因、分组标签、历史条目动作区。禁用态用**降不透明度 + 具体原因文字**表达，而不是只加 `disabled` 属性。

#### 7.4.1 选手准星页的尺寸收敛（2026-10-22）

用户反馈「界面里元素偏小、读起来吃力」，本轮把选手库与弹窗的字号 / 图标 / 间距整体放大一档，
**只放大外壳与文字，不放大准星像素**（预览仍是 1:1 原生像素，见第 4 节）：

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| 页头标题 / 说明 | 26px / 12.5px | **30px** / **13.5px** |
| 统计卡数字 / 标签 | 17px / 10px | **20px** / **12px**（卡宽 78→92px） |
| 侧栏宽度 | 232px | **276px**（该轮值；最后一版回调为 252px） |
| 战队项 字号 / 队标 | 12.5px / 20px | **13.5px / 24px**（行高 6×9→9×11） |
| 搜索框 / 下拉 | 12.5px / 12px | **13.5px / 13px**（input 高 7×33→10×38） |
| 分组头 队名 / 队标 | 13.5px / 24px | **15px / 28px**，卡片网格 200→232px（该轮值；最后一版队标 26px、网格 224px） |
| 卡片 姓名 / 元信息 | 12.5px / 10.5px | **14px / 12px**（队标 15→18px；最后一版姓名 15px / 队标 20px） |
| 卡片 徽标（eDPI / 动态 / 现役 / 旧码） | 9.5–10px | **12px**（padding 2×9，行高不再挤压姓名） |
| 卡片按钮 | 11px / padding 5×4 | **12.5px / 9×8** |
| 卡片准星区高度 | 96px | **124px**（≤620px 时 104px）；画布仍 96×96 像素 1:1（该轮值；最后一版已回调为 112px / 104px 见方，见 7.2） |
| 弹窗宽度 / 预览 | 940px / 132px | **1000px / 180px**（画布 156） |
| 弹窗标题 / 页签 | 21px / 12.5px | **25px / 14px** |
| 弹窗资料组标题 / 图标 | 14px / 14px | **16px / 17px**，项目名 10.5→12px、值 13→14.5px |
| 弹窗徽标（现役 / 准星类型 / Copy） | 10–11.5px | **12px**；历史「新 / 旧」格式标 9.5→**11.5px**、「当前」10→**11.5px**、历史码 11→**12px** |
| 历史缩略图 / 日期 | 56px / 11.5px | **72px / 12.5px** |

层次上的具体做法：`.pros-head-text h2` 与统计卡数字用 display 字体 + 更紧的字距拉开首屏层级；
卡片姓名从 `flex:1` 改为 `0 1 auto`，让「HLTV 现役」绿标能真正靠右（`margin-left:auto`）；
队标统一 `object-fit: contain`，PNG / SVG 混排不产生形变。

**收敛目标**：选手库与弹窗内不再有 12px 以下的正文或徽标（唯一的 11.5px 只留给历史条目的「新 / 旧 / 当前」这类极短格式标），
主力正文 12.5–14px、标签 12px、标题 15–30px。已用 CDP 在 9 档宽度（1600/1240/1100/980/860/760/620/430/360）逐一实测，
全部满足 `scrollWidth === clientWidth`（无横向滚动），且 `#view-pros` 内 12px 以下文本节点为 0。

响应式只改断点行为、不改体系：≥1180px 详情卡三列 → 980–1180px 两列（战绩跨列）→ ≤760px 单列；
≤980px 侧栏转横滚（`.team-rank` 保留；`.team-count` 已于 2026-10-27 删除）；
≤760px 卡片准星区收到 100px（画布随容器缩到 92px 见方，见 7.2.2），标题 25px、统计卡回落到 78px。

#### 7.4.2 可访问性与微交互（2026-10-23）

键盘与读屏：

- 选手卡片与分组头都是**真按钮语义**：`role="button"` + `tabindex="0"` + `aria-label`（卡片读作「昵称 · 战队 · 位置，打开详情」），
  分组头带 `aria-expanded`，折叠时同步翻转；`Enter` / `Space` 走 `bindProGrid()` 的 `keydown` 委托，`.click()` 复用同一路径。
- 页签是完整的 tablist：`role="tab"` + `aria-selected` + `aria-controls`，面板 `role="tabpanel"` + `aria-labelledby`；
  采用 roving tabindex（只有当前页签 `tabindex="0"`，其余 `-1`），`←` / `→` 循环切换、`Home` / `End` 跳首尾，切换后焦点跟随。
  主视图页签（`#viewTabs`）与弹窗页签（`#modalTabs`）同一套行为。
- 弹窗焦点管理：打开时记录 `state.modalOpener` 并把焦点移到关闭按钮；`Tab` / `Shift+Tab` 在对话框内循环（含「全部可见且可聚焦」过滤，
  转换弹窗打开时陷阱切到 `#convertModal`）；关闭后把焦点还给原卡片，滚动位置不变（所有 `focus()` 都带 `preventScroll`）。
- 动态结果用 `role="status"` + `aria-live="polite"`：`#toast`（复制成功 / 失败提示，`aria-atomic="true"`）、`#playersCount`（筛选结果数）、
  `#stageMeta`（当前准星样式名）。样式切换不会有焦点变化，靠这条播报。
- 焦点环统一用 `:focus-visible` + `--focus-ring`（2px，`outline-offset` 2px；分组头用 -2px 让环画在条内）。

按下反馈（此前只有 `.btn` 有）：

| 元素 | 按下态 |
| --- | --- |
| 页签 `.tab` | `scale(.97)`（transition 补 `transform 120ms`） |
| 战队项 `.team-item` | `scale(.985)` |
| 选手卡片 `.player-card` | `translateY(-1px) scale(.994)`，时长压到 90ms 更跟手 |
| 折叠的分组头 | 底色加深（整条 54px 缩放会露出边框缝，故不用 scale） |

滚动稳定：`scrollbar-gutter: stable` 加在 **`body`** 上而不是 `html` —— `body{overflow-x:hidden}` 会隐含 `overflow-y:auto`，
body 才是真正的滚动容器；加在 html 上不生效，切换视图时会因滚动条出现/消失横向抖动。

字号下限：全站正文与图标 **≥12px**（`.btn-ico` 12px、`.tg-arrow` 12px；此前预览操作区还有一处 10px 覆盖已改）。

文档大纲（2026-10-23 补）：改造前全站 **0 个 `<h1>`、1 个 `<h2>`**，读屏只能靠 landmark 猜结构。现在：

| 层级 | 元素 | 说明 |
| --- | --- | --- |
| `<h1>` | `.brand-name`（SHOWKEY / CS2 准星工坊） | 站点标题；`.brand-name small` 改为 `.brand-sub`，字号/字重仍由 `.brand-name` 控制，视觉不变 |
| `<h2>` | `.panel-title`×3（实时预览 / 分享与导入 / 准星参数） | 原为 `<span>`，升为 `<h2>`；`.ph-left` 随之由 `<span>` 改 `<div>`（`span` 不能包标题元素）。尺寸由 `.preview-panel/.share-panel .panel-title` 控制，布局零变化 |
| `<h2>` | `.pros-head-text h2`（职业选手准星库） | 两个视图各有一个 `<h2>` 作为视图标题 |
| `<h3>` | `#cvTitle`（复制转换码） | 转换弹窗标题，`aria-labelledby` 指向它 |

面板标题用 `<h2>` 而不是 `<h3>`：`#view-generator` / `#view-pros` 是平级的 `role="tabpanel"` 兄弟节点，
面板标题是各自 `<section>` 的直接子级，中间没有更高一级的视图标题，跳级到 `<h3>` 会破坏大纲连续性。

#### 7.4.3 对比度基线（2026-10-23）

判定口径：WCAG 2.x 相对亮度公式，正文阈值 **4.5:1**。扫描器按「外层→内层累积 alpha 合成 + 页面底色」计算真实合成色，
组透明度按「子树先合成、再与页面底混合」，而不是简单向上取最近不透明背景——后者会把 `.field-val` 误报成 1.42（真实 6.94）。

为了让所有正文达标，收紧了三个令牌 / 局部：

| 位置 | 原值 | 现值 | 原因 |
| --- | --- | --- | --- |
| `--label-3`（暗色） | `rgba(235,235,245,.52)` | `.58` | 在 `--surface-1` #131316 上 4.95 → 5.87；在 `--fill-4` 芯片底上 4.18 → 5.39 |
| `.tg-rank` / `.team-rank` | `opacity: .8` / `.85` | 去掉 | 浅色 `--accent-text` #a04a00 在白底被 opacity 拖到 4.07，去掉后 6.04 |
| `.collapse.dim` / `.is-dim` | `opacity: .45` / `.4` | `.7` | 0.45 时文字只剩 2.7，读不清；0.7 → 4.94，仍能读出「不可用」 |

RGB 三元组令牌单独拆出 `--rgb-r` / `--rgb-g` / `--rgb-b`：原硬编码 `#ff6961` / `#4cd964` / `#6d8dff` 在浅色底只有 2.55 / 1.66 / 2.75，
暗色主题保留原亮色（6.24 / 9.45 / 5.72），浅色主题换成 `#b3261e` / `#155e28` / `#1b3a8f`（6.11 / 7.37 / 9.59）。

**有意的例外**：两套主题下 `.collapse.dim` 里的 `field-val` / `rgb-*` 仍在 2.8–3.7 之间（暗色 3.28–3.46，浅色 2.83–3.67）。这些是「当前准星不适用」的**停用态**，
把 dim 提到 0.92 以上才能达标，但那样「不可用」的视觉信号就消失了，故按设计保留：可读性阈值只约束可用控件。

#### 7.4.4 高对比与强制色（2026-10-23）

系统级无障碍偏好此前完全没有响应，补两块（css/style.css 第 16 节）：

- `@media (prefers-contrast: more)`：只抬高**次要文字与分隔线**（`--label-2/3/4`、`--hairline`、`--separator`），不动主文字与强调色，避免整页被推成黑白。实测对比度：
  | 主题 | label-2 | label-3 | label-4 |
  | --- | --- | --- | --- |
  | 暗色 常规 → 高对比 | 8.51 → 12.73 | 5.85 → 10.71 | 3.66 → 7.67 |
  | 浅色 常规 → 高对比 | 7.18 → 15.07 | 5.22 → 11.67 | 3.68 → 7.55 |
  （表格数字是在 `--surface-1` 上的实测值；`--label-4` 常规态 <4.5 是有意的「最弱层级」，只用于时间戳、脚注这类可略读文本。）
- `@media (forced-colors: active)`：Windows 高对比度会强制改写颜色并丢掉 `box-shadow`，凡是「靠底色变化」表达选中态的控件都会糊成一片。给 `.tab.active` / `.segmented button.active` / `.map-rail button.active` / `.team-item.active` / `.switch input:checked + .track` 统一加 `outline: 2px solid Highlight; outline-offset: -2px`（实测浏览器解析为 `solid 2px rgb(26,235,255)`）。
- `.preview-stage` / `.pc-xhair` / `.m-preview` / `.color-swatch` 加 `forced-color-adjust: none`：准星预览与色块是**真实颜色**，被系统强制染色就看不出准星本来长什么样了。**必须连画布底色一起豁免**——只给外层容器设 `none` 时，系统仍会把它的 `background` 刷成 Canvas 黑，白线准星反而消失（实测四者 `forcedColorAdjust` 均为 `none`，其余控件保持 `auto`）。
- 顺带补 9 处缺失的表单可访问名：`#shareCodeInput`（当前准星的分享码）、`#importInput`（导入：粘贴分享码或控制台命令）、`#cfgOutput`（控制台命令输出，只读）、`#sRed/#sGreen/#sBlue`（准星颜色 R/G/B）、`#sOR/#sOG/#sOB`（轮廓颜色 R/G/B）。这些元素在视觉上靠 `.rgb-label` 和相邻块表达含义，读屏拿不到，加 `aria-label` 后实测「无标签按钮 / 无 alt 图片 / 无标签表单控件 / 重复 id / 空链接」五类计数全为 0。

#### 7.4.5 触控目标、横向战队条与令牌收尾（2026-10-24）

- **触控目标**（`css/style.css` §14.5，`@media (pointer: coarse), (max-width: 760px)`）：桌面鼠标态维持原密度，只有触控/窄屏才把可点区域抬到 ≥36–44px —— `.theme-btn` 40×40、`.tab` min-height 40、`.btn` 40、`.btn-sm` 36、`.stage-arrow` 44×44、`.map-rail button` 36（未选中项 `min-width:30px` 并居中，避免地图名把一排撑爆）、`.segmented button` 36、`.select` 40、`summary` 40。430px 实测：页签 77×40 / 90×40、主题键 40×40、地图按钮 68×36、下拉 40 高、`summary` 43 高。
- **横向战队条**（`@media (max-width: 980px)`）：侧栏转横滚时，原来沿用的纵向 `linear-gradient(180deg,…)` 遮罩会把队标下沿切掉，改为 `linear-gradient(90deg, #000 0, #000 calc(100% - 22px), transparent 100%)`（含 `-webkit-mask-image`）；同时加 `scroll-snap-type: x proximity`、`.team-item { scroll-snap-align: start }`、隐藏滚动条，滑动时每支队会自然吸附对齐。
- **死代码清理**：删掉 11 组「CSS 有、HTML/JS 全无引用」的选择器 —— `share-tip`(+`strong`/`code`)、`code-hint`、`btn-sq`(含 `:hover` 与触控块里的同类)、`panel-hint`、`ph-right`、`stage-badge`(+`::before`)、`rail-hint`、`switch-label`、`dyn-hint`(+`b`)、`paste-meta`(+`b`)、`hist-empty`；`text-wrap` 选择器里一并去掉 `.share-tip, .code-hint`。清理后全站 CSS class 278 个，已无未被引用的选择器。
- **对比度**：`.td-foot` 与 `.td-col-note` 的 `--label-4` → `--label-3`（前者 4.97 / 后者 3.65→4.97 上下），因为两者都是正文级说明而非纯装饰。逐文本节点扫描 `.team-detail *` 后，暗色 / 浅色两套主题均为 0 处 <4.5。
- **瞄准镜准星点画布**（`js/app.js` `renderScopeDot()`）：原来只设 `cv.width/height = 44 * dpr` 而没设 CSS 尺寸，DPR 2/3 时画布按 88/132px 的 CSS 尺寸参与布局，会把右侧「仅开镜时显示，与准星主体独立」的说明文字盖住。补上 `cv.style.width/height = side + "px"` 后，实测 DPR 1/2/3 的 `attr` 为 44/88/132、CSS 恒 44×44、与说明文字间距 16px。顺带做全站 176 个 canvas 的 DPR 一致性审计（生成器 + 选手库，DPR 2 与 3）：`cv.width / rect.width` 全部 ≈ `devicePixelRatio`，**bad = 0**。
- **死 HTML id**：删掉 `index.html` 里 1 个无任何引用的 `id="dynHost"`（高级参数分组容器）；`cvTitle` / `mtabBtn-xhair` / `mtabBtn-info` 虽然 JS 不直接取，但被 `aria-labelledby` 引用，**保留**。清理后全页 133 个 id 无重复、10 处 ARIA 引用全部有目标。

---

## 4. 渲染：分辨率 / 比例 / DPR 无关（任务三）

### 4.1 核心定义（写死在代码与测试里）

> **几何的唯一真源是模型中的像素值 @ screenHeight；预览只是「几何 × 展示缩放」的呈现，展示缩放不得反作用于几何。**

- `CS.crosshairRects(model, {recoil, viewHeight})` 是几何唯一来源，参数里**根本没有** canvas 宽度、DPR、画布尺寸、画幅 —— 环境参数无处可进。
- `CS.renderOpsSnapped(ctx, ops, cxDev, cyDev, unit)` 里的 `unit = zoom × dpr` 只做展示缩放。
- `CS.displayScale(model, {viewHeight}) = viewHeight / screenHeight` 复现游戏的跨分辨率等比缩放。

### 4.2 验收证据（`node test/check-render-invariance.js`）

| 断言 | 结果 |
|---|---|
| ① 重复调用 / 传入 dpr·画布宽高·画幅·zoom 等环境噪声 → 几何一字不差 | ✅ |
| ② `unit` = 1/2/3/4 时栅格恰好是 1 倍栅格的**精确放大**（逐格对应，208 格） | ✅ |
| ③ 小数 DPR 1.25 / 1.5 / 1.75 / 2.5：换算回游戏像素后外沿偏差 0.00 / 0.67 / 0.00 / 0.40 游戏像素（≤1） | ✅ |
| ④ 400×400 与 800×800 画布上，相对中心的像素布局完全一致 | ✅ |
| ⑤ 高度缩放严格等于 viewHeight/screenHeight：1080→2/8/3 · 2160→4/16/6 · 540→1/4/1 · 1440→3/11/3 · 720→1/5/2（x = gap×比例 - ceil(f/2)） | ✅ |
| ⑥ `canonicalExportSize` 不读取 `window`/`document`（用会抛错的 getter 证明），尺寸只由几何 × 倍率决定 | ✅ |

### 4.3 PNG 导出

导出走 `CS.exportPreviewPng(model, {scale: 8, viewHeight: model.screenHeight})`：

- 画布边长 = `ceil(contentSpan(model, {viewHeight}) × scale)`，**与当前窗口尺寸、DPR、预览缩放完全无关**；
- 默认 `viewHeight = model.screenHeight`，即 1:1 还原"制作时"的几何；
- 文件名带屏幕高度（如 `crosshair-style4-len11-thk2-gap7-h960.png`），满足"标注屏幕高度"；
- 导出时 `dpr` 固定为 1，避免把宿主屏幕的像素密度烧进图片。

### 4.4 gap 锚点与游戏几何（R3，2026-10-16 离线裁决）

**模型里的 `gap` 是游戏语义：臂根内沿到屏幕中心的距离（中心起算）**——分享码、convar、UI 滑杆都用这个值。
渲染内部换算成旧公式的「边沿起算」`x = gap - ceil(f/2)`，臂放置公式与旧渲染器相同。

裁决依据（离线实验，`tools/lab-report.md` §6）：把 prosettings 缓存里全部页面的官方矩形按旧公式解读：
- **新格式页面 258 个样本：255 个满足 `x = gap - ceil(f/2)`**（3 个为站点渲染离群）；
- 旧格式页面 82 个样本：82 个满足旧公式原式（边沿起算）——站点旧渲染器未变。

即游戏在新系统里把 gap 改为中心起算，且**臂粗为奇数时左右差 1px**（相当于臂贴在中心块
`[off, off+f)` 的左右沿上）——这个细节只有 258 样本量才能看出来，akiver 文档与 Valve 补丁文本都没写。
legacy 迁移因此取 `gap = x_old + ceil(f/2)`（core-convert 候选 B，默认），迁移后 `x` 回到 `x_old`，
**旧观感逐像素保留**（`verify.js` ②：39516 个对拍用例全过，含负 gap 跨中心场景）。

仍未做游戏内截图终验（E4）——若截图显示游戏其实是严格 ±gap 对称，只需把 `render-model.js` 的
`x = round(gap×scale) - ceil(f/2)` 改成 `x = round(gap×scale)` 并同步 core-convert 的候选。

### 4.5 与游戏机制的一致性说明

任务书明确「不要试图让不同高度下像素数相同，那与游戏机制相悖」——本实现**不做**这种归一化：
不同 `viewHeight` 下几何按比例缩放（§4.2 ⑤），同一高度下不同画幅几何完全相同（因为新系统按**高度**缩放）。
若后续游戏实测显示它其实按宽度或面积缩放，只需改 `render-model.js` 的 `displayScale()` 一处，并在本文件记录实测结论。

---

## 5. 控制台命令一次性粘贴（任务四）

### 5.1 输出形式

**一行、分号分隔、粘进控制台回车即生效。**

### 5.2 只输出当前状态下真正生效的命令（条件输出）

| 条件 | 规则 |
|---|---|
| 描边关闭（`outlineMode === 0`） | 不输出 `cl_crosshairoutline_*` |
| 样式既不是 2 也不是 5 | 不输出 `cl_crosshair_dynamic_splitdist / splitalpha_innermod / splitalpha_outermod / maxdist_splitratio`（`Codec.isSplitStyle()` 判定，style 2 与 5 同构） |
| 静态样式 | 不输出 `cl_crosshair_recoil` 与 `cl_crosshair_dynamic_spread_limit` |
| 附属项（投掷物准星 6 条） | **只进 .cfg**，不进粘贴行 —— 这是"一次性粘贴"能成立的关键 |

### 5.3 量程裁剪

所有值在输出前先经 `CS.normalizeModel()` 按布局表的 min/max 裁剪，保证不会因越界被游戏静默忽略。
`test/check-paste.js` 第 ⑧ 节用一张「命令 → 量程」表逐条断言，并用极端值（gap −3840 / thickness 32 / screenHeight 65535）验证。

### 5.4 长度与分段

| 配置 | 段数 | 最长段 |
|---|---|---|
| 默认配置 | **1** | 330 字符 |
| style 4 + 描边全开 | **1** | 427 |
| 全库 1701 条选手准星 | **1701 条全部 1 段** | 486（bodyy） |
| style 2 + 描边 + 自定义分裂（极端） | 2 | 511 |

> **2026-10-22 更正**：原先「21 条需 2 段，全部是样式 5」的前提已不成立。
> 反汇编 `0xDA6B60` 证明 style 5 是**单套四臂、不分裂**（设置页里它也不显示 Dynamic Spread Dist），
> 因此不再为 style 5 输出 `cl_crosshair_dynamic_*`，那 21 条自然回到 1 段。
> `node test/check-paste.js` 当前报「需要分 2 段及以上粘贴的 **0 条**」。

- 上限仍取 **512 字符**（Source `COMMAND_MAX_LENGTH`），**保守**优先：超过 512 时按命令边界切段并在 UI 说明原因（「命令较长，已切成 N 段，请按顺序粘贴」）。
- 为什么不直接放宽到 600：cs2util 的 ~550-600 字符单行在社区可用，但那是**经验值**，没有官方文档或可复现实测支撑；把用户的准星赌在一个未验证的上限上，风险高于"多点一次复制"。**依据不足，故不上调**（任务书要求给出依据才可突破）。
- 去掉投掷物命令后，需要分段的场景从「全库 1856/2681 条」降到只剩「style 2 + 开启描边 + 自定义分裂参数」一类；2026-10-22 style 5 定为单套臂后，选手库里**已无任何需要分段的配置**。

### 5.5 .cfg

`CS.settingsToCfg(model)` 输出**完整**命令集，一行一条、值加引号；`settingsToCfgFile()` 加注释头。
UI 提供「下载 .cfg」按钮（`showkey-crosshair.cfg`）。

> 2026-10-17：投掷物准星命令已随功能精简一并移除，.cfg 现在与粘贴行同一命令集
> （另含镜内线宽 `cl_crosshair_sniper_width` 这一附加项）。

---

## 6. 数据更新：离线 CLI（2026-10-16 已完成适配并全量更新）

```powershell
node tools/auto-update.js              # 全量更新（默认，最新）
node tools/auto-update.js --cache      # 快速模式：6 小时内缓存复用
node tools/auto-update.js --offline    # 只用本地缓存重建（不联网）
```

### 站点现状（2026-10-16 实测）

prosettings.net **已完成新准星系统迁移**：选手页准星表直接给新 convar 名
（`cl_crosshair_length` / `_thickness` / `_gap` / `_screen_height` / `cl_crosshairoutline_*` /
`cl_ironsight_*`）+ 文本样式名（`Static Cross` / `Classic Static` / `Dynamic Cross (Legacy/Shot Feedback)` …），
**不再提供分享码**。历史 API 每条带 `legacy` 标记，CSGO- 旧码与 CS 新码混合
（m0NESY：20 条中 13 旧 + 7 新，分界与 9.22 改版时间线吻合）。

### 实现

- 页面解析抽到 `tools/prosettings-parse.js`（`auto-update.js` 与 `test/check-freshness.js` 共用同一份，避免两处漂移）：
  新字段 → CrosshairV2 模型 → cs2-v1 码（精确，无换算）；旧格式页面（站点过渡期残留）走 legacy 编码 + 按选手分辨率有损转换；
- `players.js` **并写不改**：`c2`（新码）+ `m{fmt, from, h, lossy}`，`c` 仅旧格式页面存在；
  历史条目 `{c, d, s, n, lg}`，`lg` 来自 API 的 legacy 标记（前端按源数据时代判新旧）；
- 样式文本映射覆盖 10 个样式 + 站点别名（`Classic Static`→4、`Dynamic Cross (Legacy/Shot Feedback)`→5）；
  匹配不到的记入更新报告、按默认 4 处理，**不猜**；
- 三处闸门（退出码 3）已全部移除；`tools/sync-prosettings.js`（被 auto-update 取代的旧抓取器）已删除；
- 写前备份现有 players.js 到 `tools/cache/players-backup-<日期>.js`；
- 正确性由 `test/check-scraper.js` 把关（真实页面 fixture）：**「页面字段→模型→编码」与
  prosettings 自己发布的分享码逐字符一致**。

### 全量更新结果（2026-10-16）

58 队 331 人（含历史 323 人）：**新格式页面 265 人 · 旧格式页面 66 人**（有损转换分支）。
索引 1099 名选手 / 218 支战队；自动纳入 5 支新战队，新增 42 人、离队 19 人。

### Major 范围过滤（2026-10-17，产品决策）

准星库**只收录近两年（2025–2026）打过 CS Major 的队伍**。三届 Major 均为 32 队 VRS 直邀：

| Major | 时间 | 与本站的对应 |
|---|---|---|
| BLAST.tv Austin Major | 2025-06 | Falcons / FaZe / 3DMAX / Virtus.pro / paiN / FURIA / MIBR / M80 / Vitality / Spirit / MOUZ / NAVI / Aurora / G2 / The MongolZ / Liquid / OG / HEROIC / Metizport / Nemiga / BetBoom / B8 / Complexity / Wildcard / NRG / Imperial / Fluxo / BESTIA / Lynn Vision(LVG) / TYLOO / Chinggis Warriors / FlyQuest / Legacy |
| StarLadder Budapest Major | 2025-11/12 | 上述 + Astralis / PARIVISION / GamerLegion / NiP / Fnatic / The Huns / Rare Atom / RED Canids / Passion UA |
| IEM Cologne Major | 2026-06 | 上述 + FUT / Monte / 9z / BIG / SINNERS / Sharks / Gaimin Gladiators / THUNDER dOWNUNDER |

实现（`tools/auto-update.js`）：

- `MAJOR_TEAMS`（37 个本地 key）+ `MAJOR_SITE_EXTRA`（尚未跟踪但打过 Major 的队）；
  运行前过滤 `cfg.teams`，自动纳入（autoAdd）同样只认 Major 队——新 Major 队需手动补 key；
- `rosterGuard` 的基线改为「旧数据里同属 Major 队的人数」，避免把**有意缩减**
  （331 → 208）误判为抓取异常而拒绝写入；
- `tools/teams.json` 同步收敛为 37 支 Major 队。

**全量更新结果（2026-10-17）：37 队 208 人**（含历史 205 人）：
新版准星 168 人（功能完整）/ 旧版 40 人（双轨：可应用、可转换复制）。
未入选的 21 支队伍（100 Thieves、BC.Game、Eternal Fire、CYBERSHOKE 等）整队移出；
s1mple、device、rain、Magisk 等选手因其当前战队不在 Major 范围而离库。

### 全量更新结果（2026-10-18，任务 E 验收）

- 抓取 **172/172 成功 · 0 失败**，用时 159 秒；索引页 55 页（站点返回 1099 人 / 218 队），实际跟踪 31 队。
- `PRO_META` = `{updated:"2026-10-18T06:59:26.529Z", players:172, teams:31, withHistory:168, codeFormat:"cs2-v1", newFormat:142, legacyFormat:30}`。
- **172/172 人都有 `c2`**（新格式码），30 人额外保留 `c`（旧格式页面来源）；全库 1731 条码中 cs2-v1 488 条 / legacy 1243 条。
- 准星变动 21 人，明细见 `tools/update-report.md`。
- `node test/check-freshness.js` 抽查 24 名：**一致 24 / 不一致 0**（更新前是 20/4 —— 那 4 个差异是选手自己改了准星，不是解析 bug）。
- 连带：全库粘贴分段从 1698 条 / 20 条 2 段 变为 **1701 条 / 21 条 2 段**（当时判定全部是样式 5）；2026-10-22 反汇编证明 style 5 不分裂后，这 21 条回到 1 段，现为 **1701 条全部一次粘贴**。

---

## 7. 已知未验证项 / 待实测

| # | 项 | 状态 | 怎么验 |
|---|---|---|---|
| 1 | **客户端版本**：实机是 **1.41.9.1（2026-10-14）**，比任务书基准 1.41.8.8 新 | ⚠️ 码级已验证：归档码 `CSrUznuTXR4JnE4t2RnUUVmzJfUftLocNkkDq5mbO6dkzf`（46 字符）解码后与 2026-10-15 实机 vcfg 快照 **15/15 字段一致**，`encodeShareCode(decode(c)) === c` 逐字符还原；**游戏内导入/导出 round-trip 仍未做** | 游戏内导出分享码 → 粘进生成器 → 再导回游戏比对（步骤见 `tools/lab-report.md` 第 4 节） |
| 2 | 分享码容器是否仍为 cs2-v1（CS + 44 字符） | ✅ **容器未变**：归档码与 prosettings 10-15 检出的 46 字符码全部 `detectContainer → "cs2"`、`format → "cs2-v1"`、`migration → null`；缺游戏内确认 | 同上 |
| 3 | `cl_crosshair_sniper_width` 是否仍影响渲染 | 未验证（已进 .cfg 与导入解析，不进粘贴行/分享码） | 游戏内开镜目视 / 控制台改值观察 |
| 4 | 样式 1/3/7/8/9（圆 / 方 / 四分）的真实几何 | **近似**（按名称与 length/gap 推导） | 截图像素比对（E4）；另可用 prosettings 选手页 SVG（40×40 逐像素 rect）做第二证据源 |
| 5 | ~~旧 gap 换算候选 A/B~~ | ✅ **已离线裁决（2026-10-16）**：候选 B（中心起算，gap = x + ceil(f/2)）。依据：258 个新格式页面样本 255 命中 + 82 个旧格式页面 82 命中（见 `tools/lab-report.md` §6）。**游戏内截图终验待做（E4）** | E4 |
| 6 | 非 1080 高度的旧单位取整推广 | 未验证 | E5 |
| 7 | `cl_crosshair_screen_height` 的默认值与写入时机 | 已实测"存在且等于当前分辨率高度"（960 ↔ 1280×960）；默认值未验证 | — |
| 8 | 游戏导入 cs2-v1 时的规范化规则（哪些值会被改写） | 未验证 | E2 round-trip |
| 9 | 控制台 `find` 是否可用（R8） | 未获取（不向运行中的游戏注入按键） | 手动执行一次 |
| 10 | 奇数臂厚时左右差 1px 的不对称几何 | 与 prosettings 渲染一致（255/258 含此细节），**未与游戏内截图对拍** | E4 |

---

## 8. 验收清单对照

| 任务书验收项 | 结果 |
|---|---|
| 1. `node test/` 全部通过（含分辨率不变性 + convar 合规断言） | ✅ `node test/run-all.js` 全部套件通过 |
| 2. 同一设置在 1080p/1440p/4:3 stretched/不同 DPR 下预览几何逐像素一致 | ✅ `check-render-invariance.js` ①–⑥（几何完全一致；栅格在整数倍下逐格对应，小数 DPR 偏差 ≤0.33 游戏像素） |
| 3. 控制台命令单行分号、无旧 convar、长度合规、值在量程内 | ✅ `check-paste.js` ②③⑧ |
| 4. 准星库双轨（旧码可应用/可转换复制+差异确认/原码存档；新码完整功能） | ✅ `check-page.js` ⑧⑨ |
| 5. 库页面按 prosettings 维度组织，搜索/筛选/详情/历史可用 | ✅ `check-page.js` ⑨⑩ |
| 6. 页面无控制台报错 | ✅ `check-page.js` ⑭ |
| 7. 数据更新走离线 CLI 且 README 有说明 | ✅ 见第 6 节与 README 第三节 |

---

## 9. 2026-10-17 变更记录：功能精简 + Major 范围

用户指令：① 删除投掷物准星功能；② 分辨率/比例已不影响准星显示，缩放模拟一律取消；
③ 准星库只留近两年打过 Major 的队伍；④ 继续优化 UI。

### 9.1 删除投掷物准星（模型 / 输出 / UI 三处清零）

| 位置 | 改动 |
|---|---|
| `js/core-codec.js` | `defaultModel()` 移除 6 个 `grenade*` 开关与 5 个 `grenadeDelay*`（秒）字段 |
| `js/core-convars.js` | 移除 `GRENADE_FIELDS` / `GRENADE_DELAY_FIELDS`；`toCmdRows`（.cfg）不再输出 11 条投掷物命令；`EXTRA_NUMERIC` 只保留 `cl_crosshair_sniper_width`；解析分支同步移除 |
| `index.html` / `js/app.js` / `css/style.css` | 移除「投掷物准星」分组（6 开关 + 5 延迟输入）、`TOGGLES`/`NUMBERS` 绑定、`.num-row`/`.num-note` 样式 |
| 测试 | `check-paste.js` ⑧ 断言反转为「粘贴行与 .cfg 均不含 `cl_grenadecrosshair`」 |

保留：镜内准星线宽 `cl_crosshair_sniper_width`（渲染效果仍未实测，只进 .cfg 与导入解析）。

### 9.2 取消缩放模拟（分辨率/比例无关的结构性保证不变）

| 位置 | 改动 |
|---|---|
| `index.html` | 移除预览工具条（宽高比 4:3/16:10/16:9/5:4/21:9 + 放大 1×/2×/4×）与「分辨率与缩放」组（制作高度输入 + 预览高度下拉） |
| `js/app.js` | 移除 `ASPECTS` / `VIEW_HEIGHT_BASE` / `state.ar|zoom|userHeight|viewHeight` / `applyAspect()` / `syncViewHeightOptions()` / `updateViewHeightNote()`；`paint()` 的 `viewHeight` 缺省改为模型自身的 `screenHeight`（缩放恒为 ×1） |
| `css/style.css` | 预览舞台固定 16:9（`--ar` 与 `.zoomed` 规则删除），清理 `.seg-mini` / `.preview-tools` / `.num-*` 死规则 |
| 语义 | `cl_crosshair_screen_height` **仍是模型字段**（首次加载 = 用户实际屏幕高度，分享码/命令/PNG 始终携带）；~~「制作基准」组只保留一行说明~~ → 该组已于 2026-10-23 整体删除，见 10.6 |

> **2026-10-17 晚增量**：这里删除的是「会改变预览几何 / 模拟分辨率」的缩放与宽高比控件。当晚另上线的 1×/1:1/2×/4× 是纯展示检视倍率，`previewUnit` 只进 canvas 的展示 unit，不改变模型几何与导出结果。

### 9.5 预览收敛为 1:1 原生像素（2026-10-18）

用户指令：「仅保留 1:1 的显示，或者参考 prosettings 的显示渲染方式」。两方案合并执行：**保留本站 16:9 大画幅，但删除全部检视倍率**。

**prosettings 实测依据**（2026-10-18 live 抓取，非缓存）：
- 选手页 `/players/donk/`：`<svg class="cs2-crosshair-svg" width="50" height="50" viewBox="0 0 50 50">` 内 4 个 `<rect width="2" height="2">`，一格像素一个 rect；`.crosshair-slider__placement{height:50px;width:50px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}`，`.cs2-crosshair-svg{image-rendering:pixelated;image-rendering:crisp-edges}`。**固定 50×50 像素格，与窗口大小无关**；背景是 glide 轮播的 1120×350 地图条（容器 `max-height:160px`、`object-fit:cover`），纯装饰。
- 生成器页 `/tools/cs2-crosshair-generator/`：`#crosshairPreview` canvas，`const n=window.devicePixelRatio||1; e.width=i*n; e.height=s*n; t.scale(n,n)` + `ResizeObserver` 观察父容器；画幅 `.crosshair-preview{height:160px}`；背景 `.background-container{background-size:cover}`。**没有任何倍率控件**。

| 位置 | 改动 |
|---|---|
| `index.html` | 删除 `<div class="segmented lens-seg" id="lensSeg">` 四个按钮；`#stageMeta` 初值（当时）`1:1 原生像素 · 制作基准 1080p · 背景为示意截图`，2026-10-23 起改为「当前样式 · 中文名」；`.stage-live` 改为 `<i></i>1:1 预览<span id="stageScale">1 像素 = 1 px</span>`；`#railHint` 改为 `1:1 原生像素 · ←/→ 切图 · 按住画面模拟连发`。**2026-10-23 最后一版又删掉 `#stageBadge` / `#stageScale` / `#railHint` 三个冗余提示**，舞台角落只留「1:1 预览」 |
| `js/app.js` | 删除 `state.lens`；`renderMainPreview()` 的 `var zoom = CS.previewUnit(h, s.screenHeight, stageLens())` → `paint(cv, s, w, h, 1, dyn.firing, {...})`（zoom 恒 1）；删除 `stageLens()` / `syncStageLens()`；`syncStageMeta()` 只写 `#stageMeta`（`"1:1 原生像素 · 制作基准 " + h + "p · 背景为示意截图"`）与 `#stageScale`（`h + "p 基准"`）；3 处调用点改为 `syncStageMeta()`；删除 `#lensSeg` 点击监听 |
| `js/render-model.js` | 删除 `previewUnit(stageHeight, screenHeight, lens)` 及其导出（原 `js/render-model.js:97-103`、`:354`）；文件头注明「本模块只负责几何（模型像素），不提供任何展示倍率」 |
| `js/codec.js` | 门面同步删除 `previewUnit: RM.previewUnit,` |
| `css/style.css` | `.preview-stage` 注释改为「画幅只是取景框…背景截图用 object-fit: cover 铺满，仅作衬底」；`.preview-stage img` 删除 `transform-origin` / `will-change`；删除 `.preview-stage.is-zoomed img`；`.lens-seg` 系列整块替换为 `.stage-badge`（inline-flex + `::before` 圆点 + `cursor:help` + `color: var(--accent)`）；窄屏媒体查询改 `.stage-badge{padding:4px 9px;font-size:10.5px}` |
| `test/check-page.js` | ④ 断言改 `/1:1 原生像素/`；「检视倍率」断言组整组替换为 5 条：无 `#lensSeg`、`!("previewUnit" in CS)`、`#stageBadge` 含 `/1:1/`、舞台无 `is-zoomed`、`#bgImg` 无 `style.transform` |

**不变性保持**：`CS.crosshairRects(model, {recoil, viewHeight})` 的参数表里仍没有画布宽高/DPR，几何与展示彻底解耦；`test/check-render-invariance.js` 6 组断言继续全绿。PNG 导出仍走 `CS.exportPreviewPng`，尺寸只由「几何 × 倍率」决定。

**附带修复（同一轮发现）**：`js/core-codec.js:39` 的 style 5 缺 `split: true`，导致 `isSplitStyle()` 返回 false、`js/core-convars.js` 的 `if (Codec.isSplitStyle(m))` 分支不给 style 5 输出 4 条 `cl_crosshair_dynamic_*` 命令，实机无法复现 style 5 的分裂行为。已补 `split: true` 并加注释引用 `tools/lab-report.md` 9.2 表（静息 60×60 → 开火 80×80）。代价：20 条 style 5 准星（1.2%）粘贴超 512 需切 2 段，`test/check-paste.js` 断言相应放宽为「≤2 段且每段 ≤512」。

> **2026-10-22 推翻**：这一处「修复」的前提是错的。反汇编 `client.dll` 的 `0xDA6B60` 后确认 style 5 是**单套四臂、不分裂**的静态十字；
> 早期「style 5 与 style 2 同构、开火外推 splitDistance」的判断来自低分辨率连发截图（`lab-report` 9.2 表），已被 1:1 预览与二进制双重否定。
> 现在 `STYLES[5]` 为 `dynamic: false, quad: false`（不再 split），style 5 不再输出任何 `cl_crosshair_dynamic_*`，
> 分段代价随之消失（全库 1701 条全部一次粘贴），`test/check-paste.js` 断言恢复为「1 段且 ≤512」。

### 9.3 准星库 Major 范围（见第 6 节）

37 队 208 人；`tools/auto-update.js` 的 `MAJOR_TEAMS` 白名单 + `rosterGuard` 基线修正；
`tools/teams.json` 收敛为 37 队。

### 9.4 UI 收尾

- 库页 `prosNote` 改写为收录范围说明（三届 Major + 数据版本 + 新旧人数）；
- 搜索框占位示例改为在库选手（donk / ZywOo / m0NESY）；
- `<meta name="description">` 同步（移除「按分辨率等比缩放」表述）；
- 无头 Edge 截图 8 张复核（`test/shots/`）：生成器（默认/动态四分/半描边）、库列表、
  详情页（新旧混合历史）、旧码导入提示、粘贴面板——渲染与交互正常。


---

## 10. 2026-10-18 变更记录：UI 重构（六项）

用户指令（原文）：

> 选手当前最新的准星也放到下方历史版本中　这一次把控制台命令 分成每一句都换行 提升美观度
> 首页的准星预览可以做小一点 在更改设置的时候也能看到实时预览 预览可以和游戏预览图一致
> 再次优化ui和布局 重写为更高效高级的ui

### 10.1 布局：预览从「顶部大横幅」改为「右侧常驻侧栏」

| 位置 | 改动 |
|---|---|
| `index.html` | `#view-generator` 内改为 `.gen-layout` > `.gen-main`（`.panel.settings-panel` + `.panel.share-panel`）+ `aside.gen-rail`（`.panel.preview-panel` 整块搬进来）；`#cfgOutput` 改 `rows="15" data-autosize="1"` |
| `css/style.css` | `.gen-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--rail-w);gap:var(--s5);align-items:start}`；`.gen-rail{position:sticky;top:74px}`；`--rail-w:392px`；≤1240px 收窄到 340px，≤1080px 变单列且 `.gen-rail{order:-1}`（预览回到最前） |
| 效果 | 宽屏下预览**永远在视野内**（实测 `scrollY=900` 时 `.gen-rail` 的 `top` 仍为 74，等于 sticky 偏移）；预览画幅从整屏宽降到 368×206（1600 视口），符合「做小一点」 |

### 10.2 控制台命令：显示逐句一行，复制仍是单行分号

| 位置 | 改动 |
|---|---|
| `js/app.js` | 新增 `pasteCommands()`：把 `CS.settingsToPasteChunks()` 的每段按 `;` 切分并 trim，摊平成一维数组；`renderPaste()` 改为 `$("cfgOutput").value = pasteCommands().join("\n")`，随后 `autoSize()` 按内容撑高（`min(460, scrollHeight+2)`） |
| `js/app.js` | `copyPaste()` **不变**：仍复制 `chunks[0]`（合并好的单行分号版）。控制台只吃单行 ≤512，这是唯一能真正粘贴的形式 |
| 文案 | `#pasteLen` = `单行 N / 512 字符[ · 共 N 段]`；`#pasteMeta` 单段 = `共 N 行（逐句一行显示）· 「复制命令」复制合并后的单行 L 字符 · 上限 512 · 粘贴后回车即生效` |
| 效果 | 默认配置显示 **14 行**（首行 `cl_crosshairstyle 4`），文本框自动撑到 `clientHeight === scrollHeight === 309`，一屏看全；点复制得到 329 字符单行分号串 |

### 10.3 选手详情：当前准星并入历史版本列表

| 位置 | 改动 |
|---|---|
| `js/app.js` `openModal(p)` | `hist = (p.h||[]).slice(0,11)`；在最前面手工拼一条 `.hist-entry.is-current[data-current="1"]`：日期取 `hist[0].d`（无则 `dataStamp()`）+ `<span class="h-now">当前</span>`，`.h-source` 写 `最新检测 · 正在使用`，动作用 `histActionsHTML(curCode, info, legacy)` |
| 安全性 | 实测 172/172 人都有 `c2` 新码，且 `h[0].c !== (p.c2||p.c)` 恒成立 → 不会与历史重复 |
| 效果 | m0NESY 类详情 `#mHistoryList` 共 **12 条**，首条 `class="hist-entry is-current"`、日期 `2026-10-15 当前`、三个动作（应用 / 复制 / 存图） |

### 10.4 预览与游戏一致：维持 1:1，逐像素复核

- 保持第 9.5 节的结论：**1 模型像素 = 1 CSS 像素**，无检视倍率，背景 `object-fit: cover` 只作衬底。
- **浏览器内实测**：页面画布 368×206、中心 184/103，默认模型 `{style4, len11, thk2, gap7}` 绘出的准星 bbox = `166..201 × 85..120` = **36×36**；同模型 `crosshairRects` 返回 `x:7 / x:-18 / y:-18 / y:7` 四臂，外沿正好 ±18 → 36×36，**完全一致**。
- **实机逐像素复核（1920×1080 中心窗口法）**：`matrix-style1/5/7` 与 `cs2-rest-1920x1080` 的 bbox 与引擎一致（18/60/60/16）；`matrix-style0` 实机 50×50 vs 引擎 60×60、`matrix-style2` 实机 70×70 vs 引擎 60×60 —— 逐行 run 结构确认是**真机行为**（style 2 在静息帧就已带 splitDistance 外推），不是扫描噪声。
- **本轮不改几何**：这两支偏差需要更多实机取证（游戏内导出码 + 多组 length/gap 采样）才能定标定函数，本轮只在文档标注，测试仍以引擎输出为准。

### 10.5 CSS 重写（15 个分节，53 KB）

完全重写 `css/style.css`，分节：1 设计令牌 / 2 基础 / 3 顶栏 / 4 布局骨架 / 5 按钮 / 6 面板 / 7 生成器预览栏 / 8 参数面板 / 9 分享面板 / 10 选手库 / 11 弹窗 / 12 悬浮件 / 13 滚动条 / 14 响应式 / 15 降低动效。

> 2026-10-24 现状：已增至 **18 个分节**（新增 9.5 读取本机准星、14.5 触控目标、16 高对比与强制色），见 7.4.5。
> 2026-10-27：9.5「读取本机准星」整节随功能下线删除，现为 **17 个分节**。

关键令牌变化：圆角收紧（`--r-sm 8 --r-md 11 --r-lg 14 --r-xl 18 --panel-radius 16 --stage-radius 10`）、`--dur .18s`、`--shell 1440px`（`--rail-w` 已废弃并在 2026-10-23 首页重排后从令牌表移除；右列宽度改由 `.gen-layout` 的 `1.62fr / 1fr` 栅格决定）；深色基底更深（`--bg #08080a --surface-1 #131316`），主色仍 `--accent #ff9f0a`；浅色 `--bg #f3f3f6 --accent #f08c00`。顶栏从 64px 压到 58px，面板头从 15px/20px 压到 10px/14px，整体信息密度提高。

分享面板改为两列（`.share-body`，≤860px 单列）；`.preview-actions` 改 2×2 栅格（≤1080px 4 列、≤760px 2 列）。

### 10.6 失效文案与死代码清理

| 位置 | 改动 |
|---|---|
| `js/app.js` `syncDynamicPanel()` | `#railHint` 去掉已不存在的「点 1× 看整屏」：动态 = `按住画面连发 · 1:1 原生像素 · ←/→ 切图`，静态 = `1:1 原生像素 · ←/→ 切图 · 空格播放动态预览` |
| `js/app.js` `syncStageMeta()` | 当时文案简化为 `1:1 原生像素 · 制作基准 {h}p`；**2026-10-23 重写**为只写 `#stageMeta` =「当前样式 · {CS.STYLE_NAMES[s.style]}」，「制作基准」字样彻底移除；最后一版又删掉 `#stageScale` / `#stageBadge` / `#railHint` 三个冗余提示 |
| `js/app.js` 文件头 | 删除过时注释「预览按『准星占屏幕高度的比例』等比缩放背景与准星；检视倍率只整体放大」 |
| `css/style.css` | 清掉 `.palette/.pal/.p0..p5`、`.upd-*`、`.nb-list/.nb-src/.nb-tag/.ps-item/.tg-*` 等已删功能的残留规则 |

### 10.7 测试同步

| 文件 | 改动 |
|---|---|
| `test/check-page.js` ② | 整节重写为逐句断言：`ls.length>1`、`ls.every(l=>l.indexOf(";")===-1)`、`ls.every(l=>/^[a-z0-9_]+ .+$/.test(l.trim()))`、`ls[0].trim().indexOf("cl_crosshairstyle ")===0`、`oneLine=ls.join("; ")` 且 `oneLine.length<=CS.PASTE_LIMIT`、无 NEVER_OUTPUT、含 `cl_crosshair_screen_height`；并新增「点 `#btnCopyPaste` 后剪贴板内容是单行」断言 |
| `test/check-page.js` ④ | `lines()[0].indexOf("cl_crosshair_screen_height 960")` → `lines().some(...)`（逐句后该命令不再在第一行） |
| `test/shots-run.js` | 全量重写，14 个场景：01-gen-dark / 02-gen-light / 03-gen-dynamic-quad / 04-gen-half-outline / 05-settings-scroll / 06-share-panel / 07-pros-list（选中战队展开详情卡）/ 07b-pros-default / 08-pros-detail / 09-legacy-notice / 10-mobile-430 / 11-mobile-modal-430 / 12-mobile-pros-430 / 13-pros-980 / 14-pros-1180 |

### 10.8 验收证据（全部实测）

- `node test/run-all.js` → **8 个套件全绿**。
- 真实浏览器探针：`errors=0`、`cfgLines=14`、`firstCfg='cl_crosshairstyle 4'`、`pasteLen='单行 329 / 512 字符'`、`overflowX=false`；`app.js` 引用的 **83 个 id 运行时全部存在（missing=[]）**。
- 实时预览：改 `#sGap` / `#sThickness` 后 `previewCanvas.toDataURL()` 变化。
- 响应式：1280 / 1000 / 760 / 430 四档实测，`overflowX` 恒为 false；1000px 时 `.gen-rail` 的 `order` 变 `-1`（预览置顶）。
- 主题：浅色 `body rgb(243,243,246)` / panel `rgb(255,255,255)`；深色 `rgb(8,8,10)`。
- 静态包：`node tools/build-dist.js` 重跑成功，`cs2-crosshair/` 78 个文件 2.48 MB，`index.html` 与 `css/style.css` 与根目录逐字节一致。
