/* =========================================================================
 * cdp-client.js — 极简 Chrome DevTools Protocol 客户端（零依赖）
 * 用于 tools/hltv-sync.js 驱动本机有头 Edge 抓取 HLTV（Cloudflare 只放行真实浏览器）。
 *
 * 启动浏览器（有头，不能 headless，否则 Cloudflare 会一直挑战）：
 *   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
 *     --remote-debugging-port=9223 --user-data-dir=".tmp-edge" \
 *     --no-first-run --no-default-browser-check \
 *     --disable-blink-features=AutomationControlled --window-size=1400,900 about:blank
 *
 * 连接：http://127.0.0.1:9223/json/version → webSocketDebuggerUrl
 * ========================================================================= */
"use strict";

const DEFAULT_PORT = process.env.CDP_PORT || "9223";

async function connect(port) {
  port = port || DEFAULT_PORT;
  let ver;
  try {
    ver = await (await fetch("http://127.0.0.1:" + port + "/json/version")).json();
  } catch (e) {
    throw new Error(
      "连不上本机 CDP（127.0.0.1:" + port + "）。请先启动有头 Edge：\n" +
      "  msedge.exe --remote-debugging-port=" + port + " --user-data-dir=.tmp-edge " +
      "--no-first-run --disable-blink-features=AutomationControlled about:blank"
    );
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("WebSocket 连接失败")); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
    }
  };
  const send = (m, p = {}, s) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: s }));
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("EVAL: " + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  };

  /* 导航并等待选择器出现；Cloudflare 挑战通常 3–6 秒自动通过 */
  const nav = async (url, sel, timeoutMs = 30000) => {
    await send("Page.navigate", { url }, sessionId);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 600));
      try { if (await ev("!!document.querySelector(" + JSON.stringify(sel) + ")")) return true; } catch (e) {}
    }
    return false;
  };

  const close = async () => { try { await send("Target.closeTarget", { targetId }); } catch (e) {} ws.close(); };
  return { send, ev, nav, close, sessionId, targetId, browser: ver.Browser };
}

module.exports = { connect };
