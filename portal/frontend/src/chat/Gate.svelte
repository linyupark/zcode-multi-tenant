<script>
  import { login, register, session } from "../lib/stores/session.svelte.js";

  let { notice = "" } = $props();

  let tab = $state("login");
  let liUser = $state(""), liPass = $state(""), liErr = $state(""), ownNotice = $state("");
  let rgUser = $state(""), rgDisplay = $state(""), rgPass = $state(""), rgErr = $state("");

  const brandName = $derived(session.branding.appName || "ZCode 门户");
  const tagline = $derived(session.branding.tagline || "独立工作区 · 官方内核与全局技能共享");
  const logoUrl = $derived(session.branding.logoUrl || "");
  const logoText = $derived(session.branding.logoText || "");
  // liNotice：外部提示（过期/待激活回执）优先，登录结果可直接覆盖
  const liNotice = $derived(ownNotice || notice);

  async function doLogin() {
    liErr = "";
    ownNotice = "";
    try { await login(liUser, liPass); } catch (e) { liErr = e.message; }
  }
  async function doRegister() {
    rgErr = "";
    try {
      const r = await register(rgUser, rgPass, rgDisplay);
      if (r?.pending) {
        // 自注册账号默认待激活：提示后切到登录页
        rgUser = rgDisplay = rgPass = "";
        ownNotice = r.message || "注册成功，账号需管理员激活后才能登录，请联系管理员";
        liUser = "";
        tab = "login";
      }
    } catch (e) { rgErr = e.message; }
  }
</script>

<div class="gate">
  <div class="box">
    <div class="brand">
      <span class="mark">
        {#if logoUrl}<img src={logoUrl} alt="logo" />{:else}{logoText || "Z"}{/if}
      </span>
      <span class="name">{brandName}</span>
    </div>
    <h1>登录你的工作台</h1>
    <div class="sub">{tagline}</div>
    <div class="tabs">
      <a class:on={tab === "login"} onclick={() => (tab = "login")}>登录</a><a class:on={tab === "register"} onclick={() => (tab = "register")}>注册</a>
    </div>
    {#if tab === "login"}
      <form onsubmit={(e) => { e.preventDefault(); doLogin(); }}>
        <div class="field"><label class="field-label" for="li-user">用户名</label><input id="li-user" autocomplete="username" bind:value={liUser} /></div>
        <div class="field"><label class="field-label" for="li-pass">密码</label><input id="li-pass" type="password" autocomplete="current-password" bind:value={liPass} /></div>
        <div class="msg-err">{liErr}</div>
        {#if liNotice}<div class="msg-ok">{liNotice}</div>{/if}
        <button style="width:100%">登录</button>
      </form>
    {:else}
      <form onsubmit={(e) => { e.preventDefault(); doRegister(); }}>
        <div class="field"><label class="field-label" for="rg-user">用户名（3-32 位字母数字_-）</label><input id="rg-user" bind:value={rgUser} /></div>
        <div class="field"><label class="field-label" for="rg-display">显示名（可选）</label><input id="rg-display" bind:value={rgDisplay} /></div>
        <div class="field"><label class="field-label" for="rg-pass">密码（至少 6 位）</label><input id="rg-pass" type="password" bind:value={rgPass} /></div>
        <div class="msg-err">{rgErr}</div>
        <div class="hint-line">注册后账号为待激活状态，需管理员在后台开通后方可登录</div>
        <button style="width:100%">创建账号</button>
      </form>
    {/if}
  </div>
</div>

<style>
  .gate {
    min-height: 100vh; min-height: var(--app-h, 100dvh);
    display: grid; place-items: center; background: var(--ground); overflow: auto;
  }
  .box {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sheet);
    padding: 32px; width: 380px;
  }
  h1 { font-size: var(--fs-title); font-weight: 600; margin: 18px 0 2px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .hint-line { color: var(--muted); font-size: 12px; margin: 4px 0 2px; }
  @media (max-width: 768px) {
    .gate { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); height: var(--app-h, 100dvh); min-height: 0; overflow-y: auto; }
    .box { width: 100%; max-width: 420px; padding: 24px; border-radius: 16px; }
  }
</style>
