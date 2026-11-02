import { api } from "../api.js";
import { runChatStream } from "../sse.js";
import { ui, setStatus } from "./ui.svelte.js";
import { session, loadWorkspaces, syncHash } from "./session.svelte.js";

/** 聊天态：turns 统一承载回放轮与流式轮（streaming:true 表示正在生成）。
 *  轮结构：{ seq?, _id?, user, files, think, tools[], text, fallbacks[], streaming } */
export const chat = $state({
  turns: [],
  hasMore: false,
  beforeSeq: null,   // 「加载更早」游标
  loading: false,    // 回放加载中
  loadingEarlier: false,
  sending: false,    // 当前选中会话正在流式运行（发送键 ↔ 停止键）
  primed: false,     // false = 登录后初始空态（「开始你的第一个任务」），true = 显式新会话/回放后
  scrollTick: 0,     // 递增 → ChatArea 强制滚底（回放/新轮）
  attachRunId: null, // 当前本地流订阅对应的后台 run（send 的 start 事件 / attach 时设置）
});

/** 后台运行中的 run（runId → {runId, ws, sessionId, message, started}）。
 *  覆盖所有会话：服务端 CLI 与 SSE 解耦后，刷新/切走 run 继续跑；
 *  当前会话的 run 驱动 sending，其余的供侧栏转圈与恢复续播。 */
export const runs = $state({ map: {} });

let abort = null; // 模块内非响应式：仅 send/stop/attach 使用
let unsubOnly = false; // abort 时只退订（切换会话），不调 stop API
let liveId = 0;

export function chatBusy() { return !!abort || chat.sending; }

/** 刷新后台运行列表（boot / run 生命周期 / 切会话时调用） */
export async function refreshRuns() {
  try {
    const { runs: list } = await api("/api/chat/running");
    const map = {};
    for (const r of list) map[r.runId] = r;
    runs.map = map;
  } catch { /* 网络抖动保留旧值 */ }
}

/** 某会话是否有后台 run 在跑（sessionId=null 匹配尚未落库的全新会话 run） */
export function sessionRunning(sessionId) {
  return Object.values(runs.map).some((r) => r.sessionId === sessionId);
}

export function clearChat() {
  chat.turns = [];
  chat.hasMore = false;
  chat.beforeSeq = null;
  chat.loading = false;
  chat.loadingEarlier = false;
  chat.primed = true;
}

/** 会话回放：最近 10 轮 + 游标 */
export async function replay(sessionId) {
  clearChat();
  chat.primed = true;
  chat.loading = true;
  try {
    const { turns, hasMore } = await api(`/api/sessions/${sessionId}/messages?limit=10`);
    if (session.sessionId !== sessionId) return; // 等待期间已切走
    chat.turns = turns;
    chat.hasMore = !!hasMore;
    chat.beforeSeq = turns[0]?.seq ?? 0;
    chat.scrollTick++;
  } catch (e) {
    setStatus("回放失败: " + e.message);
  }
  chat.loading = false;
}

/** 「加载更早」：把更早轮次插到顶部，保持当前位置 */
export async function loadEarlier() {
  if (!chat.hasMore || !session.sessionId || chat.loadingEarlier) return;
  chat.loadingEarlier = true;
  try {
    const { turns, hasMore } = await api(`/api/sessions/${session.sessionId}/messages?before=${chat.beforeSeq}&limit=10`);
    chat.turns = [...turns, ...chat.turns];
    chat.hasMore = !!hasMore;
    if (turns.length) chat.beforeSeq = turns[0].seq;
  } catch (e) {
    setStatus("加载更早失败: " + e.message);
  }
  chat.loadingEarlier = false;
}

/** 用户点「停止」：断开本地订阅 + 让服务端终止 run（不影响其他会话的 run） */
export function stop() {
  const runId = chat.attachRunId
    || (Object.values(runs.map).find((r) => r.sessionId === session.sessionId) || {}).runId;
  unsubOnly = false;
  if (abort) { try { abort.abort(); } catch { /* noop */ } }
  if (runId) {
    api("/api/chat/stop", { method: "POST", body: JSON.stringify({ runId}) })
      .then(refreshRuns).catch(() => {});
  }
}

/** 切换会话时断开本地流订阅：后台 run 继续跑，回到该会话由 restoreRunningRun 续播 */
export function detachLive() {
  if (abort) { unsubOnly = true; try { abort.abort(); } catch { /* noop */ } }
}

// —— SSE 事件 → 流式轮的统一处理器：send 与 attachRun 共用 ——
function makeStreamHandler(t) {
  return function onEvent(evName, ev) {
    if (evName === "cli") {
      if (ev.sessionId && session.sessionId !== ev.sessionId) {
        // 新会话首次拿到 id：清占位标题 + 同步 URL hash
        session.sessionId = ev.sessionId;
        session.sessionTitle = null;
        syncHash();
      }
      if (ev.type === "result") {
        t.text = ev.response || t.text;
      } else {
        const p = ev.payload || {};
        if (ev.type === "model.streaming" && p.kind === "reasoning_delta" && p.delta) {
          t.think += p.delta;
        } else if (ev.type === "model.streaming" && p.kind === "text_delta" && p.delta) {
          t.text += p.delta;
        } else if (ev.type === "session.updated" && p.content !== undefined) {
          t.text = p.content;
        } else if (ev.type === "tool.updated") {
          // 新内核事件：kind=scheduled 时带完整 input（写入详情），在流式界面即时出图标
          const callId = p.toolCallId || p.callID || p.id || "";
          const name = p.toolName || p.name || p.tool || "tool";
          if (p.input !== undefined && p.input !== null && !(callId && t.tools.some((x) => x.callId === callId))) {
            const input = p.input;
            const brief = typeof input === "string" ? input.slice(0, 90)
              : input && typeof input === "object" ? JSON.stringify(input).slice(0, 90)
              : p.summary || p.description || "";
            const detail = typeof input === "string" ? input : JSON.stringify(input, null, 1);
            t.tools.push({ name, brief, detail, callId: callId || "" });
          }
        } else if (ev.type === "tool.execution" || ev.type === "tool_execution" || ev.type === "tool.execution_start" || ev.type === "tool_call") {
          const name = p.toolName || p.name || p.tool || "tool";
          const brief = typeof p.input === "string" ? p.input.slice(0, 90)
            : p.args ? JSON.stringify(p.args).slice(0, 90)
            : p.summary || p.description || "";
          const detail = p.input != null ? (typeof p.input === "string" ? p.input : JSON.stringify(p.input, null, 1)) : (p.args ? JSON.stringify(p.args, null, 1) : brief);
          const callId = p.callID || p.callId || p.id;
          if (callId && t.tools.some((x) => x.callId === callId)) return; // 同一次调用的事件去重
          t.tools.push({ name, brief, detail, callId: callId || "" });
        }
      }
    } else if (evName === "fallback") {
      t.fallbacks.push({ from: ev.from, to: ev.to, reason: ev.reason });
      setStatus("已切换备用模型…");
    } else if (evName === "guardrail") {
      t.violations.push({ message: ev.message, tool: ev.tool });
      setStatus("安全拦截：" + ev.message);
    } else if (evName === "end") {
      setStatus(ev.code === 0 ? "完成" : (`退出码 ${ev.code}` + (ev.error ? "：" + String(ev.error).slice(0, 80) : "")));
      if (ev.sessionId && session.sessionId !== ev.sessionId) { session.sessionId = ev.sessionId; syncHash(); }
      if (Array.isArray(ev.files) && ev.files.length) t.outputs = ev.files;
    } else if (evName === "error") {
      setStatus("错误: " + ev.message);
    }
  };
}

/** 流式收尾：清 running 态 + 刷新侧栏（run 结束/断开/停止共用）。
 *  仅当自己仍是活动流时才清状态——「切走→立刻切回」时 attach 可能已接管，
 *  旧流的 finally 不能把新 attach 的 sending/attachRunId 抹掉。 */
function finishLiveTurn(myAbort) {
  if (abort !== myAbort) return;
  abort = null;
  chat.sending = false;
  chat.attachRunId = null;
  refreshRuns().then(() => loadWorkspaces().catch(() => {}));
}

/** 组一条流式轮并放到 turns 尾部，返回深度代理引用 */
function pushLiveTurn({ user, ts, files }) {
  chat.turns.push({
    _id: "live-" + (++liveId),
    ts: ts || Date.now(),
    user: user || "",
    files: files || [],
    think: "",
    tools: [],
    text: "",
    fallbacks: [],
    violations: [],
    outputs: [],
    streaming: true,
  });
  // 关键：取回被 $state 深度代理后的引用再闭包使用，否则流式写入不触发 UI 更新
  const t = chat.turns[chat.turns.length - 1];
  chat.scrollTick++;
  return t;
}

/** 发送一条消息（SSE 流式） */
export async function send(text) {
  if (abort) { setStatus("上一条还在运行——可点「停止」或切换会话"); return; }
  text = String(text || "").trim();
  if (!text) return;

  const t = pushLiveTurn({
    user: text,
    files: ui.atts.map((a) => a.filename),
  });
  chat.sending = true;
  const myAbort = abort = new AbortController();
  try {
    await runChatStream({
      body: {
        ws: session.ws,
        message: text,
        sessionId: session.sessionId,
        mode: session.mode,
        attachments: ui.atts.map((a) => a.wsPath),
      },
      signal: myAbort.signal,
      onEvent(evName, ev) {
        if (evName === "start" && ev.runId) {
          chat.attachRunId = ev.runId; // 刷新后靠它 attach 续播
          refreshRuns();
        }
        makeStreamHandler(t)(evName, ev);
      },
    });
  } catch (e) {
    if (e.name === "AbortError") {
      if (unsubOnly) {
        unsubOnly = false; // 切换会话触发的退订：run 还在后台跑，不动 UI 状态
      } else {
        setStatus("已停止（上下文保留，可继续追问）");
        if (!t.text) t.text = "（已停止）";
      }
    } else {
      setStatus("错误: " + e.message);
      if (!t.text) t.text = "（出错：" + e.message + "）";
    }
  } finally {
    t.streaming = false;
    if (!t.text && !t.think && !t.tools.length) t.text = "（无输出）";
    finishLiveTurn(myAbort);
  }
}

/** 断线续播：attach 后台 run，把缓冲事件重放到目标轮 t 上。
 *  返回 true = 已接管（含已完结的重放）；false = run 不存在（服务端重启等）。
 *  返回 false 时 t 保持未污染状态，调用方负责回退（重放/移除占位轮）。 */
export async function attachRun(runId, t) {
  chat.sending = true;
  chat.attachRunId = runId;
  const myAbort = abort = new AbortController();
  try {
    await runChatStream({
      url: `/api/chat/attach?runId=${encodeURIComponent(runId)}`,
      signal: myAbort.signal,
      onEvent: makeStreamHandler(t),
    });
    return true;
  } catch (e) {
    if (e.name === "AbortError") {
      if (unsubOnly) unsubOnly = false;
      return true; // 用户停止/切走：按已处理算
    }
    if (!String(e.message).includes("404")) setStatus("恢复运行失败: " + e.message);
    return false;
  } finally {
    if (abort === myAbort) {
      t.streaming = false;
      if (!t.text && !t.think && !t.tools.length) t.text = "（无输出）";
      finishLiveTurn(myAbort);
    }
  }
}

/** 恢复某会话的后台运行：回放之后调用。找到该会话的 run 就续播；
 *  回放末尾若是本次提问（助手侧尚无内容）则并入流式轮，避免重复气泡。 */
export async function restoreRunningRun(sessionId) {
  await refreshRuns();
  const run = Object.values(runs.map).find((r) => r.sessionId === sessionId);
  if (!run) return false;
  const last = chat.turns[chat.turns.length - 1];
  let base = { user: run.message, ts: Date.now(), files: [] };
  if (last && last.seq != null && !last.text && !last.think && !(last.tools && last.tools.length) && !(last.outputs && last.outputs.length)) {
    base = { user: last.user || run.message, ts: last.ts, files: last.files };
    chat.turns.pop();
  }
  const t = pushLiveTurn(base);
  const ok = await attachRun(run.runId, t);
  if (!ok) await replay(sessionId); // run 在恢复间隙没了：重拉回放补全
  return true;
}
