# 实机比对报告 · CS2 准星参数 vs Showkey 生成器

- 日期：2026-10-15（只读比对，未修改任何游戏设置）
- 客户端：**1.41.9.1**（ClientVersion 2000932，VersionDate Oct 14 2026，appmanifest buildid 25947352）
- 账号：886924967 · 分辨率 **1280 × 960**（窗口化/无边框，setting.fullscreen=0）
- 真源：`cs2_user_convars_0_slot0.vcfg`（路线 C）
  - mtime `2026-10-15T15:31:58.837Z`，**晚于** cs2 进程启动 `2026-10-15T23:27:53.5838906+08:00`
  - → 该文件由**当前运行中的客户端**写入，不是上次退出的旧快照
- 采集脚本：`test/lab/read-vcfg.js`（只读）· 比对脚本：`test/lab/compare-vcfg.js`
- 原始快照：`test/lab/vcfg-snapshot-20261015.json` · 准星块 fixture：`test/fixtures/vcfg-crosshair-20261015.txt`

---

## 1. 实机参数全量快照（来源：vcfg，只读）

### 1.1 准星（新系统命令）

| convar | 实机值 |
|---|---|
| cl_crosshairstyle | 4（Static Cross） |
| cl_crosshair_length | 6 |
| cl_crosshair_thickness | 2 |
| cl_crosshair_gap | 6 |
| cl_crosshair_screen_height | 960 |
| cl_crosshair_drawoutline | 0（无描边） |
| cl_crosshaircolor_r / g / b / a | 0 / 255 / 0 / 255 |
| cl_crosshairoutline_r / g / b / a | 0 / 0 / 0 / 255 |
| cl_crosshairdot | false |
| cl_crosshair_t | false |
| cl_crosshair_recoil | false |
| cl_crosshair_dynamic_spread_limit | 227 |
| cl_crosshair_dynamic_splitdist | 6 |
| cl_crosshair_dynamic_splitalpha_innermod | 1 |
| cl_crosshair_dynamic_splitalpha_outermod | 0.5 |
| cl_crosshair_dynamic_maxdist_splitratio | 1 |
| cl_ironsight_dot_scale | 1 |
| cl_ironsight_usecrosshaircolor | false |
| cl_crosshair_sniper_width | 0 |

### 1.2 客户端仍在写、但属旧系统遗留的 convar（hidden）

| convar | 实机值 | 说明 |
|---|---|---|
| cl_crosshairsize | 2 | CS:GO 旧刻度，与 cl_crosshair_length 并存 |
| cl_crosshairthickness | 0.5 | CS:GO 旧刻度，与 cl_crosshair_thickness 并存 |
| cl_crosshairalpha | 255 | 与 cl_crosshaircolor_a 并存 |

> 这三个值**不支持任何迁移换算**：旧 thickness 0.5 按旧公式应得新 thickness 1，实际是 2；
> 旧 size 2 按旧公式应得新 length 5，实际是 6。它们是历史残留，不参与新准星渲染。

### 1.3 投掷物准星

| convar | 实机值 |
|---|---|
| cl_grenadecrosshair_keepusercrosshair | false |
| cl_grenadecrosshair_smoke / fire / explosive / flash / decoy | true / true / true / true / true |
| cl_grenadecrosshairdelay_smoke / fire / explosive / flash / decoy | 0.5 / 0.8 / 2 / 0.4 / 0.395425 |

### 1.4 总开关

| convar | 实机值 |
|---|---|
| crosshair | true |

---

## 2. 参数差异清单

| # | convar | 实机值 | 生成器值/期望 | 差异类型 | 严重度 | 证据 |
|---|---|---|---|---|---|---|
| D1 | cl_crosshair_length | 6 | 11（默认基线） | 数值偏差（默认值不同） | 低 | 1.1 |
| D2 | cl_crosshair_gap | 6 | 7（默认基线） | 数值偏差（默认值不同） | 低 | 1.1 |
| D3 | cl_crosshair_screen_height | 960 | 1080（默认基线） | 数值偏差（默认值不同） | 低 | 1.1 |
| D4 | cl_crosshair_sniper_width | 0 | 生成器无此命令 | **缺失（未覆盖）** | 中 | 1.1 |
| D5 | crosshair（准星总开关） | true | 生成器无此命令 | **缺失（未覆盖）** | 低 | 1.4 |
| D6 | cl_grenadecrosshairdelay_* | 有 5 项 | 生成器不输出 | 缺失（未覆盖） | 低 | 1.3 |
| D7 | cl_crosshairsize / cl_crosshairthickness / cl_crosshairalpha | 2 / 0.5 / 255 | 生成器不输出（策略正确） | 已隐藏残留 | 低 | 1.2 |
| D8 | cl_crosshair_dynamic_* / cl_crosshairoutline_* | 有值 | 当前状态不输出 | 条件性省略，**非差异** | — | 1.1 |
| D9 | cl_crosshairstyle | 4 | 4（Static Cross） | 一致（编号体系相同） | — | 1.1 |
| D10 | 其余 12 项（颜色/厚度/描边/点/T/后坐力/镜内点） | — | — | 一致 | — | 1.1 |

**生成器输出、实机 vcfg 里没有的**：无（vcfg 是稀疏存档，缺项只说明取默认值，不能反证不存在）。

**往返一致性**：把实机 convar 灌进生成器解析器再导出，**15/15 项 1:1 还原**（比对脚本 ③）。

---

## 3. 不一致项定位

- **D1–D3 不是缺陷**：生成器的默认模型（length 11 / gap 7 / screenHeight 1080）是出厂默认，
  与用户实机配置（6 / 6 / 960）本来就不同。判定基准应是「导入实机值后能否还原」——已验证 15/15 一致。
- **D4 `cl_crosshair_sniper_width`**：客户端仍在写（值 0）。它是 CS:GO 时代控制 AWP 镜内线宽的
  convar；新系统已用 `cl_ironsight_dot_scale` / `cl_ironsight_usecrosshaircolor` 表达镜内准星。
  是否仍生效**未验证**，生成器暂不输出是有意为之（重构计划 §2.3 未收录该 convar）。
- **D5 `crosshair`**：准星功能总开关（对应游戏设置里的「启用准星」）。
  生成器不做这个开关；若玩家把它设为 0，任何准星都不可见。属可选补充项。
- **D6 手雷准星延迟**：客户端有 5 个 `cl_grenadecrosshairdelay_*`，
  生成器的「投掷物准星」分组只覆盖开关，不含延迟。
- **D7 旧隐藏 convar**：生成器**正确地不输出**它们（有测试断言）。但措辞要改：
  它们不是「已删除」，而是「客户端仍保留、已 hidden、不参与渲染」。已拆分为两份常量：
  `CS.REMOVED_CONVARS`（已移除）与 `CS.HIDDEN_LEGACY_CONVARS`（仍存在但隐藏）。
- **发现并已修复的真实缺陷**：客户端把新旧命令**同时**写进用户配置，
  而解析器原来只要看到任意一个旧命令名就把**整段**当旧系统文本处理，会导致
  (a) 新编号样式被按旧编号重映射（例如 style 7 被改成 2）；
  (b) `cl_crosshair_drawoutline 2`（半描边）被旧描边推导覆盖成 1（全描边）。
  修复：只有「出现旧名、且一个旧名之外的新名都没有」才走旧系统换算路径，否则旧名按存档残留忽略。
  回归测试已固化：`test/check-paste.js` 第 ⑦ 节（实机快照 fixture）。

---

## 4. 结论

**生成器不需要结构性修改，核心假设全部被实机证实；只剩 2 项收尾 + 1 项必须由你在游戏里确认。**

### 已被实机证实（无需改动）

| 假设 | 实机证据 |
|---|---|
| 新准星系统已上线，命令名与生成器一致 | vcfg 里 19 条新命令全部存在且带值 |
| `cl_crosshair_screen_height` **真实存在**（计划 R6 待测项） | 实机值 960 = 当前分辨率高度 1280×960 |
| 该 convar 等于「制作时的屏幕高度」，分辨率变则变（E5） | 960 与 cs2_video.txt 的 defaultresheight 完全相同 |
| `cl_crosshair_dynamic_spread_limit` / `cl_crosshairoutline_rgba` / `cl_ironsight_*` 真实存在 | 均在 vcfg 中 |
| 样式编号已统一为新 0–9 | 实机 style 4，与生成器 STYLES 表语义一致 |
| `cl_crosshairsize / thickness / alpha` 仍在客户端但已 hidden | 三者仍在 vcfg 中，值为旧刻度残留 |
| 生成器解析 → 导出可以 1:1 还原实机配置 | 15/15 一致 |

### 需要做的收尾

| 优先级 | 动作 | 对应差异 |
|---|---|---|
| P0（已完成） | 修复「新旧混合文本」解析：不再整段按旧系统换算，旧残留忽略并在提示里说明 | §3 缺陷 |
| P1（已完成） | 措辞与常量拆分：REMOVED / HIDDEN_LEGACY，UI 与文档不再统称「已删除」 | D7 |
| P2（建议） | 判断 `cl_crosshair_sniper_width` 是否仍生效；若生效就在「镜内准星点」分组补一个输入 | D4 |
| P3（可选） | 补 `crosshair` 总开关与 `cl_grenadecrosshairdelay_*` | D5 / D6 |

### 必须由你在游戏内确认的一项（离线无法判定）

生成器目前假设分享码容器仍是 **cs2-v1（CS + 44 字符）**。
该假设来自 npm `csgo-sharecode@7.0.1`（发布晚于 2026-09-30 补丁），
但**本机客户端已是 1.41.9.1（2026-10-14），比重构计划当时的基准 1.41.8.8 更新**。
若 10-14 的补丁又动了分享码布局，生成器产出的码会被游戏拒绝。请做一次 30 秒验证：

1. 游戏内 设置 → Crosshair/Scopes → 分享/导出，复制当前分享码（CS 开头、44 字符）；
2. 粘进生成器的「分享码」输入框，看是否解析成功、参数是否与上面 1.1 表一致；
3. 再把生成器为实机配置算出的这枚码导回游戏，看参数是否一致：

```
CSrUznuTXR4JnE4t2RnUUVmzJfUftLocNkkDq5mbO6dkzf
```

（由「实机 convar → 生成器模型 → cs2-v1」生成，对应 style 4 / length 6 / thickness 2 / gap 6 / screenHeight 960）

---

## 5. 未获取 / 待确认项

| 项 | 状态 | 原因 |
|---|---|---|
| 路线 A：控制台 `find cl_crosshair*` 输出 | **未获取** | 需要向正在运行的游戏窗口注入按键。任务硬性约束是「不得修改游戏内任何设置、结束后设置必须一致」，而按键一旦没落进控制台就会变成游戏内操作，风险不可控 —— 按「未获取优于猜测」处理，未尝试 |
| 路线 A：裸 convar 名回显（R8） | **未获取** | 同上 |
| 路线 B：游戏内导出的分享码 | **未获取** | 需要在游戏设置页人工操作；已给出 30 秒验证步骤 |
| convar 的**量程与步进**、help 文本 | **未获取** | `machine_convars_default.vcfg` 只有 12 行且是 2024-09 的空壳；客户端二进制（cs2.exe / engine2.dll / panorama.dll）与 `pak01_*.vpk` 里检索不到 convar 明文字符串（已实测，均为压缩/打包存储） |
| 哪些 convar **真的已被移除** | **部分未获取** | vcfg 是稀疏存档（只存非默认值），**存在可证、不存在不可证**。已移除清单只能作为策略而非实测结论 |
| 实际渲染几何（f/b/x）与分辨率缩放 | **未获取** | 需要游戏内截图做像素比对（计划 E4/E5）；本次只做参数级比对 |
| 控制台是否支持 `find`（R8） | **未获取** | 同路线 A |
| `cl_crosshair_sniper_width` 是否仍影响渲染 | **未获取** | 参数存在，但效果要进游戏开镜目视确认 |

---

## 6. 离线实验：gap 锚点裁决（R3，2026-10-16，无需游戏）

**问题**：新系统 `gap` 的锚点是「中心块边缘起算」（候选 A）还是「屏幕中心起算」（候选 B）？
akiver 文档与 Valve 补丁文本都没写。之前只能靠游戏截图（E4）裁决。

**方法**：游戏当时未运行，但抓取器缓存里有全量页面。把每个页面的官方矩形（`cs2-crosshair-svg`）
按旧公式解读出 (f, b, x)，与该页新字段算出的模型 gap 比对：

| 页面类型 | 样本 | `x = gap - ceil(f/2)`（中心起算） | `x = gap`（边沿起算） | 其他 |
|---|---|---|---|---|
| 新格式页面（新 convar 名） | 258 | **255** | 0 | 3（站点渲染离群） |
| 旧格式页面（旧 convar 名） | 82 | 0 | **82**（旧公式原式） | 0 |

**结论**：
1. 新系统 `gap` 是**中心起算**——候选 B 成立（`core-convert.js` 已默认 `gapOrigin: "center"`）；
2. 站点旧格式页面的渲染器没变（旧公式原式 82/82）——legacy 迁移保真基准仍然有效；
3. 附带发现：**臂粗为奇数时，游戏几何左右差 1px**（等价于臂贴在中心块 `[off, off+f)` 左右沿上），
   258 样本里 f=1 的 81 个、f=3 的 11 个都符合——这个细节任何文档都没写；
4. 渲染实现：`render-model.js` 内部 `x = round(gap×scale) - ceil(f/2)`（模型 gap 保持游戏语义），
   legacy 迁移 `gap = x_old + ceil(f/2)`，迁移后 `x` 回到 `x_old`——`verify.js` ② 的 39516 个
   逐像素对拍用例（含负 gap 跨中心）全过，即旧观感逐像素保留；
5. 3 个离群（jackinho gap-2/f2、jt gap0/f4 等）判定为站点侧渲染问题，已在 verify.js ③b 按
   ≥90% 比例断言容忍。

**残留**：以上是与 prosettings 渲染的一致性，**游戏内截图终验仍待做（E4）**。若截图显示游戏
是严格 ±gap 对称，改 `render-model.js` 一行 + `core-convert.js` 的候选即可。

---

## 7. 全量数据更新（2026-10-16，任务 E 落地）

- 站点已完成新准星系统迁移：选手页给新 convar 名 + 文本样式名，**不再提供分享码**；
  历史 API 带 `legacy` 标记，新旧码混合（m0NESY 20 条 = 13 旧 + 7 新）；
- 抓取器改造：页面解析抽到 `tools/prosettings-parse.js`（与 check-freshness 共用），
  新字段 → 模型 → cs2-v1 码；`players.js` 并写 `c2`/`m`/`h.lg`；三处闸门移除；
  `sync-prosettings.js` 删除；
- 全量更新结果：**58 队 331 人**（新格式页面 265 · 旧格式页面 66），含历史 323 人；
  自动纳入 5 支新战队，新增 42 人、离队 19 人；
- 最强正确性证据：`test/check-scraper.js` 用真实页面样本断言
  **「页面字段 → 模型 → 编码」与 prosettings 自己发布的分享码逐字符一致**（m0NESY）；
- 样式文本映射覆盖 10 样式 + 站点别名；`Dynamic Cross (Legacy/Shot Feedback)`→style 5
  （社区两处来源一致的编号）；1 个页面样式文本为 "Unknown"（站点自己不知道），
  按默认 4 处理并记入更新报告；
- 测试：`node test/run-all.js` **8/8 套件全绿**。

---

## 8. 2026-10-17：功能精简 + Major 范围（无需游戏进程）

本轮为纯工程变更（游戏当时未运行），全部可离线验证：

1. **投掷物准星移除**：模型 11 个字段（6 开关 + 5 延迟）删除；`.cfg` 与粘贴行均不再输出
   `cl_grenadecrosshair*`（check-paste.js ⑧ 反向断言：粘贴行 / .cfg / .cfg 文件版三处都不得出现）。
   保留 `cl_crosshair_sniper_width`（仅 .cfg + 导入解析）。
2. **缩放模拟取消**：预览宽高比/放大倍率工具条、「分辨率与缩放」组（制作高度输入 + 预览高度下拉）
   全部移除；`paint()` 的 viewHeight 缺省改为模型自身 screenHeight（缩放恒 ×1）。
   `cl_crosshair_screen_height` 仍是模型字段（首载 = 用户屏幕高度），分享码/命令/PNG 始终携带。
   分辨率/比例无关性由 `check-render-invariance.js` 结构性保证（环境参数无处进入几何计算）。
3. **Major 范围**：三届 Major 参赛队（Austin 2025 / Budapest 2025 / Cologne 2026，各 32 队）
   并集为 49 支唯一队伍，与本站 teams.json 对应后保留 **37 队**；`players.js` 重建为
   **37 队 208 人**（新版准星 168 人完整功能 / 旧版 40 人仅存图；历史 1856 条，旧 1476 / 新 380）。
   `rosterGuard` 基线改为「旧数据里同属 Major 队的人数」，避免有意缩减被误判为抓取异常。
4. **测试**：`node test/run-all.js` **8/8 套件全绿**（含 2064 条码的粘贴合规、1476 条 legacy
   迁移保真、39516 个逐像素对拍用例、jsdom 整页回归）。
5. **视觉复核**：无头 Edge CDP 截图 8 张（`test/shots/`）：生成器默认/动态四分/半描边、
   库列表、详情页（新旧混合历史逐条判定）、旧码导入提示、单行粘贴面板——均正常。

---

## 9. 2026-10-17：1:1 实机动态准星对照实验（游戏进程）

### 9.1 环境与方法

- 本机 CS2（Steam userdata 886924967），本地 `de_dust2`，窗口 1920×1080，`cl_crosshair_screen_height 1080`。
- 测试配置通过 `game/csgo/cfg/showkey_test.cfg` + F5 重载；F7 `+attack` / F8 `-attack` 按住连发。
- 截图用 **GDI 原生位图**（Python ctypes `BitBlt`，DPI-aware，窗口区域 450,184,1920,1080），
  避免 Steam 截图缩放；原始帧在 `shots/matrix-style{0,1,2,5,7}-{rest,fire}.bmp`。
- 测试参数统一：length 20 / thickness 4 / gap 10 / splitdist 10 / splitratio 0.5 /
  innermod 1 / outermod 1 / dynamic_spread_limit 255 / AK-47。
- 配置在实验前已备份（`backup-cs2-20261017/`），退出后已还原并 MD5 校验一致。

### 9.2 静息 / 开火（0.35s）像素结果

| style | 静息 bbox | 开火 bbox | 观察 |
|---|---|---|---|
| 0 Dynamic Cross | 60×60 | 64×64 | 四臂 gap 外扩约 +7px，length/thickness 不变 |
| 1 Dynamic Circle | 18×18 | 32×32 | 圆环，外半径 9→16；与 length/gap 无关 |
| 2 Classic Dynamic | 60×60 | 80×80 | 外臂整体外推；innermod=1 时内臂完全隐藏，外沿约 40 |
| 5 Static Cross (Shot Feedback) | 60×60 | 80×80 | 与 style 2 相同的分裂外推 |
| 7 Dynamic Quad | 60×60（四臂）+ 16×16（菱形环） | 60×60（四臂）+ 34×34（环） | **四臂不动**，只有中心菱形环随散布外扩 |

style 7 连续开火 0.6 / 1.2 / 1.8s：菱形环外框稳定在 60×60（外半径 30），四臂始终 60×60。
style 2/5 的外臂内沿约 23、外沿 40，中心为大孔；不是“内臂+外臂都可见”的双层结构。

> **2026-10-22 更正（v4.1）**：上表 style 5 的「与 style 2 相同的分裂外推」不成立——`0xda6b60` 只调
> **一次** ARMS，半径是 `round(max(0,gap) + H·k/1200)`、k∈[0,25]（每发 +n/3.5、每秒衰减 42）。
> 表里的「60×60 → 80×80」是旧口径（把 gap 换算当成分裂），应以 `tools/re/CROSSHAIR-REVERSE.md` §style 5 为准。

> **2026-10-21 更正**：上面 style 7 的「菱形环」是低分辨率连发截图的误读。用游戏自带准星设置页的 1:1 实时预览逐帧测量后，样式 7 实为**四段 45° 圆弧**（圆心在四个对角方向、轴向留空），中心线半径静息 ≈4 → 满散布 ≈73，弧粗恒等于 thickness。表里的 bbox 数字只对「外接方框」有效，形状结论作废；实现已按新结论重写（`js/render-model.js` 的 `quadrantArcs`）。

### 9.3 结论与实现映射

> **2026-10-22 二次更正（反汇编 0x180DA0610 后）**：本节下面的半径公式已被 client.dll 实测的绘制实现取代。
> 现在的实现（`js/render-model.js`）按样式分别取值，**length 只影响四臂**，圆/弧/方的像素带统一落在 `[基准, 基准+thickness]`（画布用中心线半径 = 基准 + thickness/2）：
> style 1 内径 = dist；style 3 内径 = `max(1, gap)`；style 7 弧外径 = `clamp(dist, 0|t, limit+64)` + thickness；style 8 外沿 = `gap + thickness`；style 9 弧外径 = `max(1, gap) + thickness`。
> 详见 `tools/re/CROSSHAIR-REVERSE.md`。

- **散布距离（全样式共用）**：`dist = gap + spread01 × 散布上限/255 × 70`（@1080p，cl_crosshair_dynamic_spread_limit 帮助文本的 128px 基线 × CS:GO 的 0.55 系数；1080p 实测满散布 ≈ +70px）。
- **style 0**：四臂整体外扩，臂内沿 = dist；臂长/粗细仍按 length/thickness。
- **style 1**：圆环内径 = dist（与 length 无关）；style 3：静态圆，内径 = max(1, gap)。
- **style 2**：开火时分裂成**两套四臂**（游戏 0xDA66C0）：内臂长度 = `ceil((1-splitSizeRatio)×length)`、
  外臂长度 = `round(length×splitSizeRatio)`、外臂 gap 外推 `splitDistance×env`；
  内臂透明度用 `innerSplitAlpha`（1=隐藏），外臂用 `outerSplitAlpha`，回落到同一包络。
- **style 5**：**单套四臂，不分裂**（游戏 0xDA6B60）。设置页里 style 5 也不显示 Dynamic Spread Dist，
  也不再输出 `cl_crosshair_dynamic_*` —— 早期「style 5 与 style 2 同构」的结论来自低分辨率连发截图，已作废。
- **style 7**：四臂按 length/thickness/gap 静止绘制；中心四段 45° 象限弧随散布变化，弧外径 = clamp(dist, …, limit+64) + thickness（2026-10-22 按反汇编重写）。
- **style 8**：静态方框，外沿 = gap + thickness、边宽 = thickness；**style 9**：静态四分弧，外径 = gap + thickness，轴向 90° 弧。
- 所有样式共用 UI 的 rAF 包络（上升 1.6/s、回落 3.2/s，一轮 ≈2950ms），但映射到各自几何；这就是“统一逻辑、各自几何”。

### 9.4 未覆盖

- style 3（静态圆）/ 8（静态方形）/ 9（静态四分区）未采集；仍为按名称与旧数据推导的近似。
- 实际扩散随武器、移动、跳跃、距离变化；预览用 AK 连发的代表性包络，不是逐武器模拟。
- 游戏设置页的红色弹道/散布图案是游戏自己的调试叠加层，不属于准星几何，未复刻。

---

## 10. 2026-10-18：离线取证（任务 A 码级 + prosettings SVG 交叉验证 + 任务 E 数据管线）

本轮游戏进程未运行（`Get-Process cs2` 为空），**不做任何实机操作**，只做离线可完成的取证。

### 10.1 任务 A 离线部分：归档码 round-trip（通过）

任务书要求归档的码 `CSrUznuTXR4JnE4t2RnUUVmzJfUftLocNkkDq5mbO6dkzf`（46 字符）：

| 检查 | 结果 |
|---|---|
| `CS.detectContainer(c)` | `"cs2"` |
| `CS.decodeInfo(c)` | `container:"cs2"` · `format:"cs2-v1"` · `migration:null` → **容器仍是 cs2-v1，没有变成 cs2-v2** |
| `CS.encodeShareCode(decodeInfo(c).model) === c` | **true（逐字符一致）** |
| 与 `test/fixtures/vcfg-crosshair-20261015.txt` 实机快照逐字段比对 | **15 / 15 一致** |

解出的模型：`style 4 / length 6 / thickness 2 / gap 6 / screenHeight 960 / dynamicSpreadLimit 227 /
splitdist 6 / innermod 1 / outermod 0.5 / splitratio 1 / sniperWidth 0 / RGB(0,255,0) alpha 255 /
outlineMode 0 / outline RGB(0,0,0) alpha 255 / followRecoil false / dot false / tStyle false /
scopeDotScale 1 / scopeDotUseCrosshairColor false`。

> 结论：该码就是 2026-10-15 实机配置的编码，**cs2-v1 布局在客户端 1.41.9.1 下成立**。
> 这是码级证据；「游戏内导入 → 再导出」的三方比对仍需游戏运行，**仍未做**。

### 10.2 prosettings 选手页 SVG：几何的第二个独立证据源

prosettings 选手页的准星不是图片，而是 **40×40 viewBox 的逐像素 `<rect>`**
（`<rect x="21" y="19" width="2" height="2" fill="rgb(11,255,0)"/>`，中心 20）。
历史 API `https://prosettings.net/wp-json/pro/v1/crosshair-pipeline/history?player_id=<id>`
每条记录同时给 `crosshair_code`（CS 新码）与 `svg`，因此可以对同一条准星做
「我们的解码器 + 几何」与「站点自己的渲染」双向对拍。

方法：取 donk 的 9 条新格式历史，用 `CS.crosshairRects(model,{viewHeight:model.screenHeight})`
算 `f`/`x`，按 `gap = x + ceil(f/2)` 还原模型 gap，与 SVG 里「右臂左沿 − 中心 20」比对：

| 指标 | 命中 | 说明 |
|---|---|---|
| 厚度 `f` | **8 / 9** | 唯一失配 `CSmuKF5p…`：我们 f=2、SVG 3（该条 gap=1、thickness=2） |
| 间隙 `gap` | **8 / 9** | 唯一失配 `CSuSvGbp…`：模型 gap=0，SVG 里右臂与中心重叠被省略（绘制退化，非几何错误） |

> 这是**独立于 cs2util 的第二个证据源**：`f = max(1, round(thickness*scale))`、
> `x = round(gap*scale) - ceil(f/2)` 与站点官方渲染一致。
> 未覆盖：样式 1/3/7/8/9 的圆/方/四分几何（SVG 里同样只有 rect，不足以区分形状近似）。

### 10.3 任务 E：数据管线全量更新

三处退出码 3 闸门早在 2026-10-16 移除（`tools/sync-prosettings.js` 已删除），本轮直接跑全量：

```
node tools/auto-update.js --no-dist
```

- 索引 55 页 → 站点返回 1099 人 / 218 队 → 实际跟踪 **31 队**；抓取 **172/172 成功 · 0 失败**（159 秒）。
- `js/players.js`：**172/172 人都有 `c2`**（新格式码），30 人额外保留 `c`；
  全库 1731 条码中 cs2-v1 488 / legacy 1243。
- 准星变动 21 人（明细见 `tools/update-report.md`）。
- `node test/check-freshness.js` 抽查 24 名：**一致 24 / 不一致 0 / 失败 0**。
  更新前是 20 / 4 —— 逐字段复核后确认那 4 个差异是**选手自己改了准星**，不是解析 bug：
  molodoy（spread 182 vs 227、splitdist 2 vs 3、screenHeight 768 vs 960、sniperWidth 1 vs 0）、
  Jimpphat（blue 246 vs 74、gap 1 vs 2、length 2 vs 4、thickness 2 vs 1）、
  MartinezSa（gap/length/thickness/sniperWidth）、
  ShahZaM（旧格式页面 `isNewFormatFields=false`，差异大）。
- 连带影响：全库粘贴分段 1698 条 / 20 条 2 段 → **1701 条（全部一次粘贴）**；
  2026-10-22 反汇编确认 style 5 不分裂后，之前的 21 条 2 段全部消失（`node test/check-paste.js` 现报 0 条需分段）。

### 10.4 本轮测试与构建

- `node test/run-all.js` → **8 个套件全绿**。
- `node tools/build-dist.js` → 78 个文件 · 2.49 MB。

### 10.5 仍未获取（需游戏进程）

- 任务 A 的游戏内导入/再导出三方比对；
- 任务 B 的逐像素几何对拍（样式 1/3/7/8/9、半描边 `drawoutline 2`、描边色独立性、hud_scaling）；
- 任务 C 的分辨率缩放实测（1920×1440 / 1280×720 / 1024×768 与同高度不同比例）；
- 任务 D 的控制台 `find` 清单；
- 任务 F 的 `cl_crosshair_sniper_width` 开镜实测与 `crosshair` 总开关建议。

以上均标注为**未获取**，不以近似代替实测。

