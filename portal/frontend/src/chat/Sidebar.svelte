<script>
  import { logout, newSession, session } from "../lib/stores/session.svelte.js";
  import { closeDrawer, openPanel, setStatus, ui } from "../lib/stores/ui.svelte.js";
  import SessionList from "./SessionList.svelte";

  const brandName = $derived(session.branding.appName || "ZCode 门户");
  const logoUrl = $derived(session.branding.logoUrl || "");
  const logoText = $derived(session.branding.logoText || "");

  // 移动端权限模式单选（与桌面顶栏下拉共用 session.mode，自动双向同步）
  const MODES = [
    { id: "yolo", label: "自动执行 · 可写入" },
    { id: "plan", label: "只读规划 · 不改文件" },
    { id: "guarded", label: "谨慎模式 · 高危需确认" },
  ];
</script>

<aside id="sidebar" class:open={ui.drawer}>
  <div class="drawer-head">
    <div class="brand">
      <span class="mark">{#if logoUrl}<img src={logoUrl} alt="logo" />{:else}{logoText || "Z"}{/if}</span>
      <span><span class="name">{brandName}</span></span>
    </div>
    <button class="ghost drawer-close" aria-label="关闭菜单" onclick={closeDrawer}><i class="i-lucide-x"></i></button>
  </div>
  <div class="nav-sec">工作区</div>
  <a class="nav-item" class:on={!session.sessionId} onclick={newSession}>
    {#if !session.sessionId}<span class="dot"></span>{/if}新会话
  </a>
  <SessionList />
  <div class="nav-sec">资源</div>
  <a class="nav-item" onclick={() => { closeDrawer(); openPanel("files"); }}>工作区文件</a>
  <a class="nav-item" onclick={() => { closeDrawer(); openPanel("skills"); }}>技能一览</a>
  <div class="mobile-mode">
    <div class="nav-sec">权限模式</div>
    <div class="mode-list" role="radiogroup" aria-label="权限模式">
      {#each MODES as m (m.id)}
        <button class="mode-item" class:on={session.mode === m.id} role="radio" aria-checked={session.mode === m.id}
          onclick={() => { session.mode = m.id; setStatus("权限模式已切换，下条消息生效"); closeDrawer(); }}>
          <span class="dot" class:on={session.mode === m.id}></span>
          <span class="mode-label">{m.label}</span>
        </button>
      {/each}
    </div>
  </div>
  <div class="foot">
    <span class="foot-name" title={session.me.username}>{session.me.displayName || session.me.username}</span>
    <button class="foot-btn" title="退出登录" aria-label="退出登录" onclick={logout}>
      <i class="i-lucide-log-out"></i>
    </button>
    <button class="foot-btn" title="修改密码" aria-label="修改密码" onclick={() => { closeDrawer(); openPanel("passwd"); }}>
      <i class="i-lucide-key-round"></i>
    </button>
  </div>
</aside>
{#if ui.drawer}<div id="drawer-overlay" onclick={closeDrawer}></div>{/if}

<style>
  #sidebar{grid-row:1/3;background:var(--ground);padding:14px 12px;display:flex;flex-direction:column;gap:2px}
  .nav-item.on{background:var(--active);color:var(--text);font-weight:500}
  .drawer-head{display:flex;align-items:center}
  .drawer-head .brand{flex:1;min-width:0;padding:4px 10px 16px}
  .drawer-close{display:none;width:36px;height:36px;padding:0;place-items:center;flex:0 0 auto;color:var(--muted);font-size:16px}
  .foot{margin-top:auto;display:flex;align-items:center;gap:2px;padding:8px 6px}
  .foot-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--muted)}
  .foot-btn{width:30px;height:30px;border-radius:6px;display:grid;place-items:center;font-size:15px;color:var(--muted);background:none;border:0;cursor:pointer;flex:0 0 auto}
  .foot-btn:hover{background:var(--raised);color:var(--accent)}
  #drawer-overlay{display:none}
  /* 移动端权限模式：小字单选行（替代原生下拉） */
  .mode-list{display:flex;flex-direction:column;gap:2px;padding:0 4px}
  .mode-item{
    display:flex;align-items:center;gap:9px;width:100%;height:34px;
    padding:0 10px;border-radius:6px;border:0;background:none;
    font:inherit;font-size:13px;color:var(--muted);cursor:pointer;text-align:left;
  }
  .mode-item.on{background:var(--raised);color:var(--text)}
  .mode-item .dot{width:7px;height:7px;border-radius:99px;background:var(--control);flex:0 0 auto}
  .mode-item.on .dot{background:var(--accent)}
  .mode-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media (max-width:768px){
    #sidebar{position:fixed;top:0;bottom:0;left:0;width:min(88vw,340px);z-index:80;transform:translateX(-105%);transition:transform .22s ease;padding:10px 12px calc(12px + env(safe-area-inset-bottom));overflow-y:auto;overscroll-behavior:contain;box-shadow:0 0 40px rgba(19,20,22,.18);grid-row:auto;grid-column:auto}
    #sidebar.open{transform:translateX(0)}
    #drawer-overlay{display:block;position:fixed;inset:0;z-index:70;background:rgba(19,20,22,.42)}
    .drawer-close{display:grid}
    .drawer-head .brand{padding:2px 6px 14px}
    .mobile-mode{display:block;padding:4px 4px 0}
    .nav-sec{display:block;padding:14px 10px 5px}
  }
  .mobile-mode{display:none}
  @media (max-width:768px){
    .mobile-mode{display:block}
  }
</style>
