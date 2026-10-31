/** 界面态：抽屉 / 弹层 / 附件 / 状态行 / 拖拽 */
export const ui = $state({
  drawer: false,          // 移动端抽屉
  panel: null,            // 当前弹层：'skills' | 'files' | 'passwd'
  atts: [],               // 待发送附件 [{wsPath, filename}]
  status: "",             // composer 状态行（原 #status）
  dragDepth: 0,           // 全屏拖拽计数
  pendingPreview: null,   // 打开文件面板时自动预览的工作区相对路径（消息产出卡片用）
});

export function setStatus(s) { ui.status = s || ""; }
export function openDrawer() { ui.drawer = true; }
export function closeDrawer() { ui.drawer = false; }
export function toggleDrawer() { ui.drawer = !ui.drawer; }
export function openPanel(name) { ui.panel = name; }
export function closePanel() { ui.panel = null; }

/** 引入/移除一个工作区文件到待发送附件（文件面板「引入对话」，免去重新上传） */
export function toggleAtt(wsPath, filename) {
  const i = ui.atts.findIndex((a) => a.wsPath === wsPath);
  if (i >= 0) ui.atts.splice(i, 1);
  else ui.atts.push({ wsPath, filename });
  return i < 0;
}
export function hasAtt(wsPath) {
  return ui.atts.some((a) => a.wsPath === wsPath);
}
