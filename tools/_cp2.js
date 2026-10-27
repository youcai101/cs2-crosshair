
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "css", "style.css");
let s = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");

const NEW_CSS = `/* 调色盘：与游戏里的取色对话框同构 —— 左「SV 方块 + 色相条 + 不透明度条」，
 * 右「新 / 当前」两个色块 + R G B # A 数值框。没有候选色，任意颜色都能调出来。 */
.cp-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 0 13px;
  border: 0;
  border-radius: 0;
  background: var(--input-bg);
  box-shadow: inset 0 0 0 1px var(--hairline);
  color: var(--label-2);
  font-family: inherit;
  font-size: 13.5px;
  cursor: pointer;
  transition: background .15s ease, box-shadow .15s ease;
}
.cp-trigger:hover { background: var(--fill-5); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .16); }
.cp-trigger:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--accent-line), 0 0 0 3px var(--focus-ring); }
.cp-trigger-hex { font-family: var(--font-mono); font-size: 13px; font-weight: 620; letter-spacing: .02em; color: var(--label); }
.cp-trigger-alpha { font-size: 12.5px; color: var(--label-3); }
.cp-trigger-alpha b { font-family: var(--font-mono); font-weight: 620; color: var(--label-2); }
.cp-trigger-go { margin-left: auto; font-size: 12.5px; color: var(--label-3); }
.cp-trigger:hover .cp-trigger-go { color: var(--accent); }

/* 色块：棋盘格打底 + 颜色叠加，alpha 一眼可见 */
.cp-chip,
.cp-preview {
  position: relative;
  flex: none;
  overflow: hidden;
  background-color: #2a2a2a;
  background-image: repeating-conic-gradient(#3c3c3c 0% 25%, #262626 0% 50%);
  background-size: 8px 8px;
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.cp-chip { width: 44px; height: 22px; }
.cp-preview { width: 100%; height: 32px; }
.cp-chip::after,
.cp-preview::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--chip, #00ff00);
  opacity: var(--chip-a, 1);
}

/* 对话框 */
.cp-dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: 92vh;
  overflow-y: auto;
  padding: 18px;
  background: var(--surface-1);
  box-shadow: inset 0 0 0 1px var(--hairline), var(--shadow-3);
}
.cp-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.cp-title { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 650; letter-spacing: -.01em; color: var(--label); }
.cp-hint { font-size: 12px; color: var(--label-4); }
.cp-body { display: grid; grid-template-columns: minmax(0, 1fr) 172px; gap: var(--s4); align-items: start; }
.cp-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.cp-sv {
  position: relative;
  height: 172px;
  cursor: crosshair;
  touch-action: none;
  outline: none;
  background:
    linear-gradient(to top, #000, rgba(0, 0, 0, 0)),
    linear-gradient(to right, #fff, var(--cp-hue, #00ff00));
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.cp-sv:focus-visible { box-shadow: inset 0 0 0 1px var(--hairline), 0 0 0 3px var(--focus-ring); }
.cp-slider {
  position: relative;
  height: 16px;
  cursor: pointer;
  touch-action: none;
  outline: none;
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.cp-slider:focus-visible { box-shadow: inset 0 0 0 1px var(--hairline), 0 0 0 3px var(--focus-ring); }
.cp-hue { background: linear-gradient(90deg, #f00 0%, #ff0 16.66%, #0f0 33.33%, #0ff 50%, #00f 66.66%, #f0f 83.33%, #f00 100%); }
.cp-alpha {
  background-color: #2a2a2a;
  background-image:
    linear-gradient(90deg, rgba(0, 0, 0, 0), var(--cp-solid, #00ff00)),
    repeating-conic-gradient(#3c3c3c 0% 25%, #262626 0% 50%);
  background-size: auto, 8px 8px;
}
.cp-marker {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--cp-dot, #fff);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .45);
  pointer-events: none;
}
.cp-bar {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 20px;
  margin: -10px 0 0 -2px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .5);
  pointer-events: none;
}

/* 右侧：新 / 当前 + 数值框 */
.cp-pane { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.cp-pane-label { font-size: 11.5px; letter-spacing: .04em; color: var(--label-4); }
.cp-fields { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.cp-field { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cp-field > span {
  width: 12px;
  flex: none;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 620;
  color: var(--label-3);
  text-align: center;
}
.cp-field:nth-child(1) > span { color: var(--rgb-r); }
.cp-field:nth-child(2) > span { color: var(--rgb-g); }
.cp-field:nth-child(3) > span { color: var(--rgb-b); }
.cp-field input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: var(--input-bg);
  box-shadow: inset 0 0 0 1px var(--hairline);
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  color: var(--label);
  text-align: right;
  outline: none;
  -moz-appearance: textfield;
  appearance: textfield;
}
.cp-field input:focus { box-shadow: inset 0 0 0 1px var(--accent-line); }
.cp-field input::-webkit-outer-spin-button,
.cp-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cp-field-wide input { text-align: left; letter-spacing: .04em; }
.cp-foot { display: flex; justify-content: flex-end; gap: var(--s2); margin-top: 16px; }

`;

const startMarker = "/* 取色板：左色轮（色相×饱和度）+ 右明度 / 不透明度 / RGB 数值。";
const endMarker = "\n.switch-row {";
const i = s.indexOf(startMarker);
const j = s.indexOf(endMarker);
if (i < 0 || j < 0 || j < i) { console.error("BLOCK MARKER MISS", i, j); process.exit(1); }
s = s.slice(0, i) + NEW_CSS + s.slice(j + 1);

const oldMedia = `  /* 色轮在窄屏改上下排：轮在上、滑杆与 RGB 数值在下，不挤压 144px 的圆形 */
  .cp-board { grid-template-columns: minmax(0, 1fr); gap: var(--s3); }
  .cp-wheel-wrap { align-items: flex-start; flex-direction: row; gap: var(--s3); }
  .cp-wheel { width: 120px; height: 120px; }
  .cp-hex { align-self: center; }
`;
const newMedia = `  /* 调色盘在窄屏改上下排：色带在上、色块与数值框在下 */
  .cp-body { grid-template-columns: minmax(0, 1fr); gap: var(--s3); }
  .cp-sv { height: 148px; }
  .cp-preview { height: 26px; }
`;
if (s.indexOf(oldMedia) < 0) { console.error("MEDIA MISS"); process.exit(1); }
s = s.replace(oldMedia, newMedia);

const oldTouch = `  /* RGB 数字框：桌面上 22px 高够用，触屏上要抬到 40px 才好点中 */
  .cp-num { min-height: 40px; }
  .cp-num input { font-size: 15px; }
`;
const newTouch = `  /* 调色盘的数值框：桌面上 28px 高够用，触屏上要抬到 40px 才好点中 */
  .cp-field input { height: 40px; font-size: 15px; }
  .cp-field > span { font-size: 13px; }
`;
if (s.indexOf(oldTouch) < 0) { console.error("TOUCH MISS"); process.exit(1); }
s = s.replace(oldTouch, newTouch);

fs.writeFileSync(FILE, s.replace(/\n/g, "\r\n"), "utf8");
console.log("OK", s.length);
