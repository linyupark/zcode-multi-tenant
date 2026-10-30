<script>
  import { chat, loadEarlier } from "../lib/stores/chat.svelte.js";
  import { session } from "../lib/stores/session.svelte.js";
  import Turn from "./Turn.svelte";

  let chatEl;
  let lastTick = -1;

  // 智能跟随：强制滚底仅由 scrollTick（回放/新轮）触发；流式增量仅距底部 <120px 时跟随
  $effect(() => {
    const tick = chat.scrollTick;
    const n = chat.turns.length;
    const last = chat.turns[n - 1];
    void last?.text;
    void last?.think;
    void last?.tools?.length;
    void last?.fallbacks?.length;
    if (!chatEl) return;
    if (tick !== lastTick) {
      lastTick = tick;
      chatEl.scrollTop = 1e9;
    } else {
      const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
      if (nearBottom) chatEl.scrollTop = chatEl.scrollHeight;
    }
  });
</script>

<div id="chat" bind:this={chatEl}>
  {#if chat.loading}
    <div class="chat-empty"><div class="big">加载会话…</div></div>
  {:else if chat.turns.length === 0}
    <div class="chat-empty">
      {#if chat.primed}
        <div class="big">{session.soloDefault ? "新会话" : session.ws}</div>
        <div>输入需求开始新会话</div>
      {:else}
        <div class="big">开始你的第一个任务</div>
        <div>输入需求后点发送；需要处理文件时用「附件」</div>
      {/if}
    </div>
  {:else}
    {#if chat.hasMore}
      <button class="ghost load-more" disabled={chat.loadingEarlier} onclick={loadEarlier}>
        {chat.loadingEarlier ? "加载中…" : "加载更早的对话"}
      </button>
    {/if}
    {#each chat.turns as t (t.seq ?? t._id)}
      <Turn {t} />
    {/each}
  {/if}
</div>

<style>
  #chat{flex:1;overflow-y:auto;padding:var(--pad);display:flex;flex-direction:column;gap:14px}
  .chat-empty{margin:auto;text-align:center;color:var(--muted)}
  .chat-empty .big{font-size:17px;font-weight:500;color:var(--text);margin-bottom:6px}
  .load-more{align-self:center;margin:4px 0}
  @media (max-width:768px){
    #chat{padding:14px 12px;gap:12px}
  }
</style>
