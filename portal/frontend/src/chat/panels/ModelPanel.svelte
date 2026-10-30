<script>
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { closePanel } from "../../lib/stores/ui.svelte.js";

  let me = $state(null);
  let err = $state("");

  onMount(async () => {
    try { me = await api("/api/me"); } catch (e) { err = e.message; }
  });
</script>

<h2>模型信息</h2>
<div class="sub">由管理员统一配置，无需也不可自行修改</div>

{#if err}<div class="msg-err">{err}</div>{/if}
{#if me}
  {@const provs = Object.entries(me.providers || {})}
  {#if provs.length}
    {#each provs as [id, p] (id)}
      <div class="kv-row">
        <span class="k">{p.name || id} <span class="pill">{p.kind}</span></span>
        <span class="v">密钥{#if p.hasKey}<span class="pill pill-ok">已配置</span>{:else}<span class="pill">未配置</span>{/if}<br>
          <span class="url">{p.baseURL || "—"}</span><br>
          当前模型 <b>{me.model || "（未设置）"}</b></span>
      </div>
    {/each}
  {:else}
    <div class="kv-row"><span class="k">管理员尚未配置模型</span><span class="v">请联系管理员在 /admin 后台完成配置</span></div>
  {/if}
{/if}

<div class="btn-row"><button class="ghost" onclick={closePanel}>关闭</button></div>

<style>
  .k{color:var(--muted)}
  .v{text-align:right}
  .url{color:var(--muted);font-size:12.5px}
</style>
