<script>
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { api } from "../../lib/api.js";
  import { fmtSize } from "../../lib/fmt.js";
  import { iconForFile, isImage } from "../../lib/files.js";
  import { session } from "../../lib/stores/session.svelte.js";
  import { closePanel, hasAtt, toggleAtt, ui } from "../../lib/stores/ui.svelte.js";

  let tree = $state(null); // null = 加载中
  let preview = $state(null); // {ws, rel}
  let previewData = $state(null); // {img} | {text}
  let previewEl = $state(null); // bind:this 在 {#if} 条件块内，反复赋值需 $state（non_reactive_update）
  let reloadTick = $state(0);
  const openDirs = new SvelteSet();

  const srcUrl = (f) => `/api/files/content?ws=${encodeURIComponent(f.ws)}&path=${encodeURIComponent(f.rel)}`;

  async function loadTree() {
    tree = null;
    preview = null;
    previewData = null;
    openDirs.clear();
    try {
      tree = (await api(`/api/files?ws=${encodeURIComponent(session.ws)}`)).tree;
    } catch {
      tree = [];
    }
  }

  async function previewFile(rel) {
    preview = { ws: session.ws, rel };
    previewData = null;
    requestAnimationFrame(() => previewEl?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    const ext = rel.split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      previewData = { img: srcUrl({ ws: session.ws, rel }) };
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
    await loadTree();
    // 从消息产出卡片点进来：直接预览指定文件
    if (ui.pendingPreview) {
      const rel = ui.pendingPreview;
      ui.pendingPreview = null;
      previewFile(rel);
    }
  });
</script>

<div class="head-row">
  <h2>工作区文件 <span class="pill">{session.ws}</span></h2>
  <span class="head-actions">
    <button class="ghost icon-btn" title="刷新文件列表" aria-label="刷新文件列表" onclick={loadTree}>
      <i class="i-lucide-refresh-cw"></i>
    </button>
    <button class="ghost icon-btn" title="关闭" aria-label="关闭" onclick={closePanel}>
      <i class="i-lucide-x"></i>
    </button>
  </span>
</div>
<div class="sub">AI 的产出物都在这里，点击预览；回形针把文件引入对话作为附件</div>

<div class="tree">
  {#if tree === null}
    <div class="empty-tree">加载中…</div>
  {:else if !tree.length}
    <div class="empty-tree">工作区还是空的——发消息让 AI 干活，产出物会出现在这里</div>
  {:else}
    {#snippet nodes(list, depth)}
      {#each list as n (n.name)}
        {#if n.type === "dir"}
          {@const open = openDirs.has(n.name)}
          <div class="row dir" style="padding-left:{10 + depth * 18}px" role="button" tabindex="0"
            onclick={() => (openDirs.has(n.name) ? openDirs.delete(n.name) : openDirs.add(n.name))}
            onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (openDirs.has(n.name) ? openDirs.delete(n.name) : openDirs.add(n.name))}>
            <i class="tri" class:open><i class="i-lucide-chevron-right"></i></i>
            <i class="fi"><i class={open ? "i-lucide-folder-open" : "i-lucide-folder"}></i></i>
            <span class="nm">{n.name}</span>
            <span class="cnt">{(n.children || []).length} 项</span>
          </div>
          {#if open}
            {@render nodes(n.children || [], depth + 1)}
          {/if}
        {:else}
          <div class="row" style="padding-left:{10 + depth * 18}px" role="button" tabindex="0"
            onclick={() => previewFile(n.rel)}
            onkeydown={(e) => e.key === "Enter" && previewFile(n.rel)}>
            <i class="fi" class:img={isImage(n.name)}><i class={iconForFile(n.name)}></i></i>
            <span class="nm">{n.name}</span>
            <span class="sz">{fmtSize(n.size)}</span>
            <button class="att-btn" class:on={hasAtt(n.rel)} title={hasAtt(n.rel) ? "已引入对话，点击移除" : "引入到对话框作为附件"}
              aria-label={hasAtt(n.rel) ? "移除附件" : "引入到对话框"}
              onclick={(e) => { e.stopPropagation(); toggleAtt(n.rel, n.name); }}>
              <i class="i-lucide-paperclip"></i>
            </button>
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
      <span class="fp-actions">
        <button class="ghost" class:attached={hasAtt(preview.rel)} onclick={() => toggleAtt(preview.rel, preview.rel.split("/").pop())}>
          {hasAtt(preview.rel) ? "已引入对话" : "引入对话"}
        </button>
        <button class="ghost" onclick={download}>下载到本地</button>
        <button class="ghost" onclick={() => (preview = null)}>收起</button>
      </span>
    </div>
    {#if previewData?.img}
      <img class="fp-img" src={previewData.img} alt={preview.rel} />
    {:else}
      <pre class="fp-text">{previewData ? previewData.text ?? "" : "加载中…"}</pre>
    {/if}
  </div>
{/if}

<style>
  /* 吸顶头部：滚动长列表时右上角的关闭/刷新按钮始终可见 */
  .head-row{
    position:sticky;top:-24px;z-index:2;
    margin:-24px -24px 10px;padding:18px 24px 10px;
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    background:var(--surface);border-radius:var(--radius-sheet) var(--radius-sheet) 0 0;
  }
  .head-row h2{display:flex;align-items:center;gap:8px}
  .head-actions{display:flex;gap:6px;flex:0 0 auto}
  .icon-btn{width:32px;height:32px;padding:0;display:grid;place-items:center;font-size:15px;color:var(--muted)}
  .icon-btn:hover{color:var(--accent)}
  /* 文件树：色调分层行，无细线；悬停浅一度 */
  .tree{max-height:46vh;overflow-y:auto;font-size:13.5px;margin:0 -6px;padding:0 6px}
  .row{
    display:flex;align-items:center;gap:8px;height:34px;
    padding-right:8px;border-radius:6px;cursor:pointer;user-select:none;
    color:var(--text);
  }
  .row:hover{background:var(--raised)}
  .row.dir{font-weight:500}
  .tri{display:inline-flex;font-size:12px;color:var(--muted);transition:transform .15s;flex:0 0 auto}
  .tri.open{transform:rotate(90deg)}
  .fi{display:inline-flex;font-size:16px;color:var(--muted);flex:0 0 auto}
  .fi.img{color:var(--accent)}
  .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row:hover .nm{color:var(--accent)}
  .cnt,.sz{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;flex:0 0 auto}
  /* 引入对话（回形针）：点击加入待发送附件，再点移除 */
  .att-btn{
    width:26px;height:26px;border-radius:6px;flex:0 0 auto;
    display:grid;place-items:center;font-size:13px;
    color:var(--muted);background:transparent;border:0;cursor:pointer;
  }
  .att-btn:hover{background:var(--active);color:var(--accent)}
  .att-btn.on{color:var(--accent);background:var(--raised)}
  .empty-tree{color:var(--muted);padding:24px;text-align:center}
  .file-preview{margin-top:14px;border-top:1px solid var(--border);padding-top:14px}
  .fp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px}
  .fp-name{font-size:12.5px}
  .fp-actions button.attached{border-color:var(--accent);color:var(--accent)}
  .fp-img{max-width:100%;max-height:44vh;border-radius:var(--radius-card)}
  .fp-text{max-height:300px;overflow:auto;background:var(--raised);border-radius:var(--radius-card);padding:12px;font-family:"IBM Plex Mono",monospace;font-size:12px;white-space:pre-wrap}
  @media (max-width:768px){
    .head-row{top:-18px;margin:-18px -16px 8px;padding:22px 16px 8px;border-radius:0}
    .tree{max-height:38vh}
    .att-btn{width:34px;height:34px;font-size:15px}
    .fp-head{flex-wrap:wrap;gap:6px}
    .fp-name{flex:1 1 100%;min-width:0;overflow-wrap:anywhere;margin-bottom:2px}
    .fp-actions{width:100%}
    .fp-actions button{flex:1;min-width:0;white-space:nowrap;min-height:38px}
    .fp-img{max-height:32vh}
    .fp-text{max-height:32vh;font-size:12px}
  }
</style>
