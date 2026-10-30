/** 白标：只处理 document 级效果（title / --accent / customCSS 注入）。
 *  品牌名、Logo、标语由组件从 session.branding 响应式渲染，不再扫 DOM 改写。 */
export function applyDocumentBranding(b) {
  if (!b) return;
  document.title = b.appName || "ZCode 门户";
  if (b.accent && /^#[0-9a-fA-F]{3,6}$/.test(b.accent)) {
    document.documentElement.style.setProperty("--accent", b.accent);
  }
  let tag = document.getElementById("portal-custom-css");
  if (b.customCSS) {
    if (!tag) { tag = document.createElement("style"); tag.id = "portal-custom-css"; document.head.appendChild(tag); }
    tag.textContent = b.customCSS;
  } else if (tag) {
    tag.remove();
  }
}
