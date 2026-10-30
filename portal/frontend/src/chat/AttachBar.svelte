<script>
  import { ui } from "../lib/stores/ui.svelte.js";
</script>

{#if ui.atts.length}
  <div class="attach-bar">
    <span class="hint">随消息发送：</span>
    {#each ui.atts as a, i (a.wsPath)}
      <span class="att">{a.filename}<a onclick={() => ui.atts.splice(i, 1)}>×</a></span>
    {/each}
  </div>
{/if}

<style>
  .attach-bar{padding:8px var(--pad);background:var(--raised);border-top:1px solid var(--rule);display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12.5px}
  .hint{color:var(--muted)}
  .att{background:var(--surface);border:1px solid var(--control);border-radius:6px;padding:2px 9px;display:flex;gap:6px;align-items:center}
  .att a{color:var(--negative);text-decoration:none;font-weight:600;cursor:pointer}
  @media (max-width:768px){
    .attach-bar{padding:8px 12px}
  }
</style>
