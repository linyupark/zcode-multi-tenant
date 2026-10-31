/** 界面态：抽屉 / 弹层 / 附件 / 状态行 / 拖拽 */
export const ui = $state({
  drawer: false,          // 移动端抽屉
  panel: null,            // 当前弹层：'model' | 'skills' | 'files' | 'passwd'
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
