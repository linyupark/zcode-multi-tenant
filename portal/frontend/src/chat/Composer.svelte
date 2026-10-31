<script>
  import { MediaQuery } from "svelte/reactivity";
  import { chat, send, stop } from "../lib/stores/chat.svelte.js";
  import { ui } from "../lib/stores/ui.svelte.js";
  import { uploadMany } from "../lib/uploads.js";

  const mobileMQ = new MediaQuery("(max-width:768px)");

  let input = $state("");
  let fileInput;
  const placeholder = $derived(mobileMQ.current ? "描述你的任务…" : "描述你的任务…（Ctrl+Enter 发送）");

  function submit() {
    if (chat.sending) return;
    const text = input;
    input = "";
    send(text);
  }
  function onKeydown(e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  }
  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) uploadMany(files);
  }
</script>

<div class="composer">
  <textarea bind:value={input} {placeholder} onkeydown={onKeydown} onpaste={onPaste}></textarea>
  <div class="bar">
    <button class="ghost attach" onclick={() => fileInput.click()} title="上传图片/文档给 AI 处理">
      <i class="i-lucide-paperclip"></i>附件
    </button>
    <input type="file" multiple class="hidden" bind:this={fileInput} onchange={async (e) => { await uploadMany([...e.target.files]); e.target.value = ""; }} />
    <span class="status">{ui.status}</span>
    <span class="spacer"></span>
    {#if chat.sending}
      <button class="stopping send" onclick={stop}><i class="i-lucide-square"></i>停止</button>
    {:else}
      <button class="send" onclick={submit}><i class="i-lucide-send-horizontal"></i>发送<span class="kbd">Ctrl ↵</span></button>
    {/if}
  </div>
</div>

<style>
  .composer{border-top:1px solid var(--border);padding:14px var(--pad) 16px}
  textarea{min-height:68px;resize:vertical;line-height:1.5}
  .bar{display:flex;gap:10px;margin-top:10px;align-items:center}
  .bar button{display:inline-flex;align-items:center;gap:6px}
  .attach{font-size:13.5px}
  .status{color:var(--muted);font-size:12.5px}
  .spacer{flex:1}
  .send{padding:8px 18px;font-size:14px;min-height:36px}
  .send .kbd{font-size:10.5px;background:rgba(255,255,255,.2);border-radius:4px;padding:1px 5px;margin-left:2px}
  .send i, .attach i{font-size:15px}
  @media (max-width:768px){
    .composer{padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
    textarea{min-height:48px;font-size:16px;padding:10px 12px;resize:none}
    .bar{gap:8px;margin-top:8px}
    .bar button{min-height:40px;padding:8px 14px}
    .send .kbd{display:none}
    .status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  }
</style>
