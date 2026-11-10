/** SSE-over-fetch 聊天流客户端（自旧 sendMsg 的 reader 循环移植，与 DOM 解耦）。
 *  url 默认 POST /api/chat；断线续播传 GET /api/chat/attach?runId=（opts.method 留空即可，
 *  body 为 null）。服务端事件名：cli（内含 result / model.streaming(reasoning_delta|text_delta) /
 *  session.updated / tool.*）、fallback、end、replay-done。end 后主动 cancel，不等连接关闭。 */
export async function runChatStream({ url = "/api/chat", body, signal, onEvent }) {
  const resp = await fetch(url, {
    method: body !== undefined ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!resp.ok) {
    let msg = resp.status;
    try { msg = (await resp.json()).error || msg; } catch { /* keep status */ }
    if (resp.status === 401) window.dispatchEvent(new CustomEvent("auth:expired", { detail: { error: msg } }));
    throw new Error(msg);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let ended = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const lines = frame.split("\n");
      const evLine = lines.find((l) => l.startsWith("data: "));
      const evName = (lines.find((l) => l.startsWith("event: ")) || "").slice(7);
      if (!evLine) continue;
      const data = JSON.parse(evLine.slice(6));
      onEvent(evName, data);
      // end = 本轮结束；replay-done(ended:true) = attach 重放发现 run 已完结
      if (evName === "end" || (evName === "replay-done" && data.ended)) ended = true;
    }
    if (ended) { try { await reader.cancel(); } catch { /* noop */ } break; }
  }
}
