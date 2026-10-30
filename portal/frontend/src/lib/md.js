/** 零依赖 Markdown 渲染（自旧 index.html 原样移植）：
 *  先整体 escapeHtml，代码块/行内码用 \u0000 占位再还原，
 *  保证注入 innerHTML/{@html} 前不可信内容已转义。改这段务必保持占位符方案。 */
export function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function mdToHtml(src) {
  const codes = [];
  let t = escapeHtml(src || "");
  // 围栏代码块先抽出占位
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (m, code) => { codes.push(code); return "\u0000CODE" + (codes.length - 1) + "\u0000"; });
  const inls = [];
  t = t.replace(/`([^`\n]+)`/g, (m, c) => { inls.push(c); return "\u0000INL" + (inls.length - 1) + "\u0000"; });
  const lines = t.split("\n");
  let html = "", listType = null, para = [], tableBuf = [];
  const flushPara = () => { if (para.length) { html += "<p>" + para.join("<br>") + "</p>"; para = []; } };
  const closeList = () => { if (listType) { html += "</" + listType + ">"; listType = null; } };
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    tableBuf = [];
    if (!rows.length) return;
    let head = null, body = rows;
    if (rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c))) { head = rows[0]; body = rows.slice(2); }
    html += "<table>";
    if (head) html += "<thead><tr>" + head.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead>";
    html += "<tbody>" + body.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
  };
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); closeList(); tableBuf.push(line); continue; }
    flushTable();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const bq = line.match(/^>\s?(.*)$/);
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); html += "<hr>"; continue; }
    if (h) { flushPara(); closeList(); const lv = h[1].length; html += "<h" + lv + ">" + h[2] + "</h" + lv + ">"; continue; }
    if (ul) { flushPara(); if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += "<li>" + ul[1] + "</li>"; continue; }
    if (ol) { flushPara(); if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += "<li>" + ol[1] + "</li>"; continue; }
    if (bq) { flushPara(); closeList(); html += "<blockquote>" + bq[1] + "</blockquote>"; continue; }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line);
  }
  flushTable(); flushPara(); closeList();
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\u0000INL(\d+)\u0000/g, (m, i) => "<code>" + inls[Number(i)] + "</code>");
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => "<pre><code>" + codes[Number(i)] + "</code></pre>");
  return html;
}
