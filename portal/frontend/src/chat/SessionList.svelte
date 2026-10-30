<script>
  import { deleteSession, selectWs, session } from "../lib/stores/session.svelte.js";
  import { closeDrawer } from "../lib/stores/ui.svelte.js";

  function pickSession(s) {
    closeDrawer();
    selectWs(session.ws, s.id, { title: s.title || "" });
  }
  function pickWs(w) {
    closeDrawer();
    selectWs(w, null);
  }
  function remove(s, e) {
    e.stopPropagation();
    if (!confirm("删除这个会话？（历史不再可见，工作区文件不受影响）")) return;
    deleteSession(s.id);
  }
</script>

<div id="ws-list">
  {#each session.workspaces as w (w)}
    {@const wsActive = w === session.ws && !session.sessionId}
    {#if !session.soloDefault}
      <a class="nav-item" class:on={wsActive} onclick={() => pickWs(w)}>
        {#if wsActive}<span class="dot"></span>{/if}{w}
      </a>
    {/if}
    {#if w === session.ws}
      {#each session.sessions as s (s.id)}
        <div class="sess-item" class:on={s.id === session.sessionId} title={s.title || s.id} onclick={() => pickSession(s)}>
          {#if s.id === session.sessionId}<span class="dot"></span>{/if}
          <span class="t">{s.title || s.id.slice(0, 18) + "…"}</span>
          <a class="del" title="删除会话" onclick={(e) => remove(s, e)}>×</a>
        </div>
      {:else}
        <div class="sess-empty">暂无会话</div>
      {/each}
    {/if}
  {/each}
</div>

<style>
  .sess-item.on{background:var(--active);color:var(--text)}
  .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .del{opacity:0;color:var(--negative);text-decoration:none;font-weight:700;padding:0 4px;flex:0 0 auto;line-height:1;cursor:pointer}
  .sess-item:hover .del{opacity:1}
  .sess-empty{padding:4px 10px 4px 22px;font-size:12px;color:var(--muted)}
  @media (max-width:768px){
    .sess-item{min-height:40px;font-size:13.5px;padding:9px 10px}
    .del{opacity:1;padding:6px 10px;margin:-6px -6px -6px 0;font-size:15px}
  }
  @media (hover:none){
    .del{opacity:1}
  }
</style>
