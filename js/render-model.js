/* =========================================================================
 * render-model.js — CS2 准星几何引擎 v3（按游戏 ConVar 语义 + 源码算法重构）
 *
 * 依据（2026-10-21/22）：
 *   ① 客户端 ConVar 帮助文本（client.dll 0x1CB53D0–0x1CB5C00 区段，逐条抽出）：
 *      · gap        「Offset added to the gap between the crosshair center and the bars.」
 *      · length     「Length of each crosshair bar, scaled with screen resolution.」
 *      · thickness  「Thickness of the crosshair bars and circle, scaled with screen
 *                     resolution (minimum 1 pixel).」
 *      · spread_limit 「The additional distance the dynamic elements are allowed to
 *                     spread out to from the baseline of 128 pixels.」
 *      · drawoutline 「0 = No outline, 1 = Full outline, 2 = Half outline.」
 *      · t          「T-style crosshair: hide the top bar.」
 *      · dot        「Draw a dot at the center of the crosshair.」
 *      · screen_height 「The res at which the user authored their size settings at.」
 *      · 样式表     0 Dynamic Cross / 1 Dynamic Circle / 2 Dynamic Cross (Legacy) /
 *                    3 Static Circle / 4 Static Cross / 5 Static Cross (Shot Feedback) /
 *                    6 Dot Only / 7 Dynamic Quad / 8 Static Square / 9 Static Quad.
 *   ② 设置结构体（client.dll 0x180DBAFB0 结构体→ConVar、0x180DA8B00 ConVar→结构体）：
 *      +0x00 screen_height(f32) +0x04 style(i32) +0x08 recoil +0x0c drawoutline
 *      +0x10 dot +0x11 t +0x14 gap(f32) +0x18 thickness(f32) +0x1c length(f32)
 *      +0x20 spread_limit(f32) +0x24 color rgba +0x28 outline rgba
 *      +0x2c splitdist(f32) +0x30 innermod(f32) +0x34 outermod(f32)
 *      +0x38 splitratio(f32) +0x40 scope dot scale(f32)
 *   ③ CS:GO 绘制算法（fivem 移植的 DoCrosshairDraw，源注释标明取自泄露源）：
 *      距离 = round(spread * h/1200 + gap)，杆 = round(size * h/480)，
 *      粗 = max(1, round(thickness * h/480))，描边是「整块扩边黑底」而非描线，
 *      T 型跳过上臂，中心点 = thickness² 方块。
 *   ④ 游戏内设置页 1:1 预览逐像素实测（1080p / gap4 / len8 / thick2 / 全描边）：
 *      四臂绿区 [-12,-4] 与 [4,12]（1:1 像素、不乘 h/480）；
 *      style 7 = 静止四臂 + 4 段 45° 圆形象限弧，弧心线半径 4→约 73px，
 *      弧粗恒 = thickness，带 1px 黑描边。
 *
 * v4（2026-10-22 反汇编补完）的关键差异：
 *   · 半径改成「投影」模型：R = focal(H) × t，focal = 2H/3（hfov90@4:3 的 hor+ 约定 ⇒
 *     16:9 垂直 FOV 73.74°，focal = (H/2)/tan(vfov/2)）。满散布振幅 t = 0.1，即游戏设置页
 *     预览用的 |sin| × 0.1（0x1ada28c）；1080p 满散布半径 = 720 × 0.1 = 72px，
 *     旧版魔术数 70 退役（只在 1080p 近似相等）。
 *   · clampR 改指数软夹（0x180d9e770 实读）：v ≤ mid 原样，超过后 hi - (hi-mid)·exp(-(v-mid)/(hi-mid))，
 *     最后 roundf（0x181a17534）；旧版是 min(dist, hi·0.75) 硬夹。
 *   · 半径门控（0xda0aaa）：只有 style 0 / 1 / 7 进半径块，其余样式（含 style 2 的分裂）
 *     用各自的 gap 语义。style 2 的 gap 分裂里 gapUnit = t × 320（480p 基线），
 *     换算到当前高度是 ×H/480，splitdist 也是同一套 480p 单位 ⇒ splitPx = round(splitdist × H/480)。
 *   · style 2 分裂按游戏语义重写：内臂推进 min(spread, splitPx)，外臂推进 spread
 *     （旧版把「内臂不动、外臂推 splitdist」当成分裂，与 0xda67xx 实读不符）。
 *
 * 与旧版（v2）的关键差异：
 *   · 动态距离统一成「一个散布标量」：dist = gap + spread01 × (limit/255) × 70px，
 *     所有动态样式共用（0 十字 / 1 圆 / 7 弧环），不再各写一套硬编码端点；
 *   · 圆环半径跟随 gap 与散布（旧版固定 9→30，与游戏预览 4→73 不符）；
 *   · style 9「静态四分」改为四段 45° 弧（旧版是四角方块）；
 *   · 散布上限支持 0–255 线性缩放（help 文本语义：相对 128 基线的额外距离）；
 *   · 描边宽度、粗细、长度仍按 当前高度/记录高度 缩放（与游戏一致）。
 *
 * 坐标约定保留 v2：模型 gap 是中心到臂根内沿的距离；渲染内部 x = gap - ceil(f/2)
 * （2026-10-16 离线 258 样本验证：游戏几何 ≡ 该公式，含奇数臂厚 1px 不对称）。
 * ========================================================================= */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory({ codec: require("./core-codec.js") });
  } else {
    root.CS2XH = root.CS2XH || {};
    root.CS2XH.renderModel = factory(root.CS2XH);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NS) {
  "use strict";

  var Codec = NS.codec;

  /* ---------------- 样式 → 几何构造器 ----------------
   *   cross        四臂十字（散布推动臂外移）
   *   crossSplit   经典分裂：内臂缩短/淡出 + 外臂外推
   *   circle       圆环（动态 r=dist / 静态 r=max(1,gap)，宽 = thickness）
   *   quad         style 7 四段 45° 象限弧（r = clampR + thickness）；style 9 四段 90° 轴向弧
   *   square       方形（外沿 = max(0,gap) + thickness）
   *   dot          仅中心点（drawoutline≠0 时不画：0xda6e30）
   */
  var SHAPE = {
    0: "cross", 1: "circle", 2: "crossSplit", 3: "circle",
    4: "cross", 5: "cross", 6: "dot", 7: "quad", 8: "square", 9: "quad",
  };

  /* ---------------- 常量 ----------------
   * 散布半径的来源链（全部反汇编实读，见 tools/re/CROSSHAIR-REVERSE.md §4.5）：
   *   t（散布角/切线标量）= 武器散布三元组 A+B（0x180c7be40），设置页预览把 t 覆盖成
   *       |sinf(Plat_FloatTime())| × 0.1（0xda0b2x，常量 0x1ada28c）—— 预览唯一可对拍的振幅；
   *   R = 半径函数 0x180d9e560：把 origin 与 origin + 2000·(fwd - t·right) 都投影成屏幕点，
   *       取两点距离 ⇒ R = focal_px × t（纯角度，与投影矩阵一致）；
   *   focal_px = (H/2)/tan(vfov/2)，CS2 用 hfov=90°@4:3 的 hor+ 约定 ⇒ 16:9 vfov=73.74°，
   *       focal = 2H/3（1080p = 720）。
   * 预览没有武器上下文，所以 A（静息基线）用 gap 等价替换，B 用 env 表达；满散布振幅取
   * 设置页预览的 0.1，于是 1080p 满散布半径 = 720 × 0.1 = 72px。
   */
  var PREVIEW_SPREAD_T = 0.1;              // 设置页预览的散布振幅（0x1ada28c = 0.1f）
  var FOCAL_PER_HEIGHT = 2 / 3;            // focal = 2H/3（hor+ @4:3 hfov90）
  var SPLIT_BASE_HEIGHT = 480;             // style 2 的 480p 基线（0xda67xx 里显式 × H/480）
  var SPREAD_MAX_PX = Math.round(1080 * FOCAL_PER_HEIGHT * PREVIEW_SPREAD_T); // 72：1080p 满散布半径

  /* style 5（Static Cross / Shot Feedback）的 gap 补偿（0xda6b60 实读）：
   *   r = roundf(max(0, gap) + screenHeight × k / 1200)        ← 1200 @0x1c0a240
   *   k = 开火反馈累积量，clampf(k, 0, 25)（0x18015a220 是通用 clamp，上限 0x41c80000 = 25.0），
   *       每帧 k -= frametime × 42（42 @0x1cbbc74）；设置页预览里每帧 k += 15（0x1af3d1c）
   *       再 clamp 到 25，于是预览稳定在 ≈25（满量 +22.5px @1080p）。
   *   它不吃 clampR、不吃 spread_limit，只有这一条 1200 基线换算 ⇒ 预览用 k = 25 × env 表达。
   */
  var SPREAD_UNIT_BASE_HEIGHT = 1200;      // style 5 的 1200 基线（0x1c0a240）
  var SHOT_FEEDBACK_MAX_K = 25;            // k 上限（0x41c80000，经 clampf）
  var CLIMB_MAX_PX = 6;        // 后坐力预览上抬（展示层，非游戏几何）
  var ARC_SPAN_DEG = 45;       // 象限弧张角（游戏实测 44–46°）
  var OUTLINE_PX = 1;          // 描边宽度：游戏 1px（随分辨率缩放，见 scalePx）

  // 兼容旧导出（app/codec 读这些做读数标尺）
  var FIRE_SPREAD_PX = 5;
  var RECOIL_CLIMB_PX = 4;
  var RING_BASE_PX = 0;        // 保留：半径现在由 gap 驱动
  var CIRCLE_BASE_PX = 0;
  var RING_MAX_PX = SPREAD_MAX_PX;
  var CIRCLE_MAX_PX = SPREAD_MAX_PX;

  function styleShape(style) { return SHAPE[style] || "cross"; }

  function displayScale(model, opts) {
    var h = Number(opts && opts.viewHeight);
    var base = Number(model.screenHeight) || 1080;
    if (!h || !base) return 1;
    return h / base;
  }

  function clamp01(v) { var n = Number(v); return isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }

  /* 指数软夹（0x180d9e770 实读）：
   *   mid >= x ? x : hi - (hi - mid) * expf(-(x - mid) / (hi - mid))
   * 用途：clampR —— 把散布半径平滑地压向 hi = spread_limit + 64，而不是硬截断。
   */
  function softClamp(x, mid, hi) {
    if (!(hi > mid) || x <= mid) return x;
    return hi - (hi - mid) * Math.exp(-(x - mid) / (hi - mid));
  }

  function dynLimit(model) {
    var v = Number(model.dynamicSpreadLimit);
    return isFinite(v) ? Math.min(255, Math.max(0, v)) : 255;
  }

  function outlineWidth(model, scale) {
    var mode = Number(model.outlineMode) || 0;
    if (!mode) return 0;
    return Math.max(1, Math.round(OUTLINE_PX * scale));
  }

  /* ---------------- 指标 ----------------
   * 返回几何所需的全部标量；env = 0..1 散布包络（UI rAF 传入 spread01）。
   */
  function crosshairMetrics(model, opts) {
    opts = opts || {};
    var scale = displayScale(model, opts);
    var recoil = !!opts.recoil;
    var info = Codec.styleInfo(model.style);
    var isStatic = !info.dynamic;
    var shape = styleShape(model.style);

    var f = Math.max(1, Math.round((Number(model.thickness) || 0) * scale));
    var b = Math.max(0, Math.round((Number(model.length) || 0) * scale));
    var gapPx = Math.round((Number(model.gap) || 0) * scale);
    var x = gapPx - Math.ceil(f / 2);

    // 散布包络：spread01 优先；兼容旧参数 spreadPx / splitScale / 布尔 recoil
    var env;
    if (opts.spread01 != null) env = clamp01(opts.spread01);
    else if (opts.splitScale != null) env = clamp01(opts.splitScale);
    else if (opts.spreadPx != null && isFinite(Number(opts.spreadPx))) env = clamp01(Number(opts.spreadPx) / SPREAD_MAX_PX);
    else env = recoil ? 1 : 0;

    var climbEnv;
    if (opts.climb01 != null) climbEnv = clamp01(opts.climb01);
    else if (opts.climbPx != null && isFinite(Number(opts.climbPx))) climbEnv = clamp01(Number(opts.climbPx) / CLIMB_MAX_PX);
    else climbEnv = 0;

    /* 半径门控（0xda0aaa 实读）：
     *   r15b = byte [global+0x58]；为 0 时 style>1 且 style!=7 直接跳过整个半径块
     *   ⇒ 只有 0 Dynamic Cross / 1 Dynamic Circle / 7 Dynamic Quad 走「半径」，
     *     其余样式（含 style 2 的经典分裂）用各自的 gap 语义。
     */
    var style = Number(model.style) || 0;
    var radiusStyle = !isStatic && (style === 0 || style === 1 || style === 7);

    /* style 5 的反馈半径（0xda6b60）：r = round(max(0,gap) + H × k / 1200)，k ∈ [0,25]。
     * 静止（env=0）时 r = gap，与静态十字同形；满量 @1080p 再外推 22.5px。
     */
    var isShotFeedback = style === 5;
    var limit = dynLimit(model);
    var viewH = Number(opts.viewHeight) || Number(model.screenHeight) || 1080;
    var shotK = isShotFeedback ? SHOT_FEEDBACK_MAX_K * env : 0;
    var shotR = Math.round(Math.max(0, gapPx) + viewH * shotK / SPREAD_UNIT_BASE_HEIGHT);
    var focalPx = viewH * FOCAL_PER_HEIGHT;    // 1080p = 720
    // t：散布角标量。游戏里 t = A+B（武器散布），设置页预览覆盖成 |sin|×0.1；
    // 预览没有武器上下文，用 env × 设置页振幅（再用 spread_limit 线性缩放上限）。
    var t = PREVIEW_SPREAD_T * env * (limit / 255);
    var spread = 0;
    if (!isStatic && shape !== "dot") spread = Math.round(focalPx * t);
    var dist = gapPx + spread;                 // 中心 → 动态元素基准半径（gap 当静息基线）

    /* clampR（游戏 0xda0bc5，反汇编实读）：
     *   hi = spread_limit + 64                                [0x1ac6094]
     *   mid = hi * 0.75                                       [0x1b2e078]
     *   lo = (dot 开关 ? thickness : 0)                       ← 是 dot，不是 drawoutline
     *   [0xb4] = min(hi, max(lo, softClamp(radius, mid, hi)))  （0x180d9e770 + minss/maxss）
     * 动态样式（0/1/7）用它当基准半径，静态样式（3/4/8/9）直接用原始 gap。
     */
    var hiR = limit + 64;
    var midR = hiR * 0.75;
    var loR = model.centerDotEnabled ? f : 0;
    var clampR = softClamp(dist, midR, hiR);   // 指数软夹（0x180d9e770）
    clampR = Math.min(hiR, Math.max(loR, clampR));
    clampR = Math.round(clampR);               // 游戏随后 call roundf（0x181a17534）

    /* 静态样式的半径基准（逆向结论，2026-10-22）：
     *   style 3 Static Circle : RING 内径 r = max(1, gap)       （0xda6a80 → 0x1801b9c30）
     *   style 9 Static Quad   : ARC 外径 = max(1, gap) + thickness（0xda7390）
     *   style 8 Static Square : 外沿 = max(0, gap) + thickness    （0xda7110）
     * 前两者的像素带都落在 [gap, gap+thickness]；style 8 是矩形，单独算外沿。
     * length 只影响四臂（style 0/2/4/5/7），不影响圆/方/弧。
     */
    var staticR = Math.max(1, gapPx);

    /* 圆环/弧的半径基准（画布中心线）：
     *   RING(0xda6290) 内侧半径 r、向外加 w        → 中心线 = r + w/2
     *   ARC (0xda61c0) 外径 r、向内减 w（style7 传 r+w）→ 中心线 = r - w/2
     * 两套都让像素带落在 [base, base+thickness]，所以统一 +f/2。
     */
    var ringR = (radiusStyle ? clampR : staticR) + f / 2;
    var ringW = f;
    var squareOuter = Math.max(0, gapPx) + f;   // style 8 边长一半（外沿）

    // 后坐力上抬（展示层；静态样式一律忽略）
    var climb = 0;
    if (!isStatic) {
      if (opts.climb01 != null || opts.climbPx != null) {
        climb = Math.round(climbEnv * CLIMB_MAX_PX * scale);
      } else if (recoil && model.followRecoil) {
        climb = Math.round(RECOIL_CLIMB_PX * scale);
      }
    }

    /* style 2 的 splitdist 与 gapUnit 共用 480p 基线（0xda67xx：split = min(gapUnit, splitdist);
     * 换算到当前高度是 ×H/480），所以这里也按 H/480 换算，和 spread（= t·focal）同单位。 */
    var splitPx = Math.round((Number(model.splitDistance) || 0) * viewH / SPLIT_BASE_HEIGHT);

    /* style 5（游戏 0xDA6B60）：只有一套四臂，不做双层分裂——这一点已由反汇编确认，
     * 因此 SHAPE[5] = "cross"、STYLES[5].split = false。
     * 它的「外推」不是加在 gap 上的独立项，而是把整条半径换成 shotR（见上面 shotK 注释），
     * 所以 span 要按 shotR 而不是 gap 算。
     */
    /* 臂根（= 中心到臂内沿的像素距离，arm() 里再换算成画布坐标）：
     *   动态样式（0/1/7）：ARMS 收到的是 clampR（0xb4），不是原始 dist；
     *   style 5：ARMS 收到 shotR（gap + H·k/1200）；
     *   静态十字（style 4）：直接 gap。
     * 三者都要减去 ceil(f/2)：模型里 gap 指「中心到臂内沿」，而画布坐标以臂厚 f 为基准。
     */
    var armPad = Math.ceil(f / 2);
    var armStart = (radiusStyle ? clampR : (isShotFeedback ? shotR : gapPx)) - armPad;
    var span;
    if (shape === "circle" || shape === "quad") span = Math.max(ringR * 2 + ringW, f, 1);
    else if (shape === "dot") span = Math.max(f, 1);
    else span = Math.max(armStart * 2 + b * 2 + f + 2 * spread, ringR * 2 + ringW, f, 1);

    return {
      f: f, b: b, x: x, gapPx: gapPx, dist: dist, spread: spread, climb: climb,
      env: env, scale: scale, span: span,
      t: t, focal: focalPx, viewH: viewH, radius: clampR, radiusStyle: radiusStyle,
      style: style, shotFeedback: isShotFeedback, shotK: shotK, shotR: shotR, armStart: armStart,
      ringR: ringR, ringW: ringW, staticR: staticR, squareOuter: squareOuter,
      splitPx: splitPx,
      static: isStatic, split: !!info.split, shape: shape,
      dotOnly: shape === "dot", dynamic: !!info.dynamic,
      limit: limit, outlineW: outlineWidth(model, scale),
    };
  }

  function crosshairSpan(model, opts) { return crosshairRects(model, opts).span; }

  /* ---------------- 图元生成 ----------------
   * layers: [{ mul, rects:[{x,y,w,h}], rings:[{cx,cy,r,w}], arcs:[{r,w,a0,a1}] }]
   *   mul = 该层不透明度乘数（style 2/5 分裂的内/外层）
   *   arcs 的角度用 canvas 屏幕坐标（y 向下）
   */
  function crosshairRects(model, opts) {
    opts = opts || {};
    var m = crosshairMetrics(model, opts);
    var f = m.f, b = m.b, x = m.x, shape = m.shape;
    var off = -Math.floor(f / 2);
    var dy = m.climb > 0 ? -m.climb : 0;

    // dir: 0 右 / 1 左 / 2 上 / 3 下；start 为「边沿起算」的臂根偏移
    function arm(dir, start, len) {
      if (dir === 0) return { x: off + f + start, y: off, w: len, h: f };
      if (dir === 1) return { x: off - start - len, y: off, w: len, h: f };
      if (dir === 2) return { x: off, y: off - start - len, w: f, h: len };
      return { x: off, y: off + f + start, w: f, h: len };
    }

    // 四段弧：style 7 落在 45°/135°/225°/315°（轴向留空，实测张角 ≈45°）；
    // style 9（0xda7390）是把同一个 ARC 按 90° 复制四份，tiling 成整圈。
    function quadrantArcs(r, w, axisAligned) {
      var spanDeg = axisAligned ? 90 : ARC_SPAN_DEG;
      var half = (spanDeg / 2) * Math.PI / 180;
      var out = [];
      for (var q = 0; q < 4; q++) {
        var mid = ((axisAligned ? 0 : 45) + q * 90) * Math.PI / 180;
        out.push({ r: r, w: w, a0: mid - half, a1: mid + half });
      }
      return out;
    }

    var dirs = model.tStyleEnabled ? [0, 1, 3] : [0, 1, 2, 3];
    var dotRects = model.centerDotEnabled ? [{ x: off, y: off, w: f, h: f }] : [];
    var layers = [];

    if (shape === "dot") {
      layers.push({ mul: 1, rects: [{ x: off, y: off, w: f, h: f }], rings: [] });
      return finish(layers, m, dy);
    }

    if (shape === "cross" || shape === "crossSplit") {
      // style 0（Dynamic Cross）的四臂吃半径 clampR；其余 cross 样式（4/5）静止。
      if (shape === "crossSplit" && m.spread > 0 && b > 0) {
        /* 经典分裂（style 2，游戏 0xDA66C0 实读，v4 按实读重写）：
         *   gapUnit    = (A+B) × 320 / tan(halfFov)          ← 480p 像素；= t × 320
         *   split      = min(gapUnit, splitdist)             ← splitdist 同一套 480p 单位
         *   innerShift = round(split    × H/480)             ← 内臂推进（被 splitdist 截断）
         *   outerShift = round(gapUnit  × H/480) = 半径 R    ← 外臂推进（= t · focal）
         *   innerGap = gap + innerShift；outerGap = gap + outerShift（innerShift > 0 时）
         * 臂长：内臂 ceil((1-splitSizeRatio)·length)，外臂 |length·splitSizeRatio|。
         * innerSplitAlpha 是「内臂隐藏度」：1 = 内臂完全隐藏；outerSplitAlpha 乘外臂。
         * 层序：中心点 → 内臂 → 外臂（越靠外越晚画，和游戏 HUD 一致）。
         */
        if (dotRects.length) layers.push({ mul: 1, rects: dotRects, rings: [] });
        var ratio = clamp01(model.splitSizeRatio);
        var innerAlpha = 1 - clamp01(model.innerSplitAlpha);
        if (innerAlpha > 0.01) {
          var innerLen = Math.ceil((1 - ratio) * b);
          var innerX = x + Math.min(m.spread, m.splitPx);   // 内臂推进量被 splitdist 截断
          if (innerLen > 0) {
            var inner = [];
            for (var i0 = 0; i0 < dirs.length; i0++) inner.push(arm(dirs[i0], innerX, innerLen));
            layers.push({ mul: innerAlpha, rects: inner, rings: [] });
          }
        }
        var outerLen = Math.max(0, Math.round(Math.abs(b * ratio)));
        if (outerLen > 0) {
          var outer = [];
          var outerX = x + m.spread;                       // 外臂推进到完整半径 R
          for (var i1 = 0; i1 < dirs.length; i1++) outer.push(arm(dirs[i1], outerX, outerLen));
          layers.push({ mul: clamp01(model.outerSplitAlpha), rects: outer, rings: [] });
        }
      } else {
        var main = [];
        // 臂根统一走 metrics 给出的 armStart（动态 = clampR、style 5 = shotR、静态 = gap），
        // 四向同量；不再在这里二次加 spread，避免出现第二个口径。
        for (var i = 0; i < dirs.length; i++) main.push(arm(dirs[i], m.armStart, b));
        for (var d0 = 0; d0 < dotRects.length; d0++) main.push(dotRects[d0]);
        layers.push({ mul: 1, rects: main, rings: [] });
      }
    } else if (shape === "circle") {
      layers.push({ mul: 1, rects: dotRects, rings: [{ cx: 0, cy: 0, r: m.ringR, w: m.ringW }] });
    } else if (shape === "quad") {
      // style 7（动态四分）：四臂静止 + 4 段弧随散布外扩
      // style 9（静态四分）：无臂，只有 4 段固定半径弧（半径 = gap + length），角度落在轴向
      var isStaticQuad = model.style === 9;
      var rects = [];
      if (!isStaticQuad) {
        for (var i2 = 0; i2 < dirs.length; i2++) rects.push(arm(dirs[i2], x, b));
        for (var d1 = 0; d1 < dotRects.length; d1++) rects.push(dotRects[d1]);
      } else {
        for (var d2 = 0; d2 < dotRects.length; d2++) rects.push(dotRects[d2]);
      }
      layers.push({ mul: 1, rects: rects, rings: [], arcs: quadrantArcs(m.ringR, m.ringW, isStaticQuad) });
    } else if (shape === "square") {
      /* style 8 Static Square（0xda7110）：四边矩形，外沿 ±(gap+thickness)、内沿 ±gap，
       * 边宽 = thickness；四条边在四角互相重叠（游戏就是这么画的，不是「四角块」）。
       */
      var outer = Math.max(1, m.squareOuter);
      var lo = -outer, hi = outer, side = hi - lo;
      var sr = [];
      if (model.centerDotEnabled) sr.push({ x: off, y: off, w: f, h: f });
      sr.push({ x: lo, y: lo, w: side, h: f });        // 上边
      sr.push({ x: lo, y: hi - f, w: side, h: f });    // 下边
      sr.push({ x: lo, y: lo, w: f, h: side });        // 左边
      sr.push({ x: hi - f, y: lo, w: f, h: side });    // 右边
      layers.push({ mul: 1, rects: sr, rings: [] });
    }

    return finish(layers, m, dy);
  }

  function finish(layers, m, dy) {
    var e = 0;
    for (var li = 0; li < layers.length; li++) {
      var rs = layers[li].rects || [];
      for (var ri = 0; ri < rs.length; ri++) {
        var r = rs[ri];
        e = Math.max(e, Math.abs(r.x), Math.abs(r.x + r.w), Math.abs(r.y + dy), Math.abs(r.y + r.h + dy));
      }
      var gs = layers[li].rings || [];
      for (var gi = 0; gi < gs.length; gi++) e = Math.max(e, Math.abs(gs[gi].r) + gs[gi].w / 2);
      var as = layers[li].arcs || [];
      for (var ai = 0; ai < as.length; ai++) e = Math.max(e, Math.abs(as[ai].r) + as[ai].w / 2);
    }
    return {
      f: m.f, b: m.b,
      x: m.x + (m.shape === "cross" ? m.spread : 0),
      dy: dy, spread: m.spread, climb: m.climb,
      radius: m.radius, radiusStyle: m.radiusStyle, splitPx: m.splitPx, viewH: m.viewH,
      static: m.static, split: m.split, shape: m.shape, dist: m.dist,
      gapPx: m.gapPx, ringR: m.ringR, ringW: m.ringW,
      scale: m.scale, span: Math.max(e * 2 + 1, m.span, 1), layers: layers,
    };
  }

  function crosshairRectsFlat(model, opts) {
    var g = crosshairRects(model, opts);
    var out = [];
    for (var i = 0; i < g.layers.length; i++) out = out.concat(g.layers[i].rects || []);
    return { f: g.f, b: g.b, x: g.x, span: g.span, static: g.static, rects: out };
  }

  /* ---------------- 绘制指令 ---------------- */
  function buildDrawOps(model, opts) {
    var g = crosshairRects(model, opts);
    var alpha = Math.max(0, Math.min(255, Number(model.alpha))) / 255;
    var outlineMode = Number(model.outlineMode) || 0;
    return {
      layers: g.layers,
      f: g.f, b: g.b, x: g.x, span: g.span, dy: g.dy, spread: g.spread, climb: g.climb,
      dist: g.dist, gapPx: g.gapPx, ringR: g.ringR, ringW: g.ringW,
      shape: g.shape, scale: g.scale,
      rgb: model.red + "," + model.green + "," + model.blue,
      alpha: alpha,
      outlineMode: outlineMode,
      outlineRgb: "rgb(" + model.outlineRed + "," + model.outlineGreen + "," + model.outlineBlue + ")",
      outlineAlpha: Math.max(0, Math.min(255, Number(model.outlineAlpha))) / 255,
      outlineWidth: outlineMode === 0 ? 0 : Math.max(1, Math.round(OUTLINE_PX * g.scale)),
      outlineEnabled: outlineMode !== 0,
    };
  }

  // 预览框需要的内容外沿（含描边余量与开火上移）
  function contentSpan(model, opts) {
    var extra = (Number(model.outlineMode) || 0) !== 0 ? 3 : 2;
    return crosshairSpan(model, opts) + extra * 2;
  }

  /* ---------------- 镜内准星点（scope dot） ----------------
   * 结构体 +0x40 = scope dot scale（ConVar cl_crosshair_dot_scale 待确认名），
   * 直径 = max(1, thickness × scale × 显示缩放)。
   */
  function scopeDot(model, opts) {
    var scale = displayScale(model, opts || {});
    var s = Math.max(1, Math.round((Number(model.thickness) || 0) * (Number(model.scopeDotScale) || 1) * scale));
    return { size: s, rgb: model.scopeDotUseCrosshairColor ? [model.red, model.green, model.blue] : [255, 255, 255] };
  }

  return {
    SHAPE: SHAPE,
    FIRE_SPREAD_PX: FIRE_SPREAD_PX,
    RECOIL_CLIMB_PX: RECOIL_CLIMB_PX,
    MAX_SPREAD_PX: SPREAD_MAX_PX,
    MAX_CLIMB_PX: CLIMB_MAX_PX,
    SPREAD_MAX_PX: SPREAD_MAX_PX,
    RING_BASE_PX: RING_BASE_PX,
    CIRCLE_BASE_PX: CIRCLE_BASE_PX,
    RING_MAX_PX: RING_MAX_PX,
    CIRCLE_MAX_PX: CIRCLE_MAX_PX,
    ARC_SPAN_DEG: ARC_SPAN_DEG,
    OUTLINE_PX: OUTLINE_PX,
    styleShape: styleShape,
    displayScale: displayScale,
    crosshairMetrics: crosshairMetrics,
    crosshairRects: crosshairRects,
    crosshairRectsFlat: crosshairRectsFlat,
    crosshairSpan: crosshairSpan,
    contentSpan: contentSpan,
    buildDrawOps: buildDrawOps,
    scopeDot: scopeDot,
  };
});
