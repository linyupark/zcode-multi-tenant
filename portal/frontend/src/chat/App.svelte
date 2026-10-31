<script>
  import { onMount } from "svelte";
  import { installAppHeight } from "../lib/appHeight.js";
  import { boot, session } from "../lib/stores/session.svelte.js";
  import { ui, closeDrawer } from "../lib/stores/ui.svelte.js";
  import Gate from "./Gate.svelte";
  import Shell from "./Shell.svelte";

  onMount(() => {
    const disposeHeight = installAppHeight();
    boot();
    return disposeHeight;
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
  <Gate />
{/if}

<style>
  .boot{min-height:100vh;display:grid;place-items:center;background:var(--ground)}
  .mark{
    width:34px;height:34px;border-radius:8px;background:var(--accent);color:#fff;
    display:grid;place-items:center;font-weight:600;font-size:16px;
  }
</style>
