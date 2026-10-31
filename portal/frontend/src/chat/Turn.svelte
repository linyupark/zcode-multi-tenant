<script>
  import MarkdownOut from "./MarkdownOut.svelte";
  import ThinkBlock from "./ThinkBlock.svelte";
  import FileCards from "./FileCards.svelte";
  import { toolIconClass } from "../lib/tools.js";

  let { t } = $props();

  // 一次只展开一个工具详情，再次点击收起（对齐旧 toggleToolDetail）
  let openTool = $state(-1);
  function toggleTool(i) {
    openTool = openTool === i ? -1 : i;
  }

  const showLoading = $derived(t.streaming && !t.text);
  const emptyTurn = $derived(
    !t.streaming && !t.text && !t.think && !t.tools?.length,
  );
</script>

{#if t.user}
  <div class="msg-row user">
    <div class="who">你</div>
    <div class="bubble">{t.user}{#if t.files?.length}<div class="msg-files">{#each t.files as f}<span class="file-chip" title="随消息附件">{typeof f === "string" ? f : f.filename}</span>{/each}</div>{/if}</div>
  </div>
{/if}
<div class="msg-row assistant">
  <div class="who">ZCode</div>
  <div class="bubble">
    {#if t.think}<ThinkBlock think={t.think} done={!t.streaming || !!t.text} />{/if}
    {#if t.tools?.length}
      <div class="tool-icons">
        {#each t.tools as tool, i (tool.callId || i)}
          <button type="button" class="tool-icon" class:on={openTool === i} title="{tool.name}{tool.brief ? " · " + tool.brief : ""}" onclick={() => toggleTool(i)}>
            <i class={toolIconClass(tool.name)}></i>
          </button>
        {/each}
      </div>
    {/if}
    {#if openTool >= 0 && t.tools[openTool]}
      {@const item = t.tools[openTool]}
      <div class="tool-detail">{item.name}{item.brief ? " — " + item.brief : ""}{"\n\n"}{item.detail || ""}</div>
    {/if}
    {#each t.fallbacks || [] as fb}
      <div class="fallback-note">模型 {fb.from} 调用失败，已自动切换到 {fb.to}{fb.reason ? `（${fb.reason.slice(0, 60)}）` : ""}</div>
    {/each}
    {#each t.violations || [] as v}
      <div class="violation-note">安全拦截（{v.tool}）：{v.message}。本次执行已终止，可调整需求后继续。</div>
    {/each}
    {#if t.text}<MarkdownOut raw={t.text} />{/if}
    {#if t.outputs?.length}<FileCards files={t.outputs} />{/if}
    {#if showLoading}
      <div class="loading-dots" aria-label="正在思考"><i></i><i></i><i></i></div>
    {/if}
    {#if emptyTurn}（这轮由后台子任务完成，无直接输出）{/if}
  </div>
</div>

<style>
  .msg-row{display:flex;flex-direction:column}
  .who{font-size:11.5px;color:var(--muted);margin-bottom:3px;padding:0 4px}
  .bubble{padding:10px 14px;white-space:pre-wrap;word-break:break-word;line-height:1.6;font-size:14px}
  /* user：右侧，自适应宽度（内容多宽气泡多宽，上限 78%） */
  .user{align-items:flex-end}
  .user .bubble{background:var(--accent);color:#fff;border-radius:14px 14px 3px 14px;max-width:78%;width:fit-content}
  /* assistant：左侧，铺满可用宽度（阅读型内容） */
  .assistant{align-items:flex-start}
  .assistant .bubble{background:var(--surface);border:1px solid var(--border);border-radius:3px 14px 14px 14px;width:100%;max-width:860px}
  .msg-files{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
  .file-chip{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.32);border-radius:6px;padding:2px 8px;font-size:12px;line-height:1.5}
  /* 工具调用图标条：紧凑，靠在思考块/文本之间 */
  .tool-icons{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 2px}
  .tool-icon{width:28px;height:28px;min-width:28px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--muted);display:grid;place-items:center;padding:0;cursor:pointer;font-size:14px}
  .tool-icon:hover{color:var(--accent);border-color:var(--accent)}
  .tool-icon.on{color:var(--accent);border-color:var(--accent);background:#eef7f9}
  .tool-detail{margin:0 0 10px;padding:8px 12px;background:var(--raised);border-radius:6px;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto}
  .fallback-note{margin:6px 0;padding:5px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e;white-space:normal}
  .violation-note{margin:6px 0;padding:5px 10px;background:#fdecec;border:1px solid #f5c2c4;border-radius:6px;font-size:12px;color:#8f1d22;white-space:normal}
  @media (max-width:768px){
    .user .bubble{max-width:88%}
    .assistant .bubble{border-radius:3px 12px 12px 12px}
    .bubble{font-size:14.5px;padding:9px 12px}
    .tool-icon{width:34px;height:34px;min-width:34px}
  }
</style>
