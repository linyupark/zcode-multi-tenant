import { api } from "../api.js";
import { runChatStream } from "../sse.js";
import { ui, setStatus } from "./ui.svelte.js";
import { session, loadWorkspaces } from "./session.svelte.js";

/** 聊天态：turns 统一承载回放轮与流式轮（streaming:true 表示正在生成）。
 *  轮结构：{ seq?, _id?, user, files, think, tools[], text, fallbacks[], streaming } */
export const chat = $state({
  turns: [],
  hasMore: false,
  beforeSeq: null,   // 「加载更早」游标
  loading: false,    // 回放加载中
  loadingEarlier: false,
  sending: false,    // 流式运行中（发送键 ↔ 停止键）
  primed: false,     // false = 登录后初始空态（「开始你的第一个任务」），true = 显式新会话/回放后
  scrollTick: 0,     // 递增 → ChatArea 强制滚底（回放/新轮）
});

let abort = null; // 模块内非响应式：仅 send/stop 使用
let liveId = 0;

export function chatBusy() { return !!abort || chat.sending; }

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

/** 停止当前运行（发送键变「停止」） */
export function stop() {
  if (abort) { try { abort.abort(); } catch { /* noop */ } }
}

/** 发送一条消息（SSE 流式）——移植自旧 sendMsg */
export async function send(text) {
  if (abort) { setStatus("上一条还在运行——可点「停止」或直接追问（会排队接续）"); return; }
  text = String(text || "").trim();
  if (!text) return;

  const raw = {
    _id: "live-" + (++liveId),
    user: text,
    files: ui.atts.map((a) => a.filename),
    think: "",
    tools: [],
    text: "",
    fallbacks: [],
    violations: [],
    outputs: [],
    streaming: true,
  };
  chat.turns.push(raw);
  // 关键：取回被 $state 深度代理后的引用再闭包使用，否则流式写入不触发 UI 更新
  const t = chat.turns[chat.turns.length - 1];
  chat.scrollTick++;
  chat.sending = true;

  abort = new AbortController();
  try {
    await runChatStream({
      body: {
        ws: session.ws,
        message: text,
        sessionId: session.sessionId,
        mode: session.mode,
        attachments: ui.atts.map((a) => a.wsPath),
      },
      signal: abort.signal,
      onEvent(evName, ev) {
        if (evName === "cli") {
          if (ev.sessionId) {
            if (session.sessionId !== ev.sessionId) session.sessionTitle = null;
            session.sessionId = ev.sessionId;
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
          if (ev.sessionId) session.sessionId = ev.sessionId;
          if (Array.isArray(ev.files) && ev.files.length) t.outputs = ev.files;
        } else if (evName === "error") {
          setStatus("错误: " + ev.message);
        }
      },
    });
    // 旧版 end 事件后刷新侧栏，让新会话条目出现并高亮
    if (session.sessionId) loadWorkspaces().catch(() => {});
  } catch (e) {
    if (e.name === "AbortError") {
      setStatus("已停止（上下文保留，可继续追问）");
      fetch("/api/chat/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
      if (!t.text) t.text = "（已停止）";
    } else {
      setStatus("错误: " + e.message);
      if (!t.text) t.text = "（出错：" + e.message + "）";
    }
  } finally {
    t.streaming = false;
    if (!t.text && !t.think && !t.tools.length) t.text = "（无输出）";
    abort = null;
    chat.sending = false;
  }
}
