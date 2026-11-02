<script>
  import { onMount } from "svelte";
  import { installAppHeight } from "../lib/appHeight.js";
  import { boot, session } from "../lib/stores/session.svelte.js";
  import { ui, closeDrawer } from "../lib/stores/ui.svelte.js";
  import Gate from "./Gate.svelte";
  import Shell from "./Shell.svelte";

  let expiredNotice = $state("");

  // 任何接口 401（会话过期/被禁用）→ 清会话态回登录页，带一条提示
  function onAuthExpired(e) {
    session.booted = true;
    session.me = null;
    session.workspaces = [];
    session.sessions = [];
    session.sessionId = null;
    session.sessionTitle = null;
    ui.atts = [];
    ui.panel = null;
    ui.drawer = false;
    expiredNotice = "登录已过期，请重新登录" + (e?.detail?.error && e.detail.error !== "未登录" ? `（${e.detail.error}）` : "");
  }

  onMount(() => {
    const disposeHeight = installAppHeight();
    window.addEventListener("auth:expired", onAuthExpired);
    boot();
    return () => {
      disposeHeight();
      window.removeEventListener("auth:expired", onAuthExpired);
    };
  });

  function onResize() {
    if (window.innerWidth > 768 && ui.drawer) closeDrawer();
  }
  function onKeydown(e) {
    if (e.key === "Escape" && ui.drawer) closeDrawer();
  }
</script>

<svelte:window onresize={onResize} onkeydown={onKeydown} />

{#if !session.booted}
  <div class="boot">
    <span class="mark">{session.branding.logoText || "Z"}</span>
  </div>
{:else if session.me}
  <Shell />
{:else}
  <Gate notice={expiredNotice} />
{/if}

<style>
  .boot{min-height:100vh;display:grid;place-items:center;background:var(--ground)}
  .mark{
    width:34px;height:34px;border-radius:8px;background:var(--accent);color:#fff;
    display:grid;place-items:center;font-weight:600;font-size:16px;
  }
</style>
