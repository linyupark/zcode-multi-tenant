<script>
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { api } from "../../lib/api.js";
  import { fmtSize } from "../../lib/fmt.js";
  import { session } from "../../lib/stores/session.svelte.js";
  import { closePanel } from "../../lib/stores/ui.svelte.js";

  let tree = $state(null); // null = 加载中
  let preview = $state(null); // {ws, rel}
  let previewData = $state(null); // {img} | {text}
  let previewEl;
  const openDirs = new SvelteSet();

  async function previewFile(rel) {
    preview = { ws: session.ws, rel };
    previewData = null;
    requestAnimationFrame(() => previewEl?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    const ext = rel.split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      previewData = { img: `/api/files/content?ws=${encodeURIComponent(session.ws)}&path=${encodeURIComponent(rel)}` };
    } else {
      try {
        const j = await api(`/api/files/content?ws=${encodeURIComponent(session.ws)}&path=${encodeURIComponent(rel)}`);
        previewData = { text: j.binary ? "（二进制文件，请下载查看）" : (j.text || "") };
      } catch (e) {
        previewData = { text: "（加载失败：" + e.message + "）" };
      }
    }
  }

  function download() {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = `/api/files/download?ws=${encodeURIComponent(preview.ws)}&path=${encodeURIComponent(preview.rel)}`;
    a.download = preview.rel.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  onMount(async () => {
    try {
      tree = (await api(`/api/files?ws=${encodeURIComponent(session.ws)}`)).tree;
    } catch {
      tree = [];
    }
  });
</script>

<h2>工作区文件 <span class="pill">{session.ws}</span></h2>
<div class="sub">AI 的产出物都在这里，点击预览，可下载保存到你自己的电脑</div>

<div class="file-tree">
  {#if tree === null}
    加载中…
  {:else if !tree.length}
    <div class="empty-tree">工作区还是空的——发消息让 AI 干活，产出物会出现在这里</div>
  {:else}
    {#snippet nodes(list, depth)}
      {#each list as n (n.name)}
        {#if n.type === "dir"}
          <div class="fdir" style="padding-left:{depth * 16}px" onclick={() => (openDirs.has(n.name) ? openDirs.delete(n.name) : openDirs.add(n.name))}>
            <span class="ftri">{openDirs.has(n.name) ? "▾" : "▸"}</span>{n.name}/
          </div>
          {#if openDirs.has(n.name)}
            {@render nodes(n.children || [], depth + 1)}
          {/if}
        {:else}
          <div style="padding-left:{depth * 16}px">
            <a class="fitem" onclick={() => previewFile(n.rel)}>{n.name}</a><span class="fsize">{fmtSize(n.size)}</span>
          </div>
        {/if}
      {/each}
    {/snippet}
    {@render nodes(tree, 0)}
  {/if}
</div>

{#if preview}
  <div class="file-preview" bind:this={previewEl}>
    <div class="fp-head">
      <b class="mono fp-name">{preview.rel}</b>
      <span class="fp-actions"><button class="ghost" onclick={download}>下载到本地</button><button class="ghost" onclick={() => (preview = null)}>收起</button></span>
    </div>
    {#if previewData?.img}
      <img class="fp-img" src={previewData.img} alt="" />
    {:else}
      <pre class="fp-text">{previewData ? previewData.text ?? "" : "加载中…"}</pre>
    {/if}
  </div>
{/if}

<div class="btn-row"><button class="ghost" onclick={closePanel}>关闭</button></div>

<style>
  .file-tree{max-height:46vh;overflow-y:auto;font-size:13px}
  .fdir{color:var(--text);padding:3px 0;cursor:pointer;user-select:none}
  .fdir:hover{color:var(--accent)}
  .ftri{display:inline-block;width:14px;color:var(--muted);font-size:10px}
  .fitem{color:var(--accent);text-decoration:none;padding:3px 0;display:inline-block;cursor:pointer}
  .fitem:hover{text-decoration:underline}
  .fsize{color:var(--muted);font-size:11.5px;margin-left:6px}
  .empty-tree{color:var(--muted);padding:24px;text-align:center}
  .file-preview{margin-top:14px;border-top:1px solid var(--border);padding-top:14px}
  .fp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px}
  .fp-name{font-size:12.5px}
  .fp-img{max-width:100%;max-height:300px;border-radius:var(--radius-card)}
  .fp-text{max-height:300px;overflow:auto;background:var(--raised);border-radius:var(--radius-card);padding:12px;font-family:"IBM Plex Mono",monospace;font-size:12px;white-space:pre-wrap}
  @media (max-width:768px){
    .file-tree{max-height:38vh}
    .fp-head{flex-wrap:wrap;gap:6px}
    .fp-name{flex:1 1 100%;min-width:0;overflow-wrap:anywhere;margin-bottom:2px}
    .fp-actions{width:100%}
    .fp-actions button{flex:1;min-width:0;white-space:nowrap;min-height:38px}
    .fp-img{max-height:32vh}
    .fp-text{max-height:32vh;font-size:12px}
  }
</style>
