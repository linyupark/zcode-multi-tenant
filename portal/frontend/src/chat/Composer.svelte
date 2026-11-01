<script>
  import { MediaQuery } from "svelte/reactivity";
  import { api } from "../lib/api.js";
  import { chat, send, stop } from "../lib/stores/chat.svelte.js";
  import { session } from "../lib/stores/session.svelte.js";
  import { ui } from "../lib/stores/ui.svelte.js";
  import { uploadMany } from "../lib/uploads.js";

  const mobileMQ = new MediaQuery("(max-width:768px)");

  let input = $state("");
  let fileInput;
  let inputEl;
  let pickOpen = $state(false);
  let pickEl = $state(null); // bind:this 在 {#if} 条件块内，反复赋值需 $state（non_reactive_update）
  let skills = $state([]);
  let mcpServers = $state([]);
  const placeholder = $derived(mobileMQ.current ? "描述你的任务…" : "描述你的任务…（Ctrl+Enter 发送）");

  function submit() {
    if (chat.sending) return;
    const text = input;
    input = "";
    pickOpen = false;
    send(text);
  }
  function onKeydown(e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && pickOpen) {
      pickOpen = false;
    }
  }
  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) uploadMany(files);
  }

  /** 技能与 MCP 选择器：每次打开拉最新清单 */
  async function togglePick() {
    pickOpen = !pickOpen;
    if (!pickOpen) return;
    try {
      const [sk, mc] = await Promise.all([
        api(`/api/skills?ws=${encodeURIComponent(session.ws)}`).catch(() => ({ skills: [] })),
        api("/api/mcp").catch(() => ({ servers: [] })),
      ]);
      skills = sk.skills || [];
      mcpServers = mc.servers || [];
    } catch { /* 保持空态 */ }
  }
  /** 把技能 / MCP 引用插入输入框末尾 */
  function insert(text) {
    input = (input && !input.endsWith(" ") ? input + " " : input) + text;
    pickOpen = false;
    requestAnimationFrame(() => {
      inputEl?.focus();
      const n = inputEl?.value?.length ?? 0;
      inputEl?.setSelectionRange(n, n);
    });
  }
  function onWindowPointerdown(e) {
    if (!pickOpen) return;
    const t = e.target;
    if (t instanceof Element && !t.closest(".pick") && !t.closest(".pick-btn")) pickOpen = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="composer">
  {#if pickOpen}
    <div class="pick" bind:this={pickEl}>
      <div class="pick-sec">技能</div>
      {#if skills.length}
        {#each skills as s (s.name)}
          <button class="pick-item" onclick={() => insert(`/${s.name} `)} title={s.scope === "project" ? "当前工作区技能" : "全局技能（管理员下发）"}>
            <i class="i-lucide-sparkles"></i>
            <span class="pick-name">{s.name}</span>
            <span class="pick-tag" class:ws={s.scope === "project"}>{s.scope === "project" ? "工作区" : "全局"}</span>
          </button>
        {/each}
      {:else}
        <div class="pick-empty">暂无可用技能</div>
      {/if}
      <div class="pick-sec">MCP 服务</div>
      {#if mcpServers.length}
        {#each mcpServers as s (s.id)}
          <button class="pick-item" onclick={() => insert(`使用 MCP「${s.id}」 `)} title={s.kind === "url" ? "远程 MCP 服务" : "本地 MCP 服务"}>
            <i class="i-lucide-plug"></i>
            <span class="pick-name">{s.id}</span>
            <span class="pick-tag">{s.kind === "url" ? "远程" : "本地"}</span>
          </button>
        {/each}
      {:else}
        <div class="pick-empty">管理员未配置 MCP 服务</div>
      {/if}
    </div>
  {/if}
  <textarea bind:value={input} bind:this={inputEl} {placeholder} onkeydown={onKeydown} onpaste={onPaste}></textarea>
  <div class="bar">
    <button class="ghost attach" onclick={() => fileInput.click()} title="上传图片/文档给 AI 处理">
      <i class="i-lucide-paperclip"></i><span class="attach-text">附件</span>
    </button>
    <button class="ghost pick-btn" class:on={pickOpen} title="技能与 MCP 服务" onclick={togglePick}>
      <i class="i-lucide-puzzle"></i>
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
  .composer{position:relative;border-top:1px solid var(--border);padding:14px var(--pad) 16px}
  textarea{min-height:68px;resize:vertical;line-height:1.5}
  .bar{display:flex;gap:10px;margin-top:10px;align-items:center}
  .bar button{display:inline-flex;align-items:center;gap:6px}
  .attach{font-size:13.5px}
  .pick-btn{width:34px;height:34px;padding:0;justify-content:center;font-size:16px;color:var(--muted)}
  .pick-btn:hover{color:var(--accent)}
  .pick-btn.on{color:var(--accent);border-color:var(--accent)}
  .status{color:var(--muted);font-size:12.5px}
  .spacer{flex:1}
  .send{padding:8px 18px;font-size:14px;min-height:36px}
  .send .kbd{font-size:10.5px;background:rgba(255,255,255,.2);border-radius:4px;padding:1px 5px;margin-left:2px}
  .send i, .attach i{font-size:15px}
  /* 技能与 MCP 选择器：浮在 composer 上方的卡片 */
  .pick{
    position:absolute;left:var(--pad);bottom:calc(100% - 6px);z-index:30;width:320px;
    background:var(--surface);border:1px solid var(--border);border-radius:10px;
    box-shadow:0 8px 32px rgba(0,0,0,.12);padding:6px;max-height:44vh;overflow-y:auto;
  }
  .pick-sec{font-size:12px;color:var(--muted);padding:8px 10px 4px}
  .pick-item{
    display:flex;align-items:center;gap:8px;width:100%;text-align:left;
    border:0;background:none;font:inherit;font-size:13.5px;color:var(--text);
    padding:8px 10px;border-radius:6px;cursor:pointer;
  }
  .pick-item:hover{background:var(--raised)}
  .pick-item i{font-size:15px;color:var(--muted)}
  .pick-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
  .pick-tag{font-size:10.5px;color:var(--muted);border:1px solid var(--control);border-radius:99px;padding:0 7px;line-height:1.6;flex:0 0 auto}
  .pick-tag.ws{border-color:var(--accent);color:var(--accent)}
  .pick-empty{color:var(--muted);font-size:12.5px;padding:6px 10px 8px}
  @media (max-width:768px){
    .composer{padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
    textarea{min-height:48px;font-size:16px;padding:10px 12px;resize:none}
    .bar{gap:8px;margin-top:8px}
    .bar button{min-height:40px;padding:8px 14px}
    /* 附件 + 技能 = 两个等大的方形图标按钮（附件去文字；此前 .bar button 的
       padding 覆盖 .pick-btn 的 padding:0，34px 宽里挤 28px 内边距，图标被压瘪） */
    .attach-text{display:none}
    .bar .attach,.bar .pick-btn{width:40px;height:40px;min-height:40px;padding:0;justify-content:center}
    .bar .attach i,.bar .pick-btn i{font-size:18px}
    .send .kbd{display:none}
    .status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pick{left:8px;right:8px;width:auto;bottom:calc(100% - 4px)}
  }
</style>
