<script>
  import { fmtSize } from "../lib/fmt.js";
  import { iconForFile } from "../lib/files.js";
  import { session } from "../lib/stores/session.svelte.js";
  import { openPanel, ui } from "../lib/stores/ui.svelte.js";

  let { files = [] } = $props();

  const srcUrl = (f) => `/api/files/content?ws=${encodeURIComponent(session.ws)}&path=${encodeURIComponent(f.path)}`;
  const dlUrl = (f) => `/api/files/download?ws=${encodeURIComponent(session.ws)}&path=${encodeURIComponent(f.path)}`;

  // 点卡片 → 打开文件面板并直接预览该文件
  function openPreview(f) {
    if (!f.exists) return;
    ui.pendingPreview = f.path;
    openPanel("files");
  }
</script>

{#if files.length}
  <div class="file-cards">
    {#each files as f (f.path)}
      <div class="file-card" class:missing={!f.exists} role="button" tabindex="0"
        onclick={() => openPreview(f)}
        onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openPreview(f)}>
        {#if f.image && f.exists}
          <img class="thumb" src={srcUrl(f)} alt={f.filename} loading="lazy" />
        {:else}
          <span class="icon"><i class={iconForFile(f.filename)}></i></span>
        {/if}
        <span class="meta">
          <span class="name" title={f.path}>{f.filename}</span>
          <span class="sub">{f.exists ? (f.size != null ? fmtSize(f.size) : "已生成") : "已不在工作区"}</span>
        </span>
        {#if f.exists}
          <a class="dl" href={dlUrl(f)} download={f.filename} title="下载到本地" onclick={(e) => e.stopPropagation()}>
            <i class="i-lucide-download"></i>
          </a>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .file-cards{display:flex;flex-direction:column;gap:6px;margin-top:10px}
  .file-card{
    display:flex;align-items:center;gap:10px;
    background:var(--raised);border-radius:8px;padding:8px 10px;
    cursor:pointer;user-select:none;max-width:420px;
  }
  .file-card:hover{background:var(--active)}
  .file-card.missing{opacity:.55;cursor:default}
  .thumb{width:40px;height:40px;object-fit:cover;border-radius:6px;flex:0 0 auto;background:var(--surface)}
  .icon{width:40px;height:40px;border-radius:6px;background:var(--surface);display:grid;place-items:center;font-size:20px;color:var(--muted);flex:0 0 auto}
  .meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
  .name{font-size:13px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sub{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .dl{
    width:30px;height:30px;border-radius:6px;flex:0 0 auto;
    display:grid;place-items:center;font-size:15px;
    color:var(--muted);background:var(--surface);border:1px solid var(--control);
    text-decoration:none;
  }
  .dl:hover{color:var(--accent);border-color:var(--accent)}
</style>
