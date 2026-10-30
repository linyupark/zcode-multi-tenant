/** 工具调用 → Iconify(lucide) 图标类名（沿用旧 toolIconSvg 的名字匹配语义） */
export function toolIconClass(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("skill")) return "i-lucide-sparkles";
  if (n.includes("mcp")) return "i-lucide-plug";
  if (n === "bash" || n.includes("shell") || n.includes("terminal")) return "i-lucide-terminal";
  if (["read", "write", "edit", "glob", "grep", "file"].some((k) => n.includes(k))) return "i-lucide-file-text";
  if (n.includes("task") || n.includes("agent")) return "i-lucide-user-round";
  return "i-lucide-wrench";
}
