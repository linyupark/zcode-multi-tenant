<script>
  import { session } from "../lib/stores/session.svelte.js";
  import { toggleDrawer } from "../lib/stores/ui.svelte.js";
</script>

<header id="topbar">
  <button class="ghost menu" aria-label="打开菜单" aria-controls="sidebar" onclick={toggleDrawer}>
    <i class="i-lucide-menu"></i>
  </button>
  <span class="crumb">
    {#if session.sessionId}
      <span class="crumb-prefix">{"工作区 / "}</span><b>{session.sessionTitle || "新会话"}</b>
    {:else if session.soloDefault}
      <span class="crumb-prefix"></span><b>工作区</b>
    {:else}
      <span class="crumb-prefix">{"工作区 / "}</span><b>{session.ws}</b>
    {/if}
  </span>
  <span class="spacer"></span>
  <select bind:value={session.mode} title="权限模式：控制 AI 能对工作区做什么" aria-label="权限模式">
    <option value="yolo">自动执行 · 可写入工作区</option>
    <option value="plan">只读规划 · 不改文件</option>
    <option value="guarded">谨慎模式 · 高危操作需确认</option>
  </select>
</header>

<style>
  #topbar{grid-column:2;background:var(--ground);display:flex;align-items:center;gap:12px;padding:0 var(--pad)}
  .crumb{color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crumb b{color:var(--text);font-weight:500}
  .spacer{flex:1}
  select{width:auto;padding:4px 8px;font-size:13px}
  .menu{display:none;width:38px;height:38px;padding:0;place-items:center;flex:0 0 auto;color:var(--text);font-size:18px}
  .menu:hover{background:var(--raised)}
  @media (max-width:768px){
    #topbar{grid-column:1;grid-row:1;padding:0 10px;gap:8px;background:var(--surface);border-bottom:1px solid var(--border)}
    .menu{display:grid;width:40px;height:40px}
    .crumb{flex:1;font-size:13.5px}
    .crumb-prefix{display:none}
    .spacer{display:none}
    select{display:none}
  }
</style>
