<script>
  import { fade } from "svelte/transition";
  import { chat, loadEarlier } from "../lib/stores/chat.svelte.js";
  import { session } from "../lib/stores/session.svelte.js";
  import Turn from "./Turn.svelte";

  let chatEl;
  let lastTick = -1;
  let atBottom = $state(true);

  function onScroll() {
    const el = chatEl;
    if (!el) return;
    atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  function scrollToBottom() {
    chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: "smooth" });
  }

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
      atBottom = true;
    } else {
      const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
      if (nearBottom) chatEl.scrollTop = chatEl.scrollHeight;
    }
  });
</script>

<div class="chat-wrap">
  <div id="chat" bind:this={chatEl} onscroll={onScroll}>
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
  {#if !atBottom && !chat.loading}
    <button class="to-bottom" aria-label="跳到最新消息" title="跳到最新消息" transition:fade={{ duration: 130 }} onclick={scrollToBottom}>
      <i class="i-lucide-chevron-down"></i>
    </button>
  {/if}
</div>

<style>
  .chat-wrap{position:relative;flex:1;display:flex;flex-direction:column;min-height:0}
  #chat{flex:1;overflow-y:auto;padding:var(--pad);display:flex;flex-direction:column;gap:14px}
  .chat-empty{margin:auto;text-align:center;color:var(--muted)}
  .chat-empty .big{font-size:17px;font-weight:500;color:var(--text);margin-bottom:6px}
  .load-more{align-self:center;margin:4px 0}
  /* 回到底部悬浮钮：半透明毛玻璃圆钮 */
  .to-bottom{
    position:absolute;right:18px;bottom:14px;z-index:10;
    width:38px;height:38px;border-radius:99px;padding:0;
    display:grid;place-items:center;font-size:20px;
    background:rgba(255,255,255,.72);border:1px solid var(--border);
    color:var(--muted);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);
    box-shadow:0 3px 12px rgba(19,20,22,.14);
  }
  .to-bottom:hover{color:var(--accent);border-color:var(--accent)}
  @media (max-width:768px){
    #chat{padding:14px 12px;gap:12px}
    .to-bottom{right:12px;bottom:12px;width:42px;height:42px}
  }
</style>
