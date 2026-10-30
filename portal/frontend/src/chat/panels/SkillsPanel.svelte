<script>
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { session } from "../../lib/stores/session.svelte.js";
  import { closePanel } from "../../lib/stores/ui.svelte.js";

  let skills = $state([]);
  let err = $state(""), ok = $state("");
  let fileInput;
  let loaded = $state(false);

  const tag = { global: "全局 · 管理员", project: "当前工作区" };

  async function refresh() {
    try {
      skills = (await api(`/api/skills?ws=${encodeURIComponent(session.ws)}`)).skills;
    } catch (e) { err = e.message; }
    loaded = true;
  }
  onMount(refresh);

  async function remove(s) {
    if (!confirm(`删除工作区技能 ${s.name}？`)) return;
    err = ""; ok = "";
    try {
      await api(`/api/skills/${s.name}?scope=project&ws=${encodeURIComponent(session.ws)}`, { method: "DELETE" });
      await refresh();
    } catch (e) { err = e.message; }
  }

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const name = f.name.replace(/.(zip|md)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-");
    err = ""; ok = `上传 ${f.name} …`;
    try {
      const r = await fetch(`/api/skills/upload?name=${encodeURIComponent(name)}&scope=project&ws=${encodeURIComponent(session.ws)}`, { method: "POST", body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      ok = `已完成：${j.name} 已上传到当前工作区`;
      await refresh();
    } catch (e2) { err = e2.message; }
    e.target.value = "";
  }
</script>

<h2>技能一览</h2>
<div class="sub">三层叠加：内核官方技能（全员共享）· 全局技能（管理员统一管理，只读）· 工作区技能（你可添加/删除，仅本工作区生效）</div>

{#if !loaded}
  <div class="kv-row"><span class="k">加载中…</span></div>
{:else if skills.length}
  {#each skills as s (s.name)}
    <div class="kv-row">
      <span class="k">{s.name}</span>
      <span class="v"><span class="pill" class:pill-ok={s.scope === "project"}>{tag[s.scope] || s.scope}</span>{#if !s.readonly}<a class="del" title="删除工作区技能" onclick={() => remove(s)}>×</a>{/if}</span>
    </div>
  {/each}
{:else}
  <div class="kv-row"><span class="k">还没有工作区技能</span><span class="v none">点下方按钮上传，zip 根层需含 SKILL.md</span></div>
{/if}

<div class="btn-row" style="margin-top:14px">
  <button onclick={() => fileInput.click()}>上传技能到当前工作区（zip 或 SKILL.md）</button>
  <input type="file" class="hidden" bind:this={fileInput} onchange={onFile} />
</div>
<div class="msg-err">{err}</div>
<div class="msg-ok">{ok}</div>
<div class="btn-row"><button class="ghost" onclick={closePanel}>关闭</button></div>

<style>
  .k{color:var(--muted)}
  .v{text-align:right;display:flex;align-items:center;gap:8px;justify-content:flex-end}
  .none{color:var(--muted)}
  .del{color:var(--negative);text-decoration:none;font-weight:600;cursor:pointer}
</style>
