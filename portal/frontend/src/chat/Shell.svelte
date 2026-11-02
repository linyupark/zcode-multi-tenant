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

<!-- 横幅在 #app 网格之外：插入/移除都不影响网格的行列结构（曾因 auto-placement 把 sidebar 挤进隐式第三列导致整页错乱） -->
<div class="shell-root">
  {#if session.me.impersonated}
    <div class="impersonation-banner">
      <i class="i-lucide-eye"></i>
      <span class="imp-text">模拟登录模式：你正以 <b>{session.me.username}</b> 的身份查看，操作会写入其会话记录。</span>
      <a href="/admin" target="_blank">返回管理后台 ↗</a>
    </div>
  {/if}
  <div id="app">
    <Topbar />
    <Sidebar />
    <div id="sheet">
      <ChatArea />
      <AttachBar />
      <Composer />
    </div>
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
  /* 外壳：横幅（可选）+ 网格，纵向排布；横幅不占网格行，#app 始终两行，topbar/sheet 行号稳定 */
  .shell-root{display:flex;flex-direction:column;height:100vh;height:var(--app-h,100vh)}
  .impersonation-banner{
    flex:0 0 auto;display:flex;align-items:center;gap:8px;justify-content:center;
    background:#fff3cd;color:#6b4d00;font-size:12.5px;padding:7px 12px;
    overflow:hidden;white-space:nowrap;
  }
  .imp-text{overflow:hidden;text-overflow:ellipsis}
  .impersonation-banner a{color:#6b4d00;font-weight:500;flex:0 0 auto}
  .impersonation-banner i{font-size:14px;flex:0 0 auto}
  /* minmax(0,1fr)：去掉 1fr 的 auto 最小尺寸下限，防止宽表格等固有宽度把 #app 撑出视口 */
  #app{flex:1;min-height:0;display:grid;grid-template-columns:228px minmax(0,1fr);grid-template-rows:48px minmax(0,1fr)}
  #sheet{grid-column:2;grid-row:2;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sheet) 0 0 0;margin:0 8px 8px 0;display:flex;flex-direction:column;min-height:0;min-width:0}
  @media (max-width:768px){
    .shell-root{height:var(--app-h,100dvh)}
    #app{grid-template-columns:1fr;grid-template-rows:52px minmax(0,1fr)}
    #sheet{grid-column:1;grid-row:2;margin:0;border:0;border-radius:0;height:100%}
    .impersonation-banner{font-size:11.5px;padding:6px 10px}
  }
</style>
