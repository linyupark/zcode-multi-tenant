<script>
  let { think = "", done = false } = $props();

  let open = $state(false);
  let bodyEl;

  const label = $derived(done ? "已思考" : "思考 · " + lastLine(think));
  function lastLine(s) {
    const lines = String(s || "").trimEnd().split("\n");
    return lines[lines.length - 1].trim().slice(-60) || "…";
  }

  // 展开状态下流式增量自动滚到底
  $effect(() => {
    void think;
    if (open && bodyEl) bodyEl.scrollTop = 1e9;
  });
</script>

<details class="think" bind:open={open}>
  <summary><span class="tri">▶</span><span class="think-label">{label}</span></summary>
  <div class="think-body" bind:this={bodyEl}>{think}</div>
</details>

<style>
  .think{border:1px solid var(--rule);border-radius:8px;margin-bottom:4px;overflow:hidden;background:var(--raised)}
  summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:7px;padding:6px 12px;font-size:12.5px;color:var(--muted);user-select:none}
  summary::-webkit-details-marker{display:none}
  summary:hover{color:var(--text)}
  .tri{display:inline-block;transition:transform .15s;font-size:10px}
  .think[open] summary .tri{transform:rotate(90deg)}
  .think-body{padding:2px 14px 10px;font-size:12.5px;color:var(--muted);line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto}
</style>
