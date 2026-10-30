<script>
  import { mdToHtml } from "../lib/md.js";

  let { raw = "" } = $props();
  let srcMode = $state(false);
</script>

<div class="out-block">
  {#if srcMode}
    <div class="md-body src">{raw}</div>
  {:else}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- mdToHtml 先整体转义再转换，见 lib/md.js -->
    <div class="md-body">{@html mdToHtml(raw)}</div>
  {/if}
  <button type="button" class="md-toggle" onclick={() => (srcMode = !srcMode)}>{srcMode ? "查看预览" : "查看源码"}</button>
</div>
