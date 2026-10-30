import { ui, setStatus } from "./stores/ui.svelte.js";
import { session } from "./stores/session.svelte.js";

/** 上传单个文件为待发送附件（附件按钮 / 拖拽 / Ctrl+V 粘贴共用） */
export async function uploadOne(f) {
  setStatus(`上传 ${f.name || "粘贴图片"} …`);
  try {
    const name = f.name || `paste-${Date.now()}.png`;
    const r = await fetch(`/api/upload?ws=${encodeURIComponent(session.ws)}&filename=${encodeURIComponent(name)}`, { method: "POST", body: f });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    ui.atts.push({ wsPath: j.wsPath, filename: j.filename });
    setStatus("");
  } catch (e) {
    setStatus("上传失败: " + e.message);
  }
}

export async function uploadMany(files) {
  for (const f of files) await uploadOne(f);
}
