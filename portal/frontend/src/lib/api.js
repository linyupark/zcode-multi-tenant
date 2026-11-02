/** 统一 JSON fetch：非 2xx 抛 Error(j.error || status)，与旧版 api() 行为一致。
 *  401（会话过期/未登录）→ 广播 auth:expired，由 App 切回登录页。 */
export async function api(p, opts = {}) {
  const r = await fetch(p, { headers: { "Content-Type": "application/json" }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new CustomEvent("auth:expired", { detail: { error: j.error } }));
    throw new Error(j.error || r.status);
  }
  return j;
}

/** 原始 fetch + JSON 解析错误（上传等二进制 body 场景用） */
export async function apiRaw(p, opts = {}) {
  const r = await fetch(p, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new CustomEvent("auth:expired", { detail: { error: j.error } }));
    throw new Error(j.error || r.status);
  }
  return j;
}
