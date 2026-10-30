<script>
  import { ui } from "../lib/stores/ui.svelte.js";
</script>

{#if ui.dragDepth > 0}
  <div class="drop-overlay">松开即上传为附件</div>
{/if}

<style>
  .drop-overlay{position:fixed;inset:0;background:rgba(27,108,128,.12);border:2px dashed var(--accent);z-index:99;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:500;color:var(--accent);pointer-events:none}
</style>
