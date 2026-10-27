# Showkey · CS2 准星工坊

CS2 准星生成器 + 职业选手准星库。像素级对齐官方 HUD 渲染。

数据分两路：**准星与分享码**自动同步自 [prosettings.net](https://prosettings.net)；**战队资料（队标、排名、现役阵容）** 抓取自 [HLTV.org](https://www.hltv.org)。

---

## 一、快速开始

双击项目根目录的 **一键启动.bat**，浏览器会自动打开 <http://127.0.0.1:3800>。

或者手动执行：

```
node server.js
```

看到 `CS2 准星工坊 server running at http://127.0.0.1:3800` 即成功。
服务运行期间电脑不能关机、不能关闭该窗口。

> 需要 Node.js 18 以上（推荐 LTS）：<https://nodejs.org>

页面共两个页签：

| 页签 | 作用 |
| ---- | ---- |
| **生成器** | **置顶的 1:1 实时预览**（改任何参数即时重绘，动态样式可动画演示）+ 调参（新像素刻度、10 种样式）+ 分享与导入 / 控制台命令 / PNG，宽屏一屏看全 |
| **选手准星** | 左侧战队栏选中战队后，顶部展开**战队详情卡**（HLTV：队标 / 排名 / 现役阵容横向一排）；下方按战队浏览选手当前准星、历史版本与完整设置（**旧码已按官方公式近似换算**） |

三个亮点：

- **队标 / 头像 / 国旗来自 HLTV 官方素材**（day / night 两套都有存档；深色主题优先用 night 变体、个别仍偏暗的队再叠一层细光晕，**不使用浅色底板**，理由见第三节「队标与图标来源」）
- **零后端、零网络请求**：整个站点是纯静态前端（复制分享码 / 粘贴导入都在浏览器里完成），双击 `index.html` 也能用
- **按系统偏好自适应**：默认跟随系统深浅色；响应 `prefers-reduced-motion`（关掉动画）、`prefers-contrast: more`（次要文字与分隔线自动加深，实测暗色 label-3 由 5.85 提到 10.71）、`forced-colors: active`（Windows 高对比度下选中态改用系统高亮描边，准星预览与色块保留真实颜色）；全站表单控件与图标按钮都有可访问名
- **触控与窄屏**：鼠标态维持高密度，`pointer: coarse` 或 ≤760px 时按钮 / 页签 / 下拉 / 折叠头统一抬到 36–44px 高，横向战队条带吸附对齐；正文在两套主题下的对比度均 ≥4.5（`.td-col-note` 这类说明文字也从 label-4 提到 label-3）

> **2026-10-15 准星系统重构**：内部模型已整体切换到 CS2 新准星系统
> （厚度/长度/间隙单位为**像素**，样式 0–9，分享码为 `CS` 开头的 46 字符新码）。
> 代码结构、迁移策略与验证证据见 **[CS2准星重构-实现说明.md](CS2准星重构-实现说明.md)**。
> 旧的 `CSGO-` 分享码游戏已不接受导入，本站仍可解析并换算，但会明确标注「近似」。

### 准星库的新旧规则（双轨）

| | 旧准星（源数据早于 2026-09-23） | 新准星（源数据为新格式） |
| ---- | ---- | ---- |
| 判定 | 分享码是 `CSGO-` 开头（legacy-v1/v3/v4） | 分享码是 `CS` 开头的 46 字符新码 |
| 保存预览图 | ✅（文件名带 `-approx`） | ✅ |
| 应用到生成器调参 | ✅（标注「近似转换」） | ✅ |
| 复制分享码 | ✅ 复制的是**转换码**：先弹出差异确认，确认后复制 | ✅ 原码直接复制 |
| 复制控制台命令 | ✅（标注「近似换算」） | ✅ |
| 下载 .cfg | ✅（文件名带 `-approx`） | ✅ |
| 复制原始码 | ✅ 仅存档（折叠区；游戏已不支持导入） | — |

转换确认框会列出 `migration.notes` 中的实际差异（样式映射、负 gap、描边模式、超量程等），并标注原格式 / 参考高度 / 有损或直搬。**转换码不代表选手当前设置。**

> 历史版本逐条独立判定，与选手当前准星状态无关；旧码行显示「转换」，新码行显示「复制」。
>
> 选手详情页的「历史版本」列表**第一条永远是当前正在使用的那一版**（带「当前」标记，来源写「最新检测 · 正在使用」），
> 其下才是更早的历史记录，最多再列 11 条。这样「当前」与「历史」在同一处对比，不用来回切换。

### 收录范围：近两年 CS Major 参赛队

准星库只收录 **2025–2026 年打过 CS Major** 的队伍（Austin 2025 · Budapest 2025 · Cologne 2026，共 31 队）。
过滤白名单写在 `tools/auto-update.js` 的 `MAJOR_TEAMS`；新 Major 赛后需手动补 key 才会纳入新队。

按产品要求，以下 6 支战队的准星预览数据已从库中移除，并写入 `EXCLUDED_TEAMS`，后续自动更新不会重新收录：
Imperial、Metizport、Nemiga Gaming、The Huns、Fnatic、Fluxo。

### 战队详情卡（队标 / 排名 / 阵容，数据来自 HLTV.org）

在选手准星页左侧战队栏**选中任一战队**，玩家列表上方会展开一张**战队详情卡**（选中「全部战队」时收起）。
这张卡展示的是战队资料，与下方选手卡片上的准星数据是两条独立的数据线：

| 内容 | 来源 | 说明 |
| ---- | ---- | ---- |
| 队标、队名、国家/地区、Valve 排名、世界排名、区域排名、现役阵容 | **HLTV.org** 战队页 | 由 `tools/hltv-sync.js` 抓取后落成静态快照 `js/hltv-teams.js`，图片落 `assets/hltv/` |
| 选手准星、分享码、历史版本、外设与视频设置 | **prosettings.net** | 由 `tools/auto-update.js` 生成 `js/players.js` |

> 快照里仍保留 `weeksTop30` / `avgAge` / `coach` / `trophies[]` / `socials[]` / `matches[]` 等原始字段，但**界面只渲染队标、队名、国家、三枚排名与现役阵容**——教练、档案栏、冠军荣誉栏、社交入口与赛程战绩都已从卡片上移除，好让下方的准星卡片更早露出来。

卡片布局（头部 + 一行横向阵容，随屏幕宽度降级）：

```
┌──────────────────────────────────────────────────────────────┐
│ [队标56]  队名                       ┌────┐┌────┐┌────┐      │
│           🇪🇺 Europe                          │世界││区域││Valve│ │
├──────────────────────────────────────────────────────────────┤
│ 现役阵容  HLTV 当前名单 · 5 人                                │
│ ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐      │
│ │[头像40] 昵称││[头像] 昵称 指挥││ … 横向一排，窄屏可横滑     │      │
│ │ 真名 🇸🇪 ││ 真名 🇨🇦 ││        ││        ││        │      │
│ └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘      │
├──────────────────────────────────────────────────────────────┤
│ 队名 / 队标 / 阵容 / 排名来自 HLTV.org（快照 YYYY-MM-DD）· 准星与分享码来自 prosettings.net │
└──────────────────────────────────────────────────────────────┘
```

字段映射（HLTV 页面元素 → 快照字段 → 界面）：

| HLTV 页面 | `js/hltv-teams.js` 字段 | 界面位置 |
| --- | --- | --- |
| `div.profileTopBox` 队标（`teamlogo img`，day/night 两套） | `logo.day` / `logo.night` | 详情卡 56px、侧栏 26px、分组头 26px、选手卡片 20px、选手弹窗 68px（≤760px 时详情卡 48px） |
| `h1.profile-team-name` | `name`；短名 `localName` | `.td-name` 用短名，`.td-sub` 用全名 |
| `div.team-country` 国旗 + 文本 | `country` / `flag` | 队名下方（有国旗图用图，缺图回落 emoji） |
| `profile-team-stat` 的 Valve ranking | `ranks.valve`、`ranks.valveRegionShort`、`ranks.valveRegionRank` | 第三枚排名徽章 |
| `profile-team-stat` 的 World ranking | `ranks.world`、`ranks.worldRegion`、`ranks.worldRegionRank` | 第一 / 第二枚排名徽章 |
| Coach | `coach.{name,real,country,flag,url}` | **不展示**（快照保留原始字段，界面不渲染教练，也不给 HLTV 外链） |
| `div.bodyshot-team` 阵容（头像 / 昵称 / 国旗 / `role-pill--igl`） | `lineup[].{nick,real,country,flag,igl,avatar,url,id}` | 现役阵容横向一排（指挥带「指挥」标） |
| Weeks in top30 for core | `weeksTop30` | **不展示**（快照保留） |
| Average player age | `avgAge` | **不展示**（快照保留） |
| 奖杯墙 `div.trophyRow` | `trophyCount`、`trophies[]` | **不展示**（快照保留） |
| `div.socialMediaButtons a` | `socials[].{platform,url}` | **不展示**（快照里保留原始数据，界面不渲染社交入口） |
| 近期战绩表 `table.match-table`（`tr.team-row`） | `matches.recent[]`、`matches.upcoming[]` | **不展示**（快照里保留原始数据，界面不渲染赛程与战绩） |
| JSON-LD `SportsTeam.athlete` | 与 DOM 阵容交叉校验 | 阵容兜底解析 |

几条固定行为：

- **选手卡片上的「HLTV 现役」小标签**：只有当该选手昵称与所选战队的 HLTV 现役阵容**完全同名**时才出现；本地 prosettings 名单与 HLTV 阵容不同步时（例如已离队、或 HLTV 页面停更），不显示，绝不猜测。
- **缺数据走空态**：没有阵容/排名的战队（当前是 3DMAX，HLTV 上只剩 2015 年的老队页）显示「HLTV 暂无现役阵容记录（该队页已停更）。」，队标回落本地 `assets/teams/3dmax.png`。
- **国旗缺图回落 emoji**：HLTV 只提供 30×20 一种尺寸的国旗 GIF，个别国家缺图时用 emoji 兜底，不会出现空图框。
- **详情卡不跳转外部站点**：队名、教练、选手都不再外链 HLTV（快照里的 `url` 字段仍保留，界面不渲染链接），减少误点离开本站。
- **黑队标可见度**：深色主题优先加载 HLTV 的 `night` 队标变体（8 队有独立 night 版，Spirit / Vitality / B8 / NiP 等会直接变成白色版）。**不加任何光晕或底板** —— 队标按素材原样渲染，额外描边会在深色界面上放大尺寸并糊掉细节。
- **响应式**：≥1181px 详情头部一行（队标 + 队名 + 排名行），下方阵容横向一排可横滑（每卡 196×56px）；≤1180px 头部允许换行、排名行落到第二行；≤980px 侧栏变成顶部横向滚动条（隐藏人数、队标 26px 不变）；≤760px 详情卡队标 48px、队名 19px，选手卡片 238px 高、准星区 100px（画布 92px）；≤620px 阵容改**单列全宽**（每卡 100% 宽），真名与国旗照常显示。选手卡片在任意屏宽下都是**同一高度**（>760px 250px / ≤760px 238px）、画布恒为 104px 见方，昵称长短只影响截断位置，不改变任何元素尺寸。
- **筛选是「与」关系**：位置 × 战队 × 搜索词可叠加，不会互相顶掉。位置口径 = 源数据 AWPer + HLTV 现役阵容的 IGL 标记（一人可同时是「狙击手 / 指挥」，如 FalleN、Jame）；搜索词同时匹配昵称、真名与战队名；无结果时回显当前条件并给「清除筛选条件」按钮。
### 预览比例与动态演示

- **预览置顶、占页面主位**。宽屏下首页第一行是「实时预览（左，`1.62fr`）+ 分享与导入（右）」，参数面板整行在下方；预览舞台自动吃掉同排剩余高度（`min-height:300px`），页面在 1600×1000 / 1440×900 / 1280×900 下**一屏看全**，不再需要边滚动边看。舞台底部是一条 56px 信息条：左边是样式与 GAP/LEN/THK/RGBA 读数，右边是地图切换。画面内只保留左上角「1:1 预览」角标与左右切图箭头 —— **右下角的「细节」放大窗已彻底移除**（它会在切换样式时随 `contentSpan` 反复改倍率，反而干扰对 1:1 像素的判断）。**旧的右侧 sticky 预览栏与移动端悬浮小窗都已删除**。窄屏（≤1100px）自动变成单列：预览 → 分享 → 参数。改样式、长度、粗细、间隙、RGB、轮廓……每次输入都会即时重绘（canvas 内尺寸恒等于 CSS 尺寸，DPR 感知）。
- **显示方式：1:1 原生像素，没有检视倍率**。预览区把 **1 个模型像素画成 1 个 CSS 像素** —— 也就是游戏里 1 像素宽的臂，在页面里就是 1 像素宽，与窗口大小、DPR、屏幕分辨率无关。这与 prosettings 的做法一致（它的选手页用固定 50×50 像素格 + 逐像素 `<rect>` + `image-rendering: pixelated`，生成器页用固定 160px 高的 DPR 感知 canvas，两处都**没有**缩放控件）。
- **背景只是衬底**：地图截图用 `object-fit: cover` 铺满取景框，纯装饰，不参与任何缩放换算，也不代表游戏比例。
- **不再有「制作基准」选项**：准星几何在 CS2 里已按屏幕高度自动等比缩放，用户不需要、也不应该在页面上选「基准分辨率」。模型里仍保留 `screenHeight` 字段（首次加载取用户屏幕高度），它只用于**导出 PNG 尺寸**、分享码/控制台命令里的 `cl_crosshair_screen_height`，以及库页缩略图的等比还原，不影响预览里的像素大小。
- **为什么去掉 1× / 2× / 4×**：那三档会让用户误以为准星能随分辨率「变大变小」，而准星在游戏里是固定像素尺寸。要看清整屏构图请用「保存预览图」（按几何 × 倍率导出 PNG），要放大看细节请用系统缩放。
- **动态预览**：仅动态样式可用。点「动态预览」自动循环演示连发时的散布扩散与回落；也可以按住预览画面手动连发（跟随准星开启时会有上抬）。动画是代表性武器散布示意，不写进分享码或命令。
- **各样式几何（按 client.dll 反汇编 0x180DA0610 + 1080p 实测）**：`散布距离 dist = gap + spread01 × 散布上限/255 × 70px @1080p`；弧/环的像素带统一落在 `[基准, 基准+thickness]`，画布按中心线半径 = 基准 + thickness/2 绘制。style 0 四臂整体外扩；style 1 圆环内径 = dist；style 2 双套四臂（内臂按 splitSizeRatio 缩短、外臂外推 splitDistance，内外分别走 innerSplitAlpha / outerSplitAlpha）；style 3 静态圆内径 = max(1, gap)（与 length 无关）；style 4 静态十字；style 5 单套四臂（游戏 0xDA6B60：不分裂、不吃散布）；style 6 纯中心方块（开描边时不绘制）；style 7 四臂固定、中心四段 45° 象限弧（外径 = dist + thickness，弧粗 = thickness）；style 8 静态方框（外沿 = gap + thickness、边宽 = thickness）；style 9 静态四分弧（外径 = gap + thickness，轴向 90° 弧）。

---

## 二、把准星导入游戏（重要）

### 推荐：分享码（最稳）

设置 → 游戏 → 准星 → **分享或导入** → 粘贴分享码。

### 为什么控制台会报 Command too long... ignoring!

**关键不是"有几条指令"，而是"有没有分号分隔"。**

CS2 控制台输入框是**单行**的：把多行文本粘进去时换行会被丢掉。
如果那些行之间**没有分号**，所有 `cl_crosshair_*` 会首尾相接变成**一条命令**：

```
cl_crosshairstyle "4"cl_crosshair_length "11"cl_crosshair_thickness "2"...
```

一条几百字符的命令 → 超过引擎单条命令上限 → 整条丢弃并打印
`WARNING: Command too long... ignoring!`

反过来，只要有分号，引擎会把这一行**拆成若干条独立命令**（每条只有 20~45 字符），
总长度并不是问题 —— 主流工具 cs2util 输出的同类单行串长达 **550 字符**，照样能用。

### 本工具给出的答案

「生成器 → 分享与导入 → 控制台命令」的文本框里，**每一句命令单独占一行**（方便核对每一项参数）：

```
cl_crosshairstyle 4
cl_crosshair_length 11
cl_crosshair_thickness 2
cl_crosshair_gap 7
cl_crosshaircolor_r 0
cl_crosshaircolor_g 255
...
```

这段多行文本**只是给人看的**。点 **⧉ 复制命令** 时，工具会自动把它合并成
**一条分号分隔的单行命令**再写进剪贴板，界面显示的是那一行的真实长度（`单行 n / 512 字符`）：

```
cl_crosshairstyle 4;cl_crosshair_length 11;cl_crosshair_thickness 2;cl_crosshair_gap 7;cl_crosshaircolor_r 0;cl_crosshaircolor_g 255;...
```

粘进控制台 → 回车 → 生效。

**所以你永远不需要手动把多行拼起来**：显示是逐句多行，复制出来是单行分号版，
不会再出现"粘进去变成一条超长命令"的情况。文本框会按内容自动撑高，14 行的默认配置一屏就能看全，不用滚动。

> **投掷物准星等附属项只写进 .cfg，不占粘贴行** —— 所以粘贴行现在很短：
> 默认配置 **330 字符**，全库 172 名选手的 1701 条准星中 **1701 条（100%）一次粘贴即可**（最长段 486 字符）。
> 一条都不再需要切段 —— 样式 5 已按 `client.dll` 反汇编（0xDA6B60）确认为**单套四臂、不分裂**，
> 不再输出 `cl_crosshair_dynamic_*` 分裂参数，之前那 21 条 2 段的配置随之消失。
> 一切以 `node test/check-paste.js` 为准：它逐条断言每段 ≤ 512、且**不出现任何旧 convar**
> （已移除的 + 客户端仍保留但 hidden 的，两类都不输出）。

> 为控制长度，单行命令只包含**当前样式/开关下真正生效**的 convar：
> `cl_crosshair_dynamic_*`（只有样式「2 动态十字(经典)」开火分裂时生效）、
> 静态样式的 `cl_crosshair_recoil` 与 `cl_crosshair_dynamic_spread_limit`、
> 未开描边时的 `cl_crosshairoutline_r/g/b/a`。
> 这些项被省略后对当前样式的渲染**没有任何影响**。

### 完整 CFG 文件（一行一条的官方格式）

需要 .cfg 文件时，可在浏览器控制台用一行代码导出（内容一行一条、值加引号，
与游戏自己写的 `config.cfg` 格式完全一致）：

```js
CS2Crosshair.settingsToCfgFile(CS2Crosshair.defaultSettings())
```

```
cl_crosshairstyle "4"
cl_crosshair_length "11"
cl_crosshair_thickness "2"
...
```

存为 `showkey-crosshair.cfg`，放进
`…\Counter-Strike Global Offensive\game\csgo\cfg\`，控制台执行
`exec showkey-crosshair`。

> 这是**多行文件**，只适合用 exec 加载。（想直接粘贴就用上面的单行命令。）



## 三、数据自动更新（离线 CLI）

> ✅ **2026-10-16：抓取器已适配 prosettings 新准星系统。**
> 站点改版后选手页直接给新 convar 名（`cl_crosshair_length` / `_thickness` / `_gap` /
> `_screen_height` / `cl_crosshairoutline_*` / `cl_ironsight_*`）与文本样式名，不再给分享码；
> 抓取器把新字段组装成新像素模型并生成 **cs2-v1 分享码**（`c2` 字段）。
> 历史 API 新旧码混合，每条带 `lg` 时代标记——准星库按**源数据时代**判定：
> 旧时代源数据只给预览图保存，新格式源数据给完整功能。
> 页面解析逻辑在 `tools/prosettings-parse.js`（`auto-update.js` 与 `check-freshness.js` 共用），
> 正确性由 `test/check-scraper.js` 用真实页面样本把关（含「生成码与站点发布码逐字符一致」断言）。
>
> ✅ **2026-10-17：收录范围收敛为「近两年 CS Major 参赛队」。**
> `tools/auto-update.js` 的 `MAJOR_TEAMS` 白名单（Austin 2025 · Budapest 2025 · Cologne 2026）
> 会在抓取前过滤战队，非 Major 队与其选手整队移出；安全闸门 `rosterGuard` 的基线已同步改为
> 「旧数据里同属 Major 队的人数」，不会把有意缩减误判为抓取异常。

> ✅ **2026-10-22：战队档案接入 HLTV.org（与准星数据分两条线）。**
> 队标、队名、国家/地区、Valve & 世界排名、世界前 30 周数、平均年龄、教练、现役阵容、
> 奖杯、社交链接、近期战绩与即将开赛，改由 `tools/hltv-sync.js` 从 HLTV 战队页抓取，
> 生成 `js/hltv-teams.js`（`window.HLTV_TEAMS` / `HLTV_META`）并把图片落到 `assets/hltv/`。
> **准星与分享码仍然只来自 prosettings.net** —— HLTV 没有准星分享码数据，两者职责不重叠。

> ✅ **2026-10-23：选手准星库界面重构 + 生成器重排（最后一版）。**
> ① 选手库尺寸回调到「信息密度优先」：标题 30px、统计块数字 20px、侧栏 252px、队标 26px、
> 卡片准星画布 104px（≤760px 随容器缩到 92px，四周始终留 4px 呼吸）、选手名 15px、按钮 13px，卡片网格 `minmax(224px,1fr)`、gap 12px。
> ② **选手卡片尺寸完全锁定**：`height:250px`、`grid-template-rows:112px 1fr`（≤760px 为 `238px` / `100px`），
> 昵称长短只影响省略号位置；`.pc-top` / `.pc-meta` / `.pc-tags` 三段固定行高，徽标缺失也占位，卡片永远同高。
> ③ 战队详情卡 =「头部一行 + 现役阵容横向一排（可横滑）」，删掉战队档案与冠军荣誉两栏，
> 教练并入头部；每张阵容卡固定 196×56px，昵称只截断不改宽度。
> ④ 黑队标改用「night 变体优先」方案，**废弃浅色底板与额外的光晕描边**。
> ⑤ 生成器重排：**实时预览置顶成主视觉**，分享与导入同排放右上，参数面板整行铺在下方（≥1200px 五栏 masonry），
> 1600×1000 / 1440×900 / 1280×900 一屏看全；删除右侧 sticky 预览栏与移动端悬浮小窗，「制作基准」分组与滚动收窄一并移除；
> ≤1100px 单列（预览 → 分享 → 参数）。
> ⑥ 全部样式名 / 字段名对齐游戏内中文文案（静态十字、动态圆形、轮廓、长度、粗细、间隙…）。

> ✅ **2026-10-23 追加：首页重排为「预览置顶 + 一屏看全」。**
> ① 首页第一行改成「实时预览（左，`1.62fr`）+ 分享与导入（右）」两块等高面板，参数面板整行铺在下方；
> 宽屏（≥1200px）参数铺 5 栏，1600×1000 / 1440×900 / 1280×900 实测**整页一屏装下**。
> ② 预览舞台不再固定宽高比，改为吃掉同排剩余高度（`min-height:260px`），画面比之前更高、更像游戏画面。
> ③ 读数从画面内的浮层下沉成舞台底部 46px 信息条：左边样式与 GAP/LEN/THK/RGBA、中间地图切换、右边当前地图名；
> 画面内只留「1:1 预览」角标与左右切图箭头（右下 104px 细节窗后续已移除，见 2026-10-24 第二条）。
> ④ **删除右侧 sticky 预览栏与移动端悬浮小窗**（`.mini-preview` / `updateMiniPreview()` 全部移除）。
> ⑤ 命令框改为固定高度（84px）+ 内部滚动，不再按内容自动撑高 —— 否则会把同排预览一起拉高。
> ⑥ ≤1100px 单列顺序改为「预览 → 分享 → 参数」；≤860px 参数单栏、预览头部动作与信息条换行。

> ✅ **2026-10-24 追加：可读性 / 触控 / 细节修正。**
> ① 触控目标：`pointer: coarse` 或 ≤760px 时页签、按钮、下拉、折叠头、主题键统一抬到 36–44px；
> 横向战队条改为 90° 渐隐 + `scroll-snap`，滑动时不再切掉队标下沿。
> ② 对比度：`.td-col-note` 由 label-4 提到 label-3（3.65 → 4.97），战队详情块两套主题均 0 处不达标。
> ③ （已废弃）瞄准镜准星点画布曾补 CSS 尺寸；该分组与画布后来整体下线，见 2026-10-24 第二条。
> ④ 清理 11 组无引用的 CSS 选择器，字号基线定在 12px（选手库内无更小正文）。

> ✅ **2026-10-24 追加：生成器控件整体放大 + 移除细节窗与瞄准镜准星点。**
> ① **控件全面放大一档**（桌面基线）：滑杆 22→26px 高、轨道 4→5px、滑块 15→18px；
> 字段行距 9→12px、标签 13.5→14px、数值徽标 46→52px 宽；分段按钮 7→9px 内距、字号 13→13.5px；
> 开关 44×26→50×30（滑块 24px）；色块 38→46px、常用色按钮 24→30px；下拉 9→12px 内距、字号 14px。
> 预览头按钮 32→38px 高、内距 0 12→0 15px；分享码输入框与「复制」按钮统一 42px 高。
> 舞台读数条 46→56px（字号 13px、地图按钮 8px 14px），舞台最小高度 260→300px。
> 参数分组按内容重新分栏：≥1320px 五栏、≥1240px 四栏、≤1240px 两栏、≤860px 单栏。
> ② **移除「细节放大窗」**（`.stage-loupe` / `#stageLoupe` / `#loupeCanvas` / `renderLoupe()` 整条链路删除）。
> 该窗用 `contentSpan` 反推倍率 `z = clamp(floor((box-12)/span), 2, 6)`，
> 动态样式开火时 span 会从 37px 涨到 181px，倍率随之跳动，反而让人误判 1:1 像素。
> ③ **修复「切到动态十字时预览异常变大」**：根因是切换样式时上一款的动态包络（`dyn.spread` / `dyn.climb`）没清零，
> 被带进新样式——动态十字满包络时臂外推约 72px，跨度 37→181px。现在 `#styleSel` 的 change 与 `applySettings()`
> 开头都先调用 `dynHardStop(false)` 归零动画状态，再应用新模型。
> ④ **移除「瞄准镜准星点」分组**（滑杆 `scopeDotScale`、开关 `scopeDotUseCrosshairColor`、44px 预览小画布一并下线）。
> **数据模型字段、分享码编解码与 `cl_crosshair_dot` 命令映射全部保留** —— 旧码/旧命令仍能完整还原，只是不再在首页暴露该参数。
> ⑤ 颜色分组把「当前色块 + 六个常用色」并成一行，配合控件放大后仍保持一屏；移除分组后参数区由六栏收为五组。
> （该行 2026-10-26 已被色轮调色盘取代，见下方追加说明。）

> ✅ **2026-10-26 追加：颜色控件换成色轮调色盘 + 去掉教练与 HLTV 跳转 + 名单按 HLTV 现役阵容重抓。**
> ① **「颜色和透明度」分组整体重做**：删除 24 色候选色盘（`CROSSHAIR_PALETTE` / `#xhairPalette` / `.color-palette` 全部下线），
> 换成**真色轮**（`#cpWheel` + `#cpWheelCanvas` 144×144，角度=色相、半径=饱和度、圆心=白（饱和度 0））+ 明度条 + 不透明度条 + RGB 三通道数字框，
> 色轮下方显示 `#RRGGBB`。色轮支持拖拽、方向键 15°（Shift 45°）步进、`role="slider"` 无障碍语义；
> 明度条与不透明度条的渐变终点跟随当前色（`--cp-solid`），不透明度条叠棋盘格衬底。
> 原 RGB 三条滑杆（`#sRed/#sGreen/#sBlue`）一并下线，改成等宽三位数字输入（`#nRed/#nGreen/#nBlue`，change / blur / Enter 提交）。
> ② **战队详情卡不再展示教练，也不再跳转 HLTV**：`.td-coach`（教练链接）与 `.td-link`（「HLTV 档案 ↗」）连同对应 CSS 一起删除；
> 页脚与站点 footer 文案改为「阵容与排名来自 HLTV.org 快照」，不再出现「教练」。快照里的 `coach` / `url` 字段保留但不渲染。
> ③ **选手库按 HLTV 现役阵容重抓**：`tools/auto-update.js` 取人口径由「prosettings 站点分队前 6 人」改为
> **以 `js/hltv-teams.js` 的现役阵容为唯一权威**（同队优先匹配、索引缺条目时合成占位条目补抓），
> 结果 30 队 / **149 名选手**（全部为新格式页面），新增 Neityu、ryu、Moseyuh、Grim、Jeorge、Kaze，
> 移除 27 名已离队者（chopper、jL、Xyp9x、ANGE1、bit、MAJ3R、broky、olofmeister、HooXi、jabbi、slaxejezzz、
> dav1deuS、vsm、lauNX、tiziaN、ShahZaM、DANK1NG、SLOWLY、Snax、n0te、dephh、AZR、Ethan、s0m、oSee、Marek、Trash）。
> paiN 的 **Tatu** 在 prosettings 没有选手页（`/players/tatu/` 是英雄联盟选手），抓取失败并如实计入报告，详情卡仍按 HLTV 阵容显示 5 人。

> ✅ **2026-10-27 追加：下线「读取本机准星」+ 弹窗选手照片 + 两处视觉瘦身。**
> ① **「读取本机准星」整块下线**：删掉导入区的 `#btnReadLocal` 按钮与 `#localBox` 面板、`js/app.js` 里
> `LOCAL_API` / `readLocalCrosshair()` / `localReason()` / `renderLocalBox()` / `fmtWhen()` 全部代码、
> `css/style.css` 的 9.5 整节、`server.js` 的 `/api/local-crosshair` 路由与 `tools/local-crosshair.js` 依赖。
> **站点回到纯静态：app.js 零 fetch、无任何 `/api/` 路径**（`test/check-dom.js` 的约束由「恰好 1 处 fetch」改回「0 处 fetch」）。
> 命令行工具 `tools/local-crosshair.js` 保留，仍可单独跑出来再粘进导入框。
> ② **用腾出的空间压缩分享面板**：导入区改成「按钮 + 状态文字同一行」（`.import-actions`，省掉原来按钮行 40px + 状态行 20px 的纵向浪费）；
> 控制台命令区把「⧉ 复制命令」从底部动作行挪进标题行右侧（`.paste-head.cmd-head` + `.paste-head-right`），
> 正文 `#cfgOutput` 因此多出一整行高度。无使用者的 `.btn-row2` / `.btn-wide` 规则一并删除。
> ③ **选手弹窗加真人照片**：`.modal-player` 最左新增 `#mPlayerFace.m-playerface`（68×68，方角硬边、`object-fit:cover`），
> 图源是 `js/hltv-teams.js` 阵容成员的 `avatar`（`lineupOf(p)` 按昵称匹配，与详情卡 `.td-avatar` 同源）。
> 实测 149/149 名选手都能匹配到照片，匹配不到时隐藏该 `<img>` 不影响布局。
> ④ **两处视觉瘦身**：删掉战队侧栏的人数徽标 `.team-count`（每队都是 5 人，没信息量）；
> 删掉队标光晕方案（`LOGO_DARK` / `logoFx()` / `.logo-glow` / `.logo-glow-dark` 全下线），队标按 night 变体原样渲染。
> ⑤ **自适应收尾**：色轮右侧「明度 / 不透明度」两行原本沿用参数面板的三列栅格（116px + minmax(160px,1fr) + 54px），
> 在 `.cp-side` 只有 284px 时把 `100%` / `255` 挤出面板右缘 —— 改为 `auto minmax(0,1fr) auto` 只让滑杆伸缩。
> 命令区标题行在 ≤620px 放不下「标题 + 字数 + 复制按钮」，改为整组折行右对齐（此前 360px 时按钮超出约 20px）。
> 复测 1680 / 1440 / 1180 / 980 / 860 / 760 / 620 / 430 / 390 / 360 十档，生成器与选手页均无横向溢出。
> ⑥ **触屏命中区**：RGB 三个数字框在桌面上 22px 高，触屏（`pointer: coarse` 或 ≤760px）时抬到 40px、字号 15px，避免手机上点不准。

数据来源分工：

| 数据 | 唯一来源 | 生成物 | 抓取脚本 |
| ---- | ---- | ---- | ---- |
| 选手名单、准星、分享码、历史版本、外设、视频设置、显示器与键鼠参数 | prosettings.net | `js/players.js` | `tools/auto-update.js` |
| 战队资料（队标 / 排名 / 现役阵容） | HLTV.org | `js/hltv-teams.js` + `assets/hltv/` | `tools/hltv-sync.js` |

### 唯一方式：离线 CLI

**网页端不提供「数据更新」页签与后台**（管理后台、`/api/*`、管理员令牌已随精简一并移除）。
数据更新只能在命令行执行。

战队档案（HLTV）：

```
node tools/hltv-sync.js                # 全量 31 队（约 8–10 秒/队）
node tools/hltv-sync.js --only=faze,navi   # 只刷新个别队
node tools/hltv-sync.js --skip-images  # 只更新字段，复用已有图片
```

> HLTV 全站由 Cloudflare 挑战保护，Node/curl 直连一律 403，因此脚本**必须有真浏览器**：
> 先用有头模式启动 Edge（不能 headless），脚本通过 CDP 接管它自动过盾。
>
> ```
> msedge.exe --remote-debugging-port=9223 --user-data-dir=.tmp-edge ^
>   --no-first-run --no-default-browser-check ^
>   --disable-blink-features=AutomationControlled about:blank
> ```
>
> 端口可用 `--port=` 或环境变量 `CDP_PORT` 改。图片 CDN 只认页面内签名的请求，
> 所以队标/头像/国旗都是**在页面上下文里**取回 base64 再落盘，站外直连同样 403。

选手准星（prosettings）：

```
node tools/auto-update.js              # 全量更新（默认，最新）
node tools/auto-update.js --cache      # 快速模式：6 小时内缓存复用
node tools/auto-update.js --offline    # 只用本地缓存重建，不联网（秒级）
node tools/auto-update.js --watch 6    # 每 6 小时自动全量更新一次
node tools/auto-update.js --max-age 1  # 配合 --cache，缓存有效期改为 1 小时
node tools/auto-update.js --roster 8   # 每支战队最多保留 8 人
node tools/auto-update.js --no-autoteam  # 不自动纳入新战队
node tools/auto-update.js --no-dist    # 不重新生成 cs2-crosshair/ 静态包
```

更新完成后会自动改写 `index.html` 的资源版本号并同步 `cs2-crosshair/` 静态包。
想定时更新，自己用 Windows 任务计划程序指向这条命令即可。

### 更新脚本做了什么

1. 拉取 prosettings.net 的 CS2 选手索引（自动分页，约 1000+ 名选手）
2. 按 `MAJOR_TEAMS` 白名单过滤战队（只收近两年 Major 参赛队；新 Major 队需手动补 key）；
   再匹配本地跟踪的战队并自动纳入玩家人数 ≥6 的 **Major** 新战队（可在 `tools/teams.json` 调整）
3. 补齐缺失的队标到 `assets/teams/`（来源：**液体百科 Liquipedia**，作为 HLTV 缺图时的兜底，见下）
4. 抓取每名选手的准星、DPI/灵敏度/回报率/Windows 灵敏度、
   分辨率与画质设置、显示器参数、鼠标键盘外设参数、Viewmodel、雷达 HUD
5. 同步官方比赛检测的历史准星记录
6. 原子写入 `js/players.js`（含 `PRO_META` 数据版本）
7. **改写 `index.html` 的资源版本号**，强制浏览器加载新数据
8. 同步刷新 `cs2-crosshair/` 静态发布包
9. 输出变更报告 **tools/update-report.md**（新增/离队选手、准星变动明细）

抓取到的原始页面缓存在 `tools/cache/`，可以随时删除以强制重新抓取。

### 队标与图标来源：HLTV.org（兜底：液体百科）

选手准星页用到的**队标、阵容头像、国家级/地区旗**全部来自 **HLTV.org**，
由 `tools/hltv-sync.js` 在页面上下文里按 CDN 签名取回，落到 `assets/hltv/`：

| 目录 | 内容 | 尺寸 |
| ---- | ---- | ---- |
| `assets/hltv/teams/` | 队标 `day` / `night` 两套（31 队里 8 队有独立 night 版，其余 night 与 day 同名；**深色主题优先渲染 night 版**，不加光晕） | 100×100 PNG 或自包含 SVG |
| `assets/hltv/players/` | 现役阵容头像（按 `队伍key-选手id` 命名） | 100×100 PNG |
| `assets/hltv/flags/` | 国旗 / 地区旗（欧洲、南美等 HLTV 自定义旗也在此） | 30×20 GIF |

图标的回落顺序（前端 `teamLogo()` / `hltvFlag()`）：

1. **HLTV 队标**（`HLTV_TEAMS[k].logo.day`）—— 要求扩展名是 png/svg/webp/jpg；
   HLTV 对已停更的队页会返回一张 `.bin` 的灰色盾牌占位图，这种情况**不采用**；
   为什么不用 `logo.night`：实测 night 变体并非都变亮（FaZe night 平均亮度仅 70、MIBR 仅 54，
   而 MIBR night 接近纯白、放到浅色底板上反而会消失），所以统一用 day + 底板（`logoPlate()`）更稳；
2. 回落**本地液体百科队标** `assets/teams/<k>.png`（128×128 透明 PNG，见下）；
3. 国旗缺图（例如个别国家 HLTV 没有 30×20 版本）时回落 **emoji 旗帜**，不留空图框。

服务端需要能正确返回这些类型：`server.js` 的 MIME 表已补 `.gif`（国旗），`.svg` 原本就有。

#### 液体百科队标（`assets/teams/`，仅作兜底与旧数据兼容）

`assets/teams/` 里的 128×128 PNG 仍由液体百科（`https://liquipedia.net/counterstrike/`）生成，
现在只在 HLTV 队标缺失/无效时使用（当前只有 3DMAX 会走到这条路径）。单独刷新：

```
node tools/liquipedia-logos.js --force          # 31 支主队
node tools/liquipedia-extra-logos.js --force    # 14 支后备队
```

选图规则（三者叠加，缺一不可）：

| 维度 | 判据 | 为什么 |
|---|---|---|
| 形状 | 裁掉透明边后，内容比例 ≤ `1.45` | 液体百科常见「方形队徽」与「full 横条字标」同名不同缀，字标塞进 44px 方框会缩成一条 |
| 可见度 | 按站点背景 `#08080a` alpha 合成后，平均通道差 ≥ `45` | 同一队徽有 lightmode（深墨）与 darkmode（浅墨）两版，深墨在深色主题上会隐形 |
| 语义 | 排除愚人节、Brawl 联动、选手照、分部标、青训/女队 | 干扰项文件名都有规律，`isJunk()` 先过滤掉 |

输出统一为 **128×128 透明底 PNG**，居中放置、去白底、裁边。

> 液体百科有硬性限速：接口 ≥2 秒/次。全量跑 31 队约 4–6 分钟。
> 有个别队伍站点上确实没有方形干净队徽（如 paiN、NRG、FUT），会退回「形状 × 可见度」综合分最高的那张并打印提示。


---

### 导入提示条的两档口径

页面只有一个导入入口：把分享码 / 控制台命令 / cfg 文本粘进「导入」框。提示条按来源分两种口径，不会混淆：

| 提示标签 | 来源 | 数值处理 |
| --- | --- | --- |
| **兼容提示** | 手贴新系统命令 / cfg | **原样采用**，零换算；旧残留照旧列出 |
| **旧格式码** | `CSGO-` 旧码 / 旧版命令 | 游戏已不接受，按官方像素公式**近似换算**，必须标注 |

> 「读取本机准星」功能已于 2026-10-27 下线：浏览器无法直接读本地文件，需要 `server.js` 额外开一个只读接口，
> 与「纯静态、零网络请求」的定位冲突，因此整块移除（`server.js` 现在只发静态文件）。
> 想从本机存档复刻，用 `node tools/local-crosshair.js` 在命令行读出来再把文本粘进导入框即可。

---

## 四、让别人也能访问

### 方案 A：局域网（最快，免费）

1. 以管理员身份执行一次（放行 TCP 3800）：
   `netsh advfirewall firewall add rule name="CS2Crosshair 3800" dir=in action=allow protocol=TCP localport=3800`
2. 命令行运行 `ipconfig`，找到 "IPv4 地址"（如 192.168.2.211）
3. 对方访问 **http://192.168.2.211:3800**（需连同一个 WiFi / 路由器）

### 方案 B：内网穿透（公网访问，无需服务器）

推荐 [cpolar](https://www.cpolar.com)：

```
cpolar http 3800
```

终端会给出公网地址（如 `https://xxxx.cpolar.top`）。备选：natapp、花生壳。

### 方案 C：静态托管（永久免费，无需开你的电脑）

项目是纯静态站点，可直接托管到 **GitHub Pages** 或 **Vercel**。

```
node tools/build-dist.js     # 把 index.html / css / js / assets 同步到 cs2-crosshair/
```

把 `cs2-crosshair/` 里的文件（或自行压缩后的 zip）上传即可。

> 静态托管下没有 `server.js`，纯静态页面即可完整使用生成器与准星库。
> 注意：静态包里的 `js/players.js` 与 `js/hltv-teams.js` 都是**构建那一刻的快照**，要更新数据请在本机跑
> `node tools/auto-update.js`（准星）与 `node tools/hltv-sync.js`（战队档案）后重新
> `node tools/build-dist.js`（见第三节）。

### 方案 D：云服务器（最稳定）

轻量云服务器上传项目后 `node server.js`，安全组放行 3800 端口即可。建议配 PM2 常驻。

---

## 五、目录结构

```
.
|- index.html               页面结构
|- css/style.css            设计系统（17 个分节：令牌 / 基础 / 顶栏 / 布局 / 按钮 / 面板 / 预览 / 参数 / 分享 / 选手库 / 弹窗 / 悬浮件 / 滚动条 / 响应式 / 触控目标 / 降低动效 / 高对比与强制色）
|- js/core-alphabet.js      Base57 容器：码 <-> 字节 <-> 大整数、校验和
|- js/core-layouts.js       四种分享码布局的声明式字节表 + 位域读写引擎
|- js/core-codec.js         新像素模型（CrosshairV2）+ cs2-v1 读写
|- js/core-legacy.js        legacy-v1 / v3 / v4 读写（仅供导入与对拍）
|- js/core-convert.js       旧刻度 -> 新像素（单向，含近似标注）
|- js/core-convars.js       新 convar 双向映射 + 512 字符分段
|- js/render-model.js       新像素度量 + 10 样式行为表
|- js/render-canvas.js      Canvas 像素吸附渲染 + canonical PNG 导出
|- js/codec.js              兼容门面：合成 window.CS2Crosshair
|- js/players.js            选手准星数据（自动生成，勿手改）
|- js/hltv-teams.js         战队档案快照（HLTV 生成，勿手改）
|- js/app.js                页面逻辑（生成器 + 准星库 + 战队详情卡，不含几何计算）
|- assets/                  地图背景图 + 战队队标（assets/teams 液体百科兜底）
|- assets/hltv/             HLTV 素材：teams/ 队标 · players/ 阵容头像 · flags/ 国旗
|- server.js                极简静态文件服务器（无任何后端接口）
|- tools/
|  |- auto-update.js        准星数据更新 CLI（含 EXCLUDED_TEAMS 排除名单）
|  |- hltv-sync.js          HLTV 战队档案抓取（CDP 驱动有头 Edge 过 Cloudflare）
|  |- cdp-client.js         极简 CDP 客户端（connect / ev / nav，零依赖）
|  |- hltv-teams.json       HLTV 战队 id 与顺序配置
|  |- prosettings-parse.js  选手页字段解析（与新鲜度测试共用）
|  |- liquipedia-logos.js   队标爬取器：液体百科取图 + 自写 PNG 解码/缩放/去白底（零依赖）
|  |- liquipedia-extra-logos.js  后备 14 支队伍的队标（同上管线，页面名映射在此）
|  |- local-crosshair.js    本机 CS2 准星读取 CLI（找 Steam 账号 → 读 vcfg → 打印 convar 原文；不再被 server.js 引用）
|  |- build-dist.js         静态发布包构建 → cs2-crosshair/
|  |- teams.json            战队跟踪配置（自动维护，可手动编辑）
|  |- update-report.md      最近一次更新报告
|  |- lab-report.md         实机参数比对报告
|  |- cache/                抓取缓存（可删）
|  |- logs/                 更新日志
|- test/
|  |- run-all.js            一次跑全部套件
|  |- vectors-check.js      离线向量（494 条 cs2 + 751 条 legacy）完整性
|  |- check-codec.js        四种分享码布局的编解码对拍
|  |- check-paste.js        控制台命令 / 量程 / 旧 convar 断言
|  |- check-scraper.js      抓取器闸门（禁止按旧刻度写建数据）
|  |- verify.js             三层证据：迁移度量 / 与官方渲染器逐像素对拍 / 官方矩形回归
|  |- check-render-invariance.js  渲染与窗口尺寸、DPR 无关
|  |- check-dom.js          页面元素、脚本顺序与资源版本号
|  |- check-page.js         jsdom 整页回归（含预览、逐句命令、弹窗历史）
|  |- check-freshness.js    线上数据抽样比对（需联网）
|  |- cdp-shot.js           截图脚本（支持 CDP_PORT 环境变量，默认 9222）
|  |- shots-run.js          批量截图（14 个场景，含战队详情卡与 980 / 1180 / 移动端断点）
|  |- lib/rasterize.js      共享光栅化（供 verify 与不变性测试）
|  |- fixtures/             冻结的真实数据快照（vcfg 等）
|  |- lab/                  实机只读采集与比对脚本
|- REFACTOR.md              本次重构的调整说明
|- 一键启动.bat
```

---

## 六、自检

```
node test/run-all.js          # 一次跑全部 8 个离线套件（推荐）
```

单独跑某一项：

```
node test/vectors-check.js          # 离线向量完整性（494 条 cs2 + 751 条 legacy）
node test/check-codec.js            # 四布局编解码，与官方实现双向 100% 一致
node test/check-paste.js            # 一次性粘贴、≤512、无旧 convar、值在量程内
node test/check-scraper.js          # 抓取器闸门：不许按旧刻度写建 players.js
node test/verify.js                 # 迁移度量 / 与官方渲染器逐像素对拍 / 官方矩形回归
node test/check-render-invariance.js # 渲染与窗口尺寸、DPR 无关
node test/check-dom.js              # 页面元素 / 脚本引用 / 资源版本号是否对齐
node test/check-page.js             # jsdom 载入整页：逐句命令、导入、预览、弹窗历史、准星库规则
node test/check-freshness.js        # 抽样对比 prosettings 线上数据（需联网）
```

> `test/check-dom.js` 与 `test/check-page.js` 都会校验脚本加载顺序，
> 新增 `js/hltv-teams.js` 后两处的顺序数组已同步更新（插在 `players.js` 之后、`app.js` 之前）。

> 本机若没有全局 node，把上面的 `node` 换成 `"D:\software\Node\node.exe"`。
> 当前 `test/run-all.js` 的 8 个套件全部通过。

---

## 七、常见问题

| 现象 | 处理 |
| ---- | ---- |
| 控制台提示 **Command too long... ignoring!** | 点 **⧉ 复制命令**（它复制的是自动合并好的单行分号版）；完整 .cfg 只用于存文件 + `exec` 加载。**不要**手动全选多行文本区去复制 |
| 命令一次粘贴没生效 | 极端配置（style 2 + 描边 + 自定义分裂参数）会超过 512 字符，界面会切成 2 段并提示，按顺序粘贴即可 |
| 选手准星的复制按钮是灰的 | 该选手指的是**旧 `CSGO-` 格式**，游戏已拒绝导入；只能保存预览图。原因在按钮旁有说明 |
| 更新完了页面还是旧数据 | 更新后会自动改写资源版本号，强制刷新（Ctrl+F5）；静态托管需重新上传 `cs2-crosshair/` |
| 滚动后看不到预览 | 首页已改成「预览置顶」：宽屏下整页一屏装下，不需要滚动；≤1100px 才变单列，预览仍排在最前面。若仍需滚动，检查浏览器缩放是否过大 |
| 预览里准星太小 / 看不清 | 预览固定 **1:1 原生像素**（等同游戏内实际像素大小），没有放大档位。想看清整屏构图请点「保存预览图」，它按几何 × 倍率导出 PNG；想放大细节用系统缩放（Ctrl + 滚轮） |
| 控制台命令框里为什么是一行一条 | 那是给人核对的展示格式；复制按钮会自动合并成单行分号版。文本框固定高度、超出可滚动，不再自动撑高（否则会把同排预览一起拉高） |
| 动态样式为什么不动 | 点「动态预览」自动循环，或直接**按住预览画面**模拟连发；静态样式（3/4/6/8/9）在游戏内开火也不会变化，因此禁用 |
| 更新很慢 | 全量更新约 3–8 分钟；想快就用 `--cache` |
| 更新报网络错误 | 脚本会自动重试 3 次并回退到本地缓存；也可稍后重跑 |
| 想增删跟踪的战队 | 编辑 `tools/teams.json` 的 `teams` 数组，或调整 `autoAddMinPlayers` |
| 想从本机 CS2 存档复刻准星 | 页面已不提供该按钮。命令行跑 `node tools/local-crosshair.js`，把打印出来的 convar 文本粘进页面的「导入」框即可（与手动粘贴走同一条解析路径） |
| `local-crosshair.js` 报「没有准星配置文件」 | 该 Steam 账号没在 CS2 里改过准星、或配置还没落盘。进游戏改一次再退出，让客户端写 `cs2_user_convars_0_slot0.vcfg` |
| 某个队标看着还是横条 | 只在回落到液体百科兜底图时才可能发生（当前是 paiN / NRG / FUT）。脚本会打印提示，可手工换图或改 `tools/liquipedia-extra-logos.js` 的页面名映射 |
| 战队详情卡显示「HLTV 暂无现役阵容记录」 | 该队在 HLTV 上的队页已停更（当前是 3DMAX，HLTV 只剩 2015 年的老页）。卡片会给出空态并回落本地队标，不影响选手准星数据 |
| 战队数据和准星数据对不上 | 属正常：战队档案来自 HLTV.org，准星来自 prosettings.net，两边阵容更新节奏不同。卡片上的「HLTV 现役」标只按昵称精确匹配，匹配不到就不显示 |
| `hltv-sync.js` 报 403 / Cloudflare | 必须用**有头** Edge（headless 会被拦）。按第三节的命令启动 9223 端口的浏览器，等它能正常打开 hltv.org 再跑脚本 |
| 国旗显示成 emoji | HLTV 只有 30×20 一种国旗尺寸，个别国家缺图时前端回落 emoji，属预期行为 |
| 队标抓取好慢 | 液体百科硬性限速 ≥2 秒/次接口，31 队约 4–6 分钟。用 `--only=navi,faze` 只刷新个别队 |
| 局域网别人打不开 | 按第四节方案 A 用管理员执行一次 `netsh advfirewall` 放行 TCP 3800；确认双方同一网络 |
| 电脑重启后地址变了 | 局域网 IP 可能变化，重新 `ipconfig` 查看 |
