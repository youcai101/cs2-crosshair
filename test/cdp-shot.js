/* 极简 CDP 客户端：连接本机 9222 端口的 Chromium/Edge，
 * 打开页面 → 执行 JS → 截图。
 * 用法: node test/cdp-shot.js <url> <outPng> [evalJs] [settleMs]
 * 环境变量: CDP_PORT 指定调试端口（默认 9222）
 *           SHOT_W / SHOT_H 指定视口尺寸（默认 1600x1000）
 *           SHOT_DPR 指定设备像素比（默认 1）
 */
"use strict";
const fs = require("fs");

const [, , url, out, evalJs = "", settleMs = "600"] = process.argv;
const CDP_PORT = process.env.CDP_PORT || "9222";

async function main() {
  const ver = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version")).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });

  await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  const vw = parseInt(process.env.SHOT_W || "1600", 10);
  const vh = parseInt(process.env.SHOT_H || "1000", 10);
  const vdpr = parseFloat(process.env.SHOT_DPR || "1");
  await send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: vdpr, mobile: vw < 700 }, sessionId);
  await send("Page.navigate", { url }, sessionId);
  await new Promise((r) => setTimeout(r, 1200));
  if (evalJs) {
    const res = await send("Runtime.evaluate", { expression: evalJs, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) console.error("EVAL ERROR:", JSON.stringify(res.exceptionDetails).slice(0, 500));
    else if (res.result && res.result.value !== undefined) console.log("EVAL:", JSON.stringify(res.result.value));
  }
  await new Promise((r) => setTimeout(r, parseInt(settleMs, 10)));
  const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("SAVED", out);
  await send("Target.closeTarget", { targetId });
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
