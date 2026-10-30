<script>
  import { logout, newSession, session } from "../lib/stores/session.svelte.js";
  import { closeDrawer, openPanel, setStatus, ui } from "../lib/stores/ui.svelte.js";
  import SessionList from "./SessionList.svelte";

  const brandName = $derived(session.branding.appName || "ZCode 门户");
  const logoUrl = $derived(session.branding.logoUrl || "");
  const logoText = $derived(session.branding.logoText || "");
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
  <a class="nav-item" onclick={() => { closeDrawer(); openPanel("model"); }}>模型信息</a>
  <div class="mobile-mode">
    <div class="nav-sec">权限模式</div>
    <select bind:value={session.mode} aria-label="权限模式" onchange={() => { setStatus("权限模式已切换，下条消息生效"); closeDrawer(); }}>
      <option value="yolo">自动执行 · 可写入工作区</option>
      <option value="plan">只读规划 · 不改文件</option>
      <option value="guarded">谨慎模式 · 高危操作需确认</option>
    </select>
  </div>
  <div class="nav-sec">账号</div>
  <a class="nav-item" onclick={() => { closeDrawer(); openPanel("passwd"); }}>修改密码</a>
  <a class="nav-item" onclick={logout}>退出登录</a>
  <div class="foot">{session.me.username} · {session.me.uid.slice(0, 8)}</div>
</aside>
{#if ui.drawer}<div id="drawer-overlay" onclick={closeDrawer}></div>{/if}

<style>
  #sidebar{grid-row:1/3;background:var(--ground);padding:14px 12px;display:flex;flex-direction:column;gap:2px}
  .nav-item.on{background:var(--active);color:var(--text);font-weight:500}
  .drawer-head{display:flex;align-items:center}
  .drawer-head .brand{flex:1;min-width:0;padding:4px 10px 16px}
  .drawer-close{display:none;width:36px;height:36px;padding:0;place-items:center;flex:0 0 auto;color:var(--muted);font-size:16px}
  .foot{margin-top:auto;font-size:12px;color:var(--muted);padding:10px}
  #drawer-overlay{display:none}
  @media (max-width:768px){
    #sidebar{position:fixed;top:0;bottom:0;left:0;width:min(88vw,340px);z-index:80;transform:translateX(-105%);transition:transform .22s ease;padding:10px 12px calc(12px + env(safe-area-inset-bottom));overflow-y:auto;overscroll-behavior:contain;box-shadow:0 0 40px rgba(19,20,22,.18);grid-row:auto;grid-column:auto}
    #sidebar.open{transform:translateX(0)}
    #drawer-overlay{display:block;position:fixed;inset:0;z-index:70;background:rgba(19,20,22,.42)}
    .drawer-close{display:grid}
    .drawer-head .brand{padding:2px 6px 14px}
    .mobile-mode{display:block;padding:4px 4px 0}
    .mobile-mode select{font-size:16px;padding:9px 10px}
    .nav-sec{display:block;padding:14px 10px 5px}
    .foot{display:block}
  }
  .mobile-mode{display:none}
  @media (max-width:768px){
    .mobile-mode{display:block}
  }
</style>
