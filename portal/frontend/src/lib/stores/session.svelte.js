import { api } from "../api.js";
import { applyDocumentBranding } from "../branding.js";
import { ui, setStatus, closeDrawer, toast } from "./ui.svelte.js";
import { chat, runs, replay, clearChat, refreshRuns, restoreRunningRun, detachLive } from "./chat.svelte.js";

/** 会话态：登录账号 / 工作区 / 当前会话 / 权限模式 / 白标 */
export const session = $state({
  booted: false,        // 启动探测完成（true 后才渲染 Gate，避免已登录用户刷新闪登录页）
  me: null,             // /api/me 结果（uid/username/model/providers/mode/branding）
  branding: {},         // 公开 /api/branding（登录页也要用）
  workspaces: [],
  ws: null,
  sessionId: null,
  sessionTitle: null,
  soloDefault: false,   // 只有一个 default 工作区时，工作区层视为隐式容器
  sessions: [],         // 当前工作区会话列表
  mode: "yolo",
});

// —— URL hash 会话定位：#s=<sessionId>（ws 由会话归属决定，不冗余存）——
// 选中会话/新会话/流式中拿到新 sessionId 时都同步；刷新后 boot 据此恢复选中。

function readHash() {
  const m = (location.hash || "").match(/s=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function syncHash() {
  const want = session.sessionId ? `#s=${session.sessionId}` : "#new";
  if (location.hash !== want) {
    try { history.replaceState(null, "", want); } catch { /* 老浏览器忽略 */ }
  }
}

/** 启动：公开品牌 → 会话探测（未登录留在 Gate） */
export async function boot() {
  try {
    const b = await api("/api/branding");
    session.branding = b || {};
    applyDocumentBranding(b);
  } catch { /* 品牌接口失败用默认 */ }
  try {
    const me = await api("/api/me");
    adoptMe(me);
    session.booted = true; // 先亮出工作台，侧栏数据后台补齐
    await loadWorkspaces();
    await restoreFromHash(); // hash 带了会话 id → 恢复选中（可能带后台运行续播）
    refreshRuns(); // 侧栏转圈用（restoreFromHash 内部已查过时幂等）
  } catch {
    session.me = null;
    session.booted = true;
  }
}

/** 刷新恢复：hash 里有会话 id 就选中它；该会话仍有后台 run 则自动续播 */
async function restoreFromHash() {
  const sid = readHash();
  if (!sid || !session.sessions.some((s) => s.id === sid)) {
    if (sid) syncHash(); // 会话已不存在（被删/换号）：清掉失效 hash
    return;
  }
  session.ws = session.ws || "default";
  session.sessionId = sid;
  await replay(sid);
  syncHash();
  await restoreRunningRun(sid);
}

function adoptMe(me) {
  session.me = me;
  session.mode = me.mode || "yolo";
  if (me.branding) {
    session.branding = me.branding;
    applyDocumentBranding(me.branding);
  }
}

export async function login(username, password) {
  const me = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  session.me = me;
  const fresh = await api("/api/me").catch(() => null);
  if (fresh) adoptMe(fresh);
  await loadWorkspaces();
  syncHash(); // 清掉上一个账号残留的 #s=…（sessionId 已空 → 写成 #new）
}

export async function register(username, password, displayName) {
  const res = await api("/api/register", { method: "POST", body: JSON.stringify({ username, password, displayName }) });
  if (res.pending) return res; // 自注册待激活：不进入工作台
  session.me = res;
  const fresh = await api("/api/me").catch(() => null);
  if (fresh) adoptMe(fresh);
  await loadWorkspaces();
  syncHash();
  return res;
}

export async function logout() {
  await api("/api/logout", { method: "POST" });
  location.reload();
}

/** 加载工作区 + 当前工作区会话列表（旧 loadWorkspaces） */
export async function loadWorkspaces() {
  const { workspaces } = await api("/api/workspaces");
  if (!workspaces.length) await api("/api/workspaces", { method: "POST", body: JSON.stringify({ name: "default" }) }).catch(() => {});
  const list = workspaces.length ? workspaces : ["default"];
  session.workspaces = list;
  session.ws = session.ws && list.includes(session.ws) ? session.ws : list[0];
  // 只有一个 default 工作区时，把工作区层视为隐式容器，不渲染可点击的 default 行
  session.soloDefault = list.length === 1 && list[0] === "default";
  const { sessions } = await api(`/api/sessions?ws=${encodeURIComponent(session.ws)}`);
  session.sessions = sessions;
  const active = session.sessionId ? sessions.find((s) => s.id === session.sessionId) : null;
  if (active) session.sessionTitle = active.title || session.sessionTitle;
}

/** 切换工作区 / 选择会话 / 开新会话（旧 switchWs）。
 *  流式运行中切走：只断开本地订阅（detachLive），后台 run 继续跑；
 *  切回时 restoreRunningRun 会重新 attach 续播，不丢内容。 */
export async function selectWs(ws, sessionId, opts = {}) {
  if (session.sessionId !== sessionId || session.ws !== ws) detachLive();
  session.ws = ws;
  session.sessionId = sessionId;
  session.sessionTitle = sessionId ? (opts.title || null) : null;
  ui.atts = [];
  syncHash();
  if (sessionId && !opts.skipReplay) {
    await replay(sessionId);
    await restoreRunningRun(sessionId); // 该会话有后台 run（刷新前发起）→ 自动续播
  } else if (!sessionId) {
    clearChat();
  }
  loadWorkspaces().catch(() => {});
  refreshRuns();
}

/** 删除会话（侧栏 ×）。若该会话仍有后台 run，一并精准停止（只停这条）。 */
export async function deleteSession(sid) {
  try {
    await api(`/api/sessions/${sid}?ws=${encodeURIComponent(session.ws)}`, { method: "DELETE" });
    const run = Object.values(runs.map).find((r) => r.sessionId === sid);
    if (run) await api("/api/chat/stop", { method: "POST", body: JSON.stringify({ runId: run.runId }) }).catch(() => {});
    refreshRuns();
    if (session.sessionId === sid) {
      session.sessionId = null;
      session.sessionTitle = null;
      clearChat();
      syncHash();
    }
    await loadWorkspaces();
  } catch (e) {
    toast("删除失败: " + e.message);
  }
}

/** 新会话入口（侧栏唯一入口） */
export function newSession() {
  closeDrawer();
  selectWs(session.ws, null);
}
