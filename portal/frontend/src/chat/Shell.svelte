<script>
  import { onMount } from "svelte";
  import Topbar from "./Topbar.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ChatArea from "./ChatArea.svelte";
  import AttachBar from "./AttachBar.svelte";
  import Composer from "./Composer.svelte";
  import DropOverlay from "./DropOverlay.svelte";
  import Modal from "./Modal.svelte";
  import SkillsPanel from "./panels/SkillsPanel.svelte";
  import FilesPanel from "./panels/FilesPanel.svelte";
  import PasswordPanel from "./panels/PasswordPanel.svelte";
  import { session } from "../lib/stores/session.svelte.js";
  import { ui } from "../lib/stores/ui.svelte.js";
  import { uploadMany } from "../lib/uploads.js";

  function onDragEnter(e) { e.preventDefault(); ui.dragDepth++; }
  function onDragLeave(e) { e.preventDefault(); ui.dragDepth = Math.max(0, ui.dragDepth - 1); }
  function onDragOver(e) { e.preventDefault(); }
  function onDrop(e) {
    e.preventDefault();
    ui.dragDepth = 0;
    if (!session.me) return;
    uploadMany([...(e.dataTransfer?.files || [])]);
  }

  onMount(() => {
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  });
</script>

<div id="app" class:imp={!!session.me.impersonated}>
  {#if session.me.impersonated}
    <div class="impersonation-banner">
      <i class="i-lucide-eye"></i>
      模拟登录模式：你正以 <b>{session.me.username}</b> 的身份查看，操作会写入其会话记录。
      <a href="/admin" target="_blank">返回管理后台 ↗</a>
    </div>
  {/if}
  <Topbar />
  <Sidebar />
  <div id="sheet">
    <ChatArea />
    <AttachBar />
    <Composer />
  </div>
</div>

<DropOverlay />

{#if ui.panel === "skills"}
  <Modal><SkillsPanel /></Modal>
{:else if ui.panel === "files"}
  <Modal width={600}><FilesPanel /></Modal>
{:else if ui.panel === "passwd"}
  <Modal width={400}><PasswordPanel /></Modal>
{/if}

<style>
  /* minmax(0,1fr)：去掉 1fr 的 auto 最小尺寸下限，防止宽表格等固有宽度把 #app 撑出视口 */
  #app{display:grid;grid-template-columns:228px minmax(0,1fr);grid-template-rows:48px 1fr;height:100vh}
  #app.imp{grid-template-rows:34px 48px 1fr}
  /* 模拟登录横幅：贯穿顶栏，醒目但可读（仅 .imp 时存在） */
  .impersonation-banner{
    grid-column:1/3;grid-row:1;display:flex;align-items:center;gap:8px;justify-content:center;
    background:#fff3cd;color:#6b4d00;font-size:12.5px;padding:0 12px;
    overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
  }
  .impersonation-banner a{color:#6b4d00;font-weight:500}
  .impersonation-banner i{font-size:14px;flex:0 0 auto}
  /* 横幅存在时 topbar/sheet 下移一行（跨组件选择器必须在全局层，见 app.css） */
  @media (max-width:768px){
    #app{grid-template-columns:1fr;grid-template-rows:36px 52px 1fr;height:var(--app-h,100vh);height:var(--app-h,100dvh)}
    #app.imp{grid-template-rows:32px 52px 1fr}
    .impersonation-banner{font-size:11.5px}
    #sheet{grid-column:1;grid-row:2;margin:0;border:0;border-radius:0;min-height:0;height:100%}
  }
  #sheet{grid-column:2;grid-row:2;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sheet) 0 0 0;margin:0 8px 8px 0;display:flex;flex-direction:column;min-height:0;min-width:0}
  @media (max-width:768px){
    #app{grid-template-columns:1fr;grid-template-rows:36px 52px 1fr;height:var(--app-h,100vh);height:var(--app-h,100dvh)}
    #sheet{grid-column:1;grid-row:3;margin:0;border:0;border-radius:0;min-height:0;height:100%}
  }
</style>
