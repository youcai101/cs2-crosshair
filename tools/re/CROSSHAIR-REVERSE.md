# CS2 准星绘制系统 · 完整逆向分析

对象：`game/csgo/bin/win64/client.dll`（2026-10-21 20:12 构建，ImageBase `0x180000000`）
方法：PE 解析（pefile）+ Capstone 反汇编（`tools/re/cs2_scan.py`、`.preview/re/fn_dump.py`）+ 设置页预览 1:1 像素实测 + 游戏内脚本（`settingsmenu_crosshair.vts_c`）交叉验证。

> 本文所有 RVA 都是 **ImageBase 之后的相对地址**；实际虚拟地址 = `0x180000000 + RVA`。
> 行内 `0x1xxxxxx` 形式的地址是 rip-relative 常量池（`.rdata`），括注的是该常量的 float 值。

---

## 0. 一句话结论

CS2 的准星不是「用参数拼矩形」，而是：

**每一帧把「长度 / 散布上限 / 粗细」这三个归一化方向向量，沿玩家当前朝向按散布分数做 3D 外推，投影到屏幕、取半像素对齐后的欧氏距离，得到唯一的基准半径 `R`；再用 `R` 与 `spread_limit` 做一次软夹取得到 `clampR`；最后按 style 把 `clampR`、`gap`、`thickness`、`length` 喂给 6 个绘制原语（RECT / ARMS / RING / ARC / ARC_OUT / SQUARE）之一。**

动态效果有几个反直觉的硬约束：

1. **散布分数 `s` 是「距上次开枪的时间 / 0.2 秒」的斜坡**，`t = 1 - s`。`t = 0` 时整把准星**一帧都不画**（不是缩到最小）。
2. **alpha 与半径共用同一个 `t`**：颜色 alpha 直接乘 `t`；全局 alpha 由视口三元组 `+0x50 + +0x4c` 与 `0.25` 的关系插值。
3. **动态样式的基准半径被 `clampR` 夹在 `[lo, spread_limit+64]`**，`lo` 由「中心点开关」决定而不是描边开关。
4. **只有 0/1/2/7 是动态样式**；3/4/5/6/8/9 全部静态，半径只吃 `gap`（style5 例外，吃一个屏幕高归一化的开火累积量）。

---

## 1. 调用链与数据流

```
HUD 帧（0x11dfc1f）
  └─ 0x11d3100  HUD 准星入口      ← 组参数缓冲 CrosshairParamBuffer_t
       └─ 0x180d9bc70  DrawState::Init   （清零 + 填默认值）
            └─ 0x180da0610  CrosshairDrawState::Draw   ← 主角
                 ├─ 0x180da63f0  ARMS      四臂（内部 4 次 RECT）
                 ├─ 0x180da6290  RING      圆环（type 1/2）
                 ├─ 0x180da61c0  ARC       弧（type=2 填充）
                 ├─ 0x180da6080  ARC_OUT   描边弧（type=1）
                 ├─ 0x180da7510  SQUARE    中心方块
                 ├─ 0x180da8410  RECT      矩形（type=0）
                 └─ 0x180da7640  TICK      刻度线（仅 weapon_debug_spread_show）

设置页预览专用入口
  0x180db8e80  EnqueuePreviewDrawCommand
    └─ 同上进入 0x180da0610（额外带 [0x25c8530]+0x58 预览标志）
```

### 1.1 参数缓冲 `CrosshairParamBuffer_t`（`rbp-0x68`，由 0x11d3100 组装）

| 偏移 | 内容 |
|---|---|
| `+0x00` | 中心 X = `round([rbx+4] + [rbx+0xc] * 0.5)` |
| `+0x04` | 中心 Y = `round([rbx+8] + [rbx+0x10] * 0.5)` |
| `+0x08` | `GetScreenHeight() / 1080`（分辨率系数，`0x1accaa0 = 1080`） |
| `+0x0c` | 标志字节：`weapon_debug_spread_show` 时画调试散布框 |
| `+0x0d` | 0（`+0x5c`） |
| `+0x0e` | 1（`+0x5d`） |

`0xda0610` 开头把它们拷进绘制状态：`[rbx]→+0x40`、`[rbx+4]→+0x44`、`[rbx+8]→+0x58`、`[rbx+0xd]→+0x5c`、`[rbx+0xe]→+0x5d`。

> ⚠️ **`+0x58` 不是散布量**，而是 `screenHeight / 1080`。它只在 `weapon_debug_spread_show` 调试框里乘 28（`0x1c15bf4 = 28`）变成像素半径。早先把 `+0x58` 当散布基数是错的。

### 1.2 `DrawState::Init`（0x180d9bc70）写入的默认值

清零 `+0x10..+0x3c`、`+0x40`、`+0x48`、`+0x50`、`+0x60`、`+0x68`、`+0x6c`、`+0x70`(word)、`+0x74`、`+0x7c`、`+0x84`、`+0x8c`、`+0x94`、`+0x9c`、`+0xa8`、`+0xb0`，然后：

```
+0x54 = 90.0    (0x42b40000)     视场角，度
+0x58 = 1.0
+0x5c = 0x0100                   （+0x5c=0, +0x5d=1 两字节）
+0xa0 = 1.0
+0xb8 = 1.0                      全局 alpha
```

---

## 2. 绘制状态结构体（rdi 偏移，全部实读）

| 偏移 | 类型 | 含义 | 来源 |
|---|---|---|---|
| `+0x10 / +0x14 / +0x18` | f32×3 | 视点偏移 offset3 | 0x18093c760 深拷贝 |
| `+0x1c / +0x20 / +0x24` | f32×3 | **length / spread_limit / thickness** 的 3D 基线 | 同上 |
| `+0x28 / +0x2c / +0x30` | f32×3 | 朝向前方单位向量 | 0x181742af0 建基 |
| `+0x34 / +0x38 / +0x3c` | f32×3 | 右 / 上单位向量 | 同上 |
| `+0x40 / +0x44` | f32 | 中心 X / Y（屏幕像素，可为负） | 参数缓冲 |
| `+0x48 / +0x4c / +0x50` | f32 | 视口三元组（0x180c7be40）：武器 FOV 相关 / `[rbx+0x1a18]` / vtable+0xbd0 | — |
| `+0x54` | f32 | 视场角（默认 90.0） | vtable+0x118 |
| `+0x58` | f32 | `screenHeight / 1080` | 参数缓冲 |
| `+0x5c / +0x5d` | u8 | 开镜 / 开镜点 | 参数缓冲 |
| `+0x64` | i32 | **style**（0..9） | ConVar |
| `+0x68` | u8 | **recoil**（准星跟随预测弹道） | ConVar |
| `+0x6c` | i32 | **drawoutline**：0 无 / 1 全 / 2 半 | ConVar |
| `+0x70` | u8 | **dot**（中心点） | ConVar |
| `+0x71` | u8 | **T 型**（隐藏上臂） | ConVar |
| `+0x74` | f32 | **gap** | ConVar |
| `+0x78` | f32 | **thickness** | ConVar |
| `+0x7c` | f32 | **length** | ConVar |
| `+0x80` | f32 | **dynamic_spread_limit** | ConVar |
| `+0x84` | RGBA | 准星颜色 | ConVar×4 |
| `+0x88` | RGBA | 描边颜色 | ConVar×4 |
| `+0x8c` | f32 | splitdist（style2 内臂上限） | ConVar |
| `+0x90` | f32 | splitalpha_innermod | ConVar |
| `+0x94` | f32 | splitalpha_outermod | ConVar |
| `+0x98` | f32 | maxdist_splitratio（style2 分割比 / style9 旋转） | ConVar |
| `+0x9c` | u8 | 未定名开关 | ConVar |
| `+0xa0` | f32 | scope dot scale | ConVar |
| `+0xa4 / +0xa8` | f32 | 中心 X / Y（取 `fabs`，可能被 recoil 覆盖） | 计算 |
| `+0xac` | f32 | 第二半径（仅 style7 的描边判定） | 计算 |
| `+0xb0` | f32 | **半径 R**（3D 投影距离） | 计算 |
| `+0xb4` | f32 | **clampR**（动态样式实际用的基准半径） | 计算 |
| `+0xb8` | f32 | 全局 alpha 缩放（1.0 → 0.2） | 计算 |
| `+0xbc` | f32 | 散布分数 s（0..1） | 计算 |

---

## 3. ConVar ↔ 设置结构（0xdb0230 读 / 0xdbafb0 写回）

设置结构字段序（`0xdb0230` 读入，`0xdbafb0` 按同序反写）：

| 结构偏移 | 字段 | ConVar 对象（ImageBase 后） |
|---|---|---|
| `+0x00` | screen_height | `0x25c84e8` |
| `+0x04` | style（clamp 0..9） | `0x25c8538` |
| `+0x08` | recoil | `0x25c8548` |
| `+0x0c` | drawoutline（clamp 0..2） | `0x25c8558/0x25c8568` |
| `+0x10` | dot | `0x25c8560` |
| `+0x11` | T 型 | `0x25c8578` |
| `+0x14` | gap | `0x25c8588` |
| `+0x18` | thickness | `0x25c85a8` |
| `+0x1c` | length | `0x25c8598` |
| `+0x20` | dynamic_spread_limit | `0x25c85b8` |
| `+0x24..0x27` | color r/g/b/a | `0x25c85c8/d8/e8/f8` |
| `+0x28..0x2b` | outline r/g/b/a | `0x25c8608/18/28/38` |
| `+0x2c` | splitdist | `0x25c8648` |
| `+0x30` | splitalpha_innermod | `0x25c8658` |
| `+0x34` | splitalpha_outermod | `0x25c8668` |
| `+0x38` | maxdist_splitratio | `0x25c8678` |
| `+0x3c` | 未定名（u8） | `0x25c86e8` |
| `+0x40` | scope dot scale | `0x25c86f8` |

整数型 ConVar 用 `cvtdq2ps` 转 float（gap/thickness/length/spread_limit），颜色四分量各自 clamp 到 0..255。

### 3.1 ConVar 帮助文本（从 `.rdata` 0x1cb4000–0x1cb4ca0 读出，等于官方语义）

| ConVar | 帮助文本要点 |
|---|---|
| `cl_crosshair_screen_height` | 「用户定义尺寸时所处的分辨率」→ 所有尺寸按 `screenHeight / 该值` 缩放 |
| `cl_crosshair_gap` | 「加在准星中心与四条臂之间空隙上的偏移」 |
| `cl_crosshair_length` | 「随屏幕分辨率缩放」 |
| `cl_crosshair_thickness` | 「随屏幕分辨率缩放（**最小 1 像素**）」 |
| `cl_crosshair_dynamic_spread_limit` | 「动态元素在 **128 像素基线**之外允许额外扩散的距离」 |
| `cl_crosshair_drawoutline` | `0 = 无描边 / 1 = 全描边 / 2 = 半描边` |
| `cl_crosshair_t` | 「隐藏上臂」 |
| `cl_crosshair_recoil` | 「准星跟随武器的预测后坐力（aim punch）」 |
| `cl_crosshair_splitalpha_innermod` | `[0,1]` |
| `cl_crosshair_splitalpha_outermod` | `[0.3,1]` |
| `cl_crosshair_dynamic_maxdist_splitratio` | 「inner = size*(1-ratio), outer = size*ratio」 |
| `cl_crosshairstyle` | `0 动态十字 / 1 动态圆 / 2 动态十字(经典) / 3 静态圆 / 4 静态十字 / 5 静态十字(开火反馈) / 6 仅中心点 / 7 动态四分 / 8 静态方框 / 9 静态四分` |

---

## 4. 公共前奏：时间 → t → alpha → 半径 → clampR

### 4.1 散布分数（0xda08b8 – 0xda098d）

```
if (武器类型(0x180d568d0) == 3 || == 4)  r15b = 1        // 狙击/刀：跳过散布
t0 = 0.2                                       [0x1acaf20]
if ([rdi+8] 存的 float == 0)  [rdi+8] = Plat_FloatTime()
s = ease(clamp((Plat_FloatTime() - [rdi+8]) / 0.2, 0, 1))  →  [rdi+0xbc]
call 0xda7770                                  // ⚠️ 只画 weapon_debug_spread_show 的调试散布圈，不写 DrawState
if (查询武器精度失败 || 无玩家) { [rdi+8] = 0; [rdi+0xbc] = 0; }

if ([0x25c8500]+0x58 != 0)  t = 1.0            // 强制静态
else                        t = max(0, 1 - s)
if (t <= 0)  → 0xda103c                        // 整帧不画
```

`ease` 不是线性 clamp，而是 `0x18173d3d0`：

```
u = clamp(x, 0, 1)
k = clamp(scale, 1.17549e-38, 1)          // scale = 0.2
return u / (u * (1/k - 2) + (1 - 1/k) * 0 + 1)   // 即 u / (1 + (1/k - 2)(1 - u))
```

> 即 **开火后 200ms 内 s 从 0 平滑升到 1**，实践中是「开火瞬间 `t≈1`，200ms 后 `t≈0`」的一条 ease-out 曲线。

#### 4.1.1 `0xda7770` 到底是什么（勘误）

早先把这行写成「由 s 更新 3D 基线方向」是**错的**。逐条读完 700 条反汇编后确认：

- 函数体对 `rsi`（DrawState）**只有读、没有任何写**（26 处 `[rsi+..]` 全是 `movss/movsd/mov` 取值，无 `→ [rsi+..]` 的写入）。
- 它做的事：从**基线向量** `{length, spread_limit, thickness}`（`[+0x1c]/[+0x20]/[+0x24]`）出发，沿圆弧采样出 N 个点（每点用四元数再转 10°），投影到屏幕后在每个采样位置画小方块标记（循环体 `0xda7f90`–`0xda8150`，每次 2 个 `RECT`：`0xda7fee` 竖直方向、`0xda80bc` 水平方向）；再用另一根基向量（`[+0x28..+0x30]`）转出 `floor([+0x54]×0.5/10)=4` 个点叠一组十字刻度（`TICK`，`0xda805a` / `0xda812b` / `0xda826e`）。**这些命令每帧都会写进准星命令缓冲**，但方块颜色取 `[rbp+0xb0]` 那个 dword（`0xda7e95`），其最高字节 alpha 已被 `round(colorA × s)` 覆写（`0xda787d` 乘 s → `0xda7885 V_roundf` → `0xda789c mov [rbp+0xb3], al`），`s` = 散布分数，所以静息时 alpha≈0 看不见、开枪/移动时才浮现 —— 这正是 `weapon_debug_spread_show` 的观感。描边色固定传 `[1cb5e98] = 0`（`0xda7ecd` → `[rsp+0x30]`），即调试方块无描边。
- 唯一被全局字节 `[0x25c8520] + 0x58` 直接门控的是 `TICK`（`0xda7ff3 test r15b,r15b; je 0x180da805f`），采样方块不受它管。
- 半径 `[rdi+0xb0]` 与此函数无关，由 §4.3 的 `0x180d9e560` 在 Draw 前奏里单独算。

采样点数（`0xda788f`–`0xda7a3d`，逐条核对过）：

```
hfovRad = [rsi+0x54] * π/360            // 默认 90 → 0.7853982 (= 45°)，即半 FOV 的弧度
rad     = atan(tan(hfovRad) * viewScale) // V_tanf → vtable+0x88 取的视图比例 → V_atanf；viewScale=1 时 = 45°
degX2   = rad * 114.591552734375        // [1ac609c] = 360/π = f32 0x42e52ee0 → 弧度×180/π×2
N       = floor(degX2 * 0.5 / 10)       // ×0.5 得半 FOV 度数，÷10 取步长
```

代入默认值：`tan(45°)=1 → atan(1)=45° → ×114.5916 = 90 → ×0.5 = 45 → ÷10 = 4.5 → N = 4`。

**所以 `114.592` 就是 `360/π`**（不是校准魔数），先前的写法没错；它做的是「弧度 → 度数」并顺手把半 FOV 乘成整 FOV。

真正该记住的是 **`N = floor(半FOV度数 / 10)`**：默认 FOV 90° → `N = 4`。

循环 `0xda7a70`–`0xda7c17` 跑 `N` 次：每轮读回上一轮的向量（`[rbp-0x70]` / `[rbp-0x68]` 先读后用，`0xda7ad9` / `0xda7af7` 写回），用四元数把它绕视线轴再转 **10°**，投影后写一条 12 字节（`x,y,z` 各 float）进 `UtlVector`（`0x1aad808` / `0x1aad810` = `UtlVectorMemory_Alloc` / `_CalcNewAllocationCount`）。

四元数是**半角**构造的（`0xda7940`–`0xda7982`）：`xmm9 = [1cbbc64] = 0.0872665 rad = 5°`，`V_sincosf` 出 `sin=5°`/`cos=5°`；`0xda797f mulps xmm6, xmm2`（向量 × sin）与 `0xda7982 insertps xmm6, [rsp+0x4c], 0x30`（cos 进最高 lane）拼成 `(v·sinθ/2, cosθ/2)` —— 所以**实际步进是 10°**（θ/2 = 5°）。这与 `N = floor(半FOV/10)` 自洽：默认半 FOV 45° → `N = 4`，4×10° = 40° 覆盖到接近边缘。

> 一句话：**`114.592` 没错，它是 `360/π`，不是魔数。** 采样点数 = `floor(半FOV / 10)`（默认 FOV 90° → `N = 4`），每点转 10°（常量 `[1cbbc64] = 0.0872665` 是**半角** 5°）。

另有一处 `floor([rsi+0x54] × 0.5 / 10) = floor(90×0.5/10) = 4`（`0xda7c37`）决定十字**刻度线条数**，虽然数值也是 4，但这条路径不看 `viewScale`，与采样点数无关。

### 4.2 颜色 alpha（0xda0a48 起）

```
[rdi+0x87] (color.a)   = truncate([rdi+0x87] * t)
[rdi+0x8b] (outline.a) = truncate([rdi+0x8b] * t)
[rdi+0xb0] = 0 ; [rdi+0xb4] = 0 ; [rdi+0xb8] = 1.0
```

### 4.3 半径 R（0xda0b1d – 0xda0b8c）

**门控（0xda0ab1 – 0xda0ac6，实测）**：

```
r15b = ([0x25c8530] + 0x58)          // 预览标志
if (r15b != 0)              goto COMPUTE      // 预览里所有样式都算半径
if ([rdi+0x64] style <= 1)  goto COMPUTE      // style 0 / 1
if ([rdi+0x64] style != 7)  goto 0xda0c91     // style 2..6, 8, 9 不算
COMPUTE:
```

> ⚠️ **只有 style 0 / 1 / 7 会算 3D 投影半径**（外加设置页预览这一整支）。style 2/5 的间距来自 `gapUnit`/开火累积，style 3/4/8/9 直接用 `gap`。早先以为「2..7 都算」是错的。

```
开镜微动：if (+0x5c && +0x5d)  xmm6 = |sin(Plat_FloatTime())| * 0.1     [0x1ada28c = 0.1]

R = 0x180d9e560(ctx, t)
  ctx = {
    anchor  : 屏幕中心（+0x40/+0x44 的 f64 版本）
    offset3 : (+0x10, +0x14, +0x18)
    base3   : (length*2000 + off, spread_limit*2000 + off, thickness*2000 + off)   // 2000 = 0x1ba7c48
    dir3    : 朝向基（+0x28/+0x2c/+0x30），d = +0x30
  }
[rdi+0xb0] = R

style7 额外再算一次：ctx.base 用 (+0x50 + +0x4c) 替换 spread_limit 分量 → [rdi+0xac]
```

`0x180d9e560` 本体（112 条，实读）：

```
v.x = base3.x - dir3.x * t
v.y = base3.y - dir3.y * t
v.z = base3.z - d      * t
len = sqrt(v·v)
if (len ∈ [1e-17, 1e17]) v *= 1/len
else                    v = (0,0,0) 或走异常分支 0x181743d60
p = project(v * 2000 + offset3)        // 0x180c19db0 矩阵变换
p = halfPixelAlign(p)                  // 0x180da17d0: (v + 1) * 0.5 * renderScale
return |p - anchor|                    // 0x181a08ed4 sqrt
```

**这就是「动态半径」的真实算法**：一个透视投影后的屏幕欧氏距离，不是 `gap + 常量 × 散布`。

#### 4.3.1 换算成像素：`R = focal(H) × t`（v4 落地公式）

`0x180d9e560` 的两个点都在 2000 单位的球面上，屏幕上量到的就是「同一焦点下两条视线
在 2000 处相差 t·2000」的投影长度，所以是一个纯角度量：

```
R_px      = focal_px × tan(θ) ≈ focal_px × t        // t ≪ 1
focal_px  = (H / 2) / tan(vfov / 2)
```

CS2 沿用 hfov = 90° @4:3 的 hor+ 约定 ⇒ 16:9 的垂直 FOV = 2·atan(tan45° × 9/16) = 73.74°，
`focal = (H/2)/tan(36.87°) = 2H/3`（1080p = 720px；4:3 屏退化成 H/2）。
设置页预览把 t 覆盖成 `|sin(Plat_FloatTime())| × 0.1`，于是 **预览满散布半径 = 0.1 × 2H/3 = H/15**
（1080p = 72px），与 §9 `anim-strip.js` 实测的弧环半径曲线 4→73px 一致 —— 早期按
「H/2 半算」得出的 70px 魔术数就是这一步口径错，v4 起改为按 `2H/3 × 0.1` 计算。

> 引擎侧约定：游戏里 `t = A + B`（A 是武器静息精度、B 是开火累积，见 §2 / `0x180c7be40`），
> 预览没有武器上下文，所以引擎用 **gap 等价替换 A（静息基线）、用 env 表达 B**，
> 振幅取设置页预览的 0.1。

### 4.4 clampR（0xda0bc5）

```
hi   = spread_limit + 64                        [0x1ac6094 = 64]
mid  = hi * 0.75                                [0x1b2e078 = 0.75]
lo   = (+0x70 dot ? thickness : 0)              ← 注意是 dot，不是 drawoutline
r    = clampSoft(R, mid, hi)                    // 0x180d9e770
[rdi+0xb4] = min(hi, max(lo, r))
```

`0x180d9e770` 是**指数软夹取**，不是 max：

```
if (xmm2 <= xmm1) return xmm1;                 // 在区间内直接返回
span = xmm3 - xmm2;
t = 1/span;  t = -t * (xmm1 - xmm2);  t = V_expf(t);
return xmm3 - t * span;                        // 超出上界时指数逼近
```

### 4.5 全局 alpha（0xda0c43 – 0xda0c90）

```
s = [+0x50] + [+0x4c]
if (s == 0.25)                 [0x1afeca0]
    [rdi+0xb8] = 1.0
else
    k = clamp((t - s) / (0.25 - s), 0, 1) * 0.8     [0x1ada2ac = 0.8]
    [rdi+0xb8] = 1.0 - k                            // 1.0 → 0.2
```

### 4.6 中心与后坐力（0xda0c91 – 0xda0ddb）

```
[rdi+0xa4] = fabs([rdi+0x40])
[rdi+0xa8] = fabs([rdi+0x44])

if (+0x68 recoil && 有玩家 && !开镜) {
    delta = 0x180853a60([rsi+0x1598], &tmp)        // 预测弹道偏移
    dir   = vtable+0x570(rsi)                       // 视线基
    v     = dir + delta
    v     = normalize(v) * 2000 + offset3
    p     = halfPixelAlign(project(v))
    if (|ceil(p.x) - [+0x40]| > 0)  [rdi+0xa4] = fabs(ceil(p.x))
    if (|ceil(p.y) - [+0x44]| > 0)  [rdi+0xa8] = fabs(ceil(p.y))
}
```

> **recoil 开启时，准星中心被替换成「预测弹道点」的投影**，而且此时 `0xa4/0xa8` 可能不再等于参数缓冲给的屏幕中心。

### 4.7 中心点（0xda0ddb）

```
if (+0x70 dot)  SQUARE(size = +0x78 thickness,
                       color = +0x84,
                       outline = (+0x6c drawoutline ? +0x88 : 0))
```

中心点在任何样式之前画一次；style6 会检测「已经画过」而跳过。

### 4.8 样式分派（0xda0e15）

```
movsxd rax, [rdi+0x64]
cmp eax, 9
ja  default(0xda0fd9)
mov ecx, [rdx + rax*4 + 0xda108c]      // 跳表 RVA 0xda108c，10 个 int32 delta
jmp rdx + rcx
```

| style | 目标 |
|---|---|
| 0 | `0xda0e35`（内联） |
| 1 | `0xda0ee6`（内联） |
| 2 | `0xda66c0` |
| 3 | `0xda6a80` |
| 4 | `0xda6ae0` |
| 5 | `0xda6b60` |
| 6 | `0xda6e30` |
| 7 | `0xda6e60` |
| 8 | `0xda7110` |
| 9 | `0xda7390` |
| >9 | `0xda0fd9`（预览叠加） |

---

## 5. 十个样式的像素级公式

共同输入：`clampR = [0xb4]`、`gap = [0x74]`、`length = [0x7c]`、`thickness = [0x78]`、`t = [0x71]`、`color = [0x84]`、`outline = (+0x6c ? [0x88] : 0)`。

### style 0 — Dynamic Cross
```
ARMS(gap = clampR, length = length, thickness = thickness, t = +0x71)
```
颜色 alpha 再乘 `[0xb8]`（全局 alpha）。没有中心点（除非 dot 开关）。

### style 1 — Dynamic Circle
```
RING(r = clampR, w = thickness)
```

### style 2 — Dynamic Cross (Legacy)
两套 ARMS，内外分裂（0xda66c0 全文实读）：
```
开镜微动：if (+0x5c && +0x5d)  [+0x50] = max(0, sin(Plat_FloatTime()) * 0.15)   [0x1ada290 = 0.15]
          （这一段只在开镜分支里执行）

gapUnit  = ([0x48] + [0x50]) * 320 / ([0x54] * 0.0174533 * 0.5)   [0x1bd3e68 = 320]
splitLim = [0x8c] splitdist
split    = min(gapUnit, splitLim)

innerShift = round(split    * screenH / 480)     [0x1bfde84 = 480]
outerShift = round(gapUnit  * screenH / 480)

if (innerShift > 0) {                            // 0xda67ba
    innerGap = gap + innerShift
    outerGap = gap + outerShift
} else {                                         // 退化支：用武器类型补偿 4 / 8 / 2
    c = 4                                        [0x1ac6088]
    if (!(武器类型 [+0x3f4] & 1))  c = 8         [0x1acaf28]
    else if (武器类型 [+0x3f4] & 2) c = 2        [0x1ac6078]
    ...
}

ratio      = [0x98] maxdist_splitratio
innerLen   = ceil((1 - ratio) * length)          [0x181a09074 = ceil]
outerLen   = floor(length * ratio)

innerAlpha = color.a * [+0x90] innermod          （cvtdq2ps 后 mulss [+0x94] 再截断成字节）
outerAlpha = color.a * [+0x94] outermod

ARMS(gap = innerGap, len = innerLen, ...)        0xda69b4
ARMS(gap = outerGap, len = outerLen, ...)        0xda6a30（xmm2 = xmm13 = 内层 gap，xmm3 = 外层长度）
```
> `gapUnit` 把视口三元组换算成「屏幕上的空隙尺度」，再按 `screenH / 480` 归一化——这就是「经典分裂」在宽屏下的表现来源。
> ⚠️ 两处 ARMS 的 gap/length 组合在反汇编里经过多轮寄存器复用（`xmm6/xmm11/xmm13`），按语义可确定为「内层短臂在小 gap、外层长臂在大 gap」，但精确到哪一次调用对应哪一层，尚未用运行时断点验证。

### style 3 — Static Circle
```
r = max(1.0, gap)      [0x1801b9c30 与 1.0 比较]
w = thickness
RING(r, w)             // 无臂
```

### style 4 — Static Cross
```
ARMS(gap = max(0, gap), length, thickness, t)
```

### style 5 — Static Cross (Shot Feedback)
单套 ARMS + 开火反馈量 `k` 的 gap 补偿（`0xda6b60`，逐条实读）：
```
k_state = [drawState+8]                 // 反馈状态结构体：+0 武器号、+4 k、+8 上次武器号
if ([drawState+0x5c] && [drawState+0x5d]) {          // 设置页预览标志（不是开镜！）
    if (0.4 - frametime >= 0)                        // 0x1af3d1c = 15
        k_state[+4] += 15;                           // 预览里每帧加 15 → 很快顶到上限
}
k_state[+4] = clampf(k_state[+4], 0, 25)   // 0x18015a220 通用 clamp，hi = 0x41c80000 = 25.0
if (k_state[+4] > 0) k_state[+4] -= frametime * 42;  // 0x1cbbc74 = 42 → 每秒衰减 42
k = k_state[+4]
r = roundf(max(0, gap) + screenHeight * k / 1200)    // 0x1c0a240 = 1200
ARMS(r, thickness, length, t)                        // 只调用一次
```
- **开火时 k 的来源**（非预览分支 `0xda6c32..0xda6d07`）：先按武器表字节（`0x2233ed2` / `0x2233f62`，stride 0x1c）判定是否为命中反馈武器，
  再 `[vtable+0xa58]` / `[vtable+0xb80]` 取本次射击计数 `n`，`k += (float)n / 3.5`（`0x1bb6c08 = 3.5`）。
  即 **k = 开火累积量**（每发 +n/3.5），上限 25、每秒衰减 42。
- 只调用**一次** ARMS，与 style2 的两次调用完全不同构；**不吃 `clampR`、不吃 `spread_limit`**
  （设置页不显示 Dynamic Spread Dist）。满量 k=25 时外推 `H·25/1200`：1080p = **+22.5px**、720p = +15px。

### style 6 — Dot Only
```
if (+0x70 dot) return;            // 中心点已在 4.7 画过
SQUARE(thickness)                 // thickness × thickness
```
即：dot 开 → 什么都不画（视觉上就是那个点）；dot 关 → 画一个 thickness² 的方块。

### style 7 — Dynamic Quad ★
```
if ([0xb0] radius <= 0) goto ARMS_ONLY

// 弧的旋转角（16:9 实测落在 45°）
if ([0x4c] == 0.2)  rot = ([0x48] - 0.2 < 0) ? 45 : 5                    [0x1ac6090=45, 0x1acaf24=5]
else                rot = 45 - clamp(([0x48]-[0x4c]) / (0.2-[0x4c]), 0, 1) * 40   [0x1ba2714=40]

hasOutline = (radius < 100) && ([0xac] + 10 >= radius)     [0x1ac6098=100, 0x1ad0f70=10]
halfPx     = (thickness 半像素分配不整除) ? 0.5 : 0         [0x1ac6070=0.5]

if (hasOutline) {
    w = max(1, thickness - 1)
    ARC_OUT(cx - halfPx, cy - halfPx, r = clampR + w, w = w, rot, color, outline)
    // 描边支不再画填充弧
} else {
    ARC(cx - halfPx, cy - halfPx, r = clampR + thickness, w = thickness, rot, color, outline)
}

ARMS_ONLY:
ARMS(gap = max(0, gap), length, thickness, t)
```
- 弧是**单条 ARC 命令**，内部四重对称 → 4 段，每段张角 45°，圆心落在 ±45° 对角方向（轴向留空）。
- 弧和臂**独立门控**：半径 <= 0 时弧不画，但臂照画。
- `hasOutline` 同时要求「半径 < 100」和「第二半径 + 10 >= 半径」，即只有半径较大时才会走描边支。

### style 8 — Static Square
```
if (thickness <= 0) return
half = max(0, gap)
off  = (dot && thickness 半像素不整除) ? -1 : 0
四边矩形：外沿 ±(half + thickness)，内沿 ±half，边厚 thickness
          左/上边各多出 thickness 用来封角
```
是**四条互相重叠的矩形**，不是「四个角块」。

### style 9 — Static Quad
```
rot = clamp([0x98], 0, 1) * 90            [0x1ada300 = 90]
ARC(cx - halfPx, cy - halfPx, r = max(1, gap) + thickness, w = thickness, rot, color, outline)
```
无臂；4 段 90° 弧，中心角在 0°（轴向）↔ 90°（对角）之间由 `maxdist_splitratio` 插值。

### 预览叠加（0xda0fd9，仅设置页预览）
```
if (!r15b) return
ARC(cx = [0xa4], cy = [0xa8], r = [0xb0] + 2, w = 2, rot = 30°,
    color = 0xff32fafa, outline = 0xff000000)
```
画那一圈**青色（`0xff32fafa`）、线宽 2px、旋转 30° 的参考弧**——它只存在于设置页预览，真实游戏里没有。

---

## 6. 绘制原语与像素约定

| 原语 | RVA | 命令 type | 关键约定 |
|---|---|---|---|
| RECT | `0xda8410` | 0 | `x2`/`y2` 各减 1 → **闭区间像素坐标**；色值 `/255` |
| ARC_OUT | `0xda6080` | 1 | 圆心 `-0.5`；角度 `×0.0174533` |
| ARC | `0xda61c0` | 2 | 圆心 `-0.5`；角度 `×0.0174533` |
| RING | `0xda6290` | 1/2 | 内径 `r`、外径 `r + w` |
| ARMS | `0xda63f0` | — | 内部 4 次 RECT |
| SQUARE | `0xda7510` | — | `size × size`，内部仍是 RECT |
| TICK | `0xda7640` | 3 | 调试散布圈的刻度 |

命令环形缓冲：`[state] = ptr`、`[ptr + 0x1008] = count`（上限 `0x40`），每条命令 `0x40` 字节。

### 6.1 ARMS 的四臂几何

```
if (length <= 0 || thickness <= 0) return
gap = max(0, gap)                             [0x1801b9c30]
(n1, n2, even) = allocHalf(thickness)         // 0x180da10c0
xLeft  = floor(cx - gap)
xRight = ceil(cx + gap)
yTop   = floor(cy - gap)
yBot   = ceil(cy + gap)
右臂 RECT(xRight, cy - n1, length, n1 + n2)
左臂 RECT(xLeft - length, cy - n1, length, n1 + n2)
下臂 RECT(cx - n1, yBot, n1 + n2, length)
上臂 RECT(cx - n1, yTop - length, n1 + n2, length)    // t != 0 时跳过
```
奇数厚度补偿：`xmm8 = (n1 == n2 ? 0 : -1)`（`dec ebx; cvtdq2ps`）。

### 6.2 半像素分配器 `0x180da10c0`

```
n = max(1, (int)size)
a = (n + 1) / 2
b = n - a
返回 (a, b) 与 ZF = (a == b)
```
用于奇偶厚度对齐——**这是 1:1 复刻里最容易漏掉的 1px 偏差源**。

---

## 7. 动态变化规则（按触发源）

| 触发 | 表现 | 机制 |
|---|---|---|
| **射击 / 移动 / 跳跃 / 空中** | 准星外扩、变淡，200ms 内收回 | `s = ease(dt/0.2)` → `t = 1-s` → 半径 `R` 与 alpha 同时吃 `t`；`t<=0` 时整帧不画 |
| **命中反馈（style5）** | 四臂额外外推 `screenH*k/1200` | 开火累积量 `k`，`0x1cbbc74 = 42` 衰减 |
| **开镜** | style2/5 有 `sin(Plat_FloatTime())*0.15` / `*0.1` 的微动 | `+0x5c && +0x5d` |
| **后坐力（recoil 开）** | 中心跟随预测弹道 | 预测点投影替换 `+0xa4/+0xa8` |
| **狙击 / 刀（武器类型 3/4）** | 完全静态 | 跳过散布更新，`r15b = 1` |
| **分辨率变化** | 所有尺寸等比缩放 | `screen_height` 基线 + `screenHeight/1080` |
| **`weapon_debug_spread_show`** | 准星外围多出一圈小方块 + 十字刻度 | `0xda7770` 按 `N = floor(半FOV度数/10)`（默认 90° FOV → 4 点，每点绕视线轴 10°）沿圆周采样后投影绘制；**只读 DrawState，不改任何准星参数**（详见 §4.1.1 勘误） |

**关键点：动态样式在 `t → 0` 时不是「缩到最小」，而是「完全不画」。** 这就是为什么游戏里开火瞬间准星看着会「消失一下」。

---

## 8. 1:1 复刻的约束清单（易错点）

1. **所有尺寸先按 `screenHeight / cl_crosshair_screen_height` 缩放**，再取整。默认基线 1080。
2. **thickness 最小 1 像素**（`max(1, round(t * scale))`）。
3. **坐标是闭区间**：RECT 的 `x2/y2` 要减 1；ARC/RING 的圆心要减 0.5。
4. **奇数厚度的半像素补偿**：`n1 = (n+1)/2`、`n2 = n-n1`，不整除时偏移 -1。
5. **`clampR` 的下界由 dot 决定**（`dot ? thickness : 0`），不是 drawoutline。
6. **`clampR` 的上界是 `spread_limit + 64`**，且中间点 `0.75 * (spread_limit+64)` 参与指数软夹取。
7. **`cl_crosshair_dynamic_spread_limit` 的基线是 128 像素**，不是「最大半径」。
8. **T 型只影响上臂**，不影响其他三臂，也不影响环/弧。
9. **style6 在 dot 开启时不画任何东西**（避免和 4.7 的中心点重复）。
10. **style3/4/8/9 完全不吃 `length`**；`length` 只影响四臂（0/2/4/5/7）。
11. **style7 的弧和臂是两个独立门控**。
12. **`drawoutline == 2`（半描边）在 ARMS 里表现为 `(1,0)` 的 pair**，不是「画一半粗细」。

### 8.1 与网页引擎（`js/render-model.js`）的差异现状

| 项 | 游戏 | 引擎现状 | 处理 |
|---|---|---|---|
| style3 半径 | `max(1, gap)` | 同 | ✅ |
| style8 半边长 | `max(0, gap)` + thickness | 同 | ✅ |
| style7 弧半径 | `clampR + thickness` | 同 | ✅ |
| style9 弧半径 / 角度 | `max(1, gap) + thickness`、90° 轴向 | 同 | ✅ |
| style6 与 dot 叠加 | dot 开不重复画 | 同 | ✅ |
| style2 | 双套臂：内臂推进 `min(R, splitdist)·H/480`、外臂推进 `R` | 同（v4 按 `0xda67xx` 重写） | ✅ |
| style5 | 单套臂 + `round(max(0,gap) + H·k/1200)`，k∈[0,25]（+n/3.5 累积、-42/s 衰减） | 同（v4.1：`shotR`，预览 k = 25·env） | ✅ |
| 动态半径 | 3D 投影距离 → `focal(H)=2H/3` × t | `R = round(2H/3 × 0.1 × env × limit/255)` | ✅（静息基线用 gap 等价 A） |
| clampR | 指数软夹 + `roundf` | 同（v4：`softClamp` → min/max → `round`） | ✅ |
| clampR 下界 | `dot ? thickness : 0` | 同（2026-10-22 修正） | ✅ |
| 半径门控 | 只有 style 0/1/7 计算 | 同（v4：`radiusStyle`） | ✅ |
| 弧旋转角 | 45°（16:9 落在 45） | 45° | ✅ |
| 描边 | 整块扩边 + 奇数补偿 | 1px 描边 | 视觉等价 |

---

## 9. 验证方法

1. **设置页预览是 1:1 的**：`2560×1600` 屏上 `1920×1080` 客户区，预览区块与游戏渲染逐像素同尺寸——直接拿来做 oracle。
2. **像素量测脚本**（`.preview/`）：
   - `measure-preview.js`：绿色掩膜 → 质心、行/列绿色 run、半径直方图、45° 扇区统计。
   - `ring-angle.js`：y-up 极坐标 2° 角度直方图，验证「4 段、圆心在 ±45°」。
   - `anim-strip.js`：逐帧抽弧环半径，得到 4→73px 的散布曲线。
3. **软光栅对照**：`.preview/render-ops-png.js` 把引擎输出的 `layers/rects/rings/arcs` 自己栅格化成 PNG，与游戏预览裁剪并排比对。
4. **几何回归**：`node test/run-all.js`（8 套件，含 10 个样式的几何断言）。
5. **反汇编指纹**：`style_summary.py` 对每个样式入口统计常量与绘制原语调用，改引擎后可比对「常量集合是否仍一致」。

---

## 10. 复现命令

```bash
DLL="/d/software/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/bin/win64/client.dll"

# 反汇编单函数（含 rip-relative 常量解析）
python .preview/re/fn_dump.py "$DLL" 0xda0610 400      # Draw
python .preview/re/fn_dump.py "$DLL" 0xda7770 700      # weapon_debug_spread_show 调试散布圈（不写 DrawState）
python .preview/re/fn_dump.py "$DLL" 0xda6e60 200      # style7

# 样式常量指纹
python .preview/re/style_summary.py "$DLL"

# ConVar 字符串
python tools/re/cs2_scan.py strings "$DLL" crosshair
```

---

## 11. 未定案项（诚实清单）

1. **`+0x48 / +0x4c / +0x50` 这三个视口标量的物理含义**只确认了来源函数（`0x180c7be40`：武器 FOV 相关 float、`[rbx+0x1a18]`、vtable+0xbd0），没确认量纲。style7 的旋转角与 style2 的分裂尺度都依赖它们。
2. **style5 的 `k`（开火累积量）**来自 `[rcx+8][+4]` 的浮点成员，写入方在 `0x180b80220` 附近，语义未定名。
3. **`+0x3c` / `+0x9c`（ConVar `0x25c86e8`）**字段未定名。
4. **`0x25c8500` 与 `0x25c8530` 两个全局对象**各自只被 1–2 处代码引用；`0x25c8530` 在 `0xda0ab1` 被当作「预览开关」，`0x25c8500` 被当作「强制静态」。名字未能从二进制恢复（`.data` 段在文件里是 BSS，ConVar 对象无文件偏移）。
5. **动态半径的 live 标定**：算法已完全还原，但把「玩家朝向 / FOV / 视口三元组」映射成具体像素，需要游戏内实测配合；游戏已关闭，暂以 1080p 实测的 4→73px 曲线做经验近似。
