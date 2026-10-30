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

{#if session.me}
  <Shell />
{:else}
  <Gate />
{/if}
