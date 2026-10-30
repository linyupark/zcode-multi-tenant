<script>
  import { onMount } from "svelte";
  import Topbar from "./Topbar.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ChatArea from "./ChatArea.svelte";
  import AttachBar from "./AttachBar.svelte";
  import Composer from "./Composer.svelte";
  import DropOverlay from "./DropOverlay.svelte";
  import Modal from "./Modal.svelte";
  import ModelPanel from "./panels/ModelPanel.svelte";
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

<div id="app">
  <Topbar />
  <Sidebar />
  <div id="sheet">
    <ChatArea />
    <AttachBar />
    <Composer />
  </div>
</div>

<DropOverlay />

{#if ui.panel === "model"}
  <Modal><ModelPanel /></Modal>
{:else if ui.panel === "skills"}
  <Modal><SkillsPanel /></Modal>
{:else if ui.panel === "files"}
  <Modal width={600}><FilesPanel /></Modal>
{:else if ui.panel === "passwd"}
  <Modal width={400}><PasswordPanel /></Modal>
{/if}

<style>
  #app{display:grid;grid-template-columns:228px 1fr;grid-template-rows:48px 1fr;height:100vh}
  #sheet{grid-column:2;grid-row:2;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sheet) 0 0 0;margin:0 8px 8px 0;display:flex;flex-direction:column;min-height:0}
  @media (max-width:768px){
    #app{grid-template-columns:1fr;grid-template-rows:52px 1fr;height:var(--app-h,100vh);height:var(--app-h,100dvh)}
    #sheet{grid-column:1;grid-row:2;margin:0;border:0;border-radius:0;min-height:0;height:100%}
  }
</style>
