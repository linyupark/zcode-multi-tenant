/** 文件类型 → lucide 图标类名 / 图片判断（文件面板与消息产出卡片共用） */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function isImage(name) {
  return IMAGE_RE.test(String(name || ""));
}

export function iconForFile(name) {
  const n = String(name || "").toLowerCase();
  const ext = n.includes(".") ? n.split(".").pop() : "";
  if (IMAGE_RE.test(n)) return "i-lucide-image";
  if (["xlsx", "xls", "csv", "ods"].includes(ext)) return "i-lucide-table";
  if (["doc", "docx", "pdf", "md", "txt", "rtf", "ppt", "pptx"].includes(ext)) return "i-lucide-file-text";
  if (["js", "ts", "jsx", "tsx", "py", "json", "html", "css", "sh", "bat", "yml", "yaml", "xml"].includes(ext)) return "i-lucide-file-code";
  if (["zip", "gz", "tar", "rar", "7z"].includes(ext)) return "i-lucide-file-archive";
  if (["mp4", "mov", "avi", "webm", "mkv"].includes(ext)) return "i-lucide-file-video";
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "i-lucide-file-audio";
  return "i-lucide-file";
}
