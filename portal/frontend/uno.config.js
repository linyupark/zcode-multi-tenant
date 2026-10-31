import { defineConfig, presetWind4, presetIcons } from "unocss";

/**
 * 设计令牌仍在 src/app.css 的 :root CSS 变量里（applyBranding 会在运行时改写
 * --accent、管理员 customCSS 也会引用这些变量），这里只做「变量 → 工具类」的映射。
 */
export default defineConfig({
  presets: [
    presetWind4(),
    presetIcons({
      // lucide 用于 UI 与工具图标，simple-icons 用于第三方 logo（GitHub 等）
      collections: { lucide: () => import("@iconify-json/lucide/icons.json").then((m) => m.default), "simple-icons": () => import("@iconify-json/simple-icons/icons.json").then((m) => m.default) },
    }),
  ],
  theme: {
    colors: {
      ground: "var(--ground)",
      surface: "var(--surface)",
      raised: "var(--raised)",
      active: "var(--active)",
      line: "var(--border)",
      rule: "var(--rule)",
      control: "var(--control)",
      ink: "var(--text)",
      muted: "var(--muted)",
      accent: "var(--accent)",
      positive: "var(--positive)",
      negative: "var(--negative)",
      "pill-positive-bg": "var(--pill-positive-bg)",
      "pill-positive-ink": "var(--pill-positive-ink)",
      "pill-neutral-bg": "var(--pill-neutral-bg)",
      "pill-neutral-ink": "var(--pill-neutral-ink)",
    },
    borderRadius: {
      card: "var(--radius-card)",
      control: "var(--radius-control)",
      sheet: "var(--radius-sheet)",
    },
    fontFamily: {
      sans: '"IBM Plex Sans",Inter,system-ui,"PingFang SC","Microsoft YaHei",sans-serif',
      mono: '"IBM Plex Mono",ui-monospace,monospace',
    },
  },
  shortcuts: {
    // 侧栏（品牌 .brand 走 app.css 全局类，保持旧类名兼容管理员 customCSS）
    "nav-item": "flex items-center gap-[9px] px-2.5 py-[7px] rounded-control text-muted text-[13.5px] cursor-pointer no-underline hover:bg-raised hover:text-ink",
    "sess-item": "flex items-center gap-[9px] px-2.5 py-[5px] rounded-control text-muted text-[12.5px] cursor-pointer min-w-0 hover:bg-raised hover:text-ink",
    "nav-sec": "text-[12px] text-muted pt-3.5 px-2.5 pb-[5px]",
    // 表单 / 弹层
    field: "mb-3.5 block",
    "field-label": "block text-[12.5px] text-muted mb-[5px]",
    "btn-row": "flex gap-2.5 mt-3.5",
    "panel-card": "bg-surface border border-line rounded-sheet p-6 w-[520px] max-h-[88vh] overflow-y-auto shadow-[0_8px_32px_rgba(0,0,0,0.12)]",
    "msg-err": "text-[13px] min-h-5 my-1.5 text-negative",
    "msg-ok": "text-[13px] min-h-5 my-1.5 text-positive",
    pill: "inline-block text-[11.5px] px-2.5 py-0.5 rounded-full bg-pill-neutral-bg text-pill-neutral-ink whitespace-nowrap",
    "pill-ok": "bg-pill-positive-bg text-pill-positive-ink",
    "kv-row": "flex justify-between items-start gap-3 py-[9px] border-b border-rule text-[13.5px] last:border-b-0",
  },
  // 工具图标类是运行时按工具名映射出来的，safelist 兜底确保全部生成
  safelist: [
    "i-lucide-sparkles", "i-lucide-plug", "i-lucide-terminal", "i-lucide-file-text",
    "i-lucide-user-round", "i-lucide-wrench", "i-lucide-menu", "i-lucide-x",
    "i-lucide-plus", "i-lucide-paperclip", "i-lucide-send-horizontal", "i-lucide-square",
    "i-lucide-trash-2", "i-lucide-download", "i-lucide-log-out", "i-lucide-lock",
    "i-lucide-folder-open", "i-simple-icons-github",
    "i-lucide-folder", "i-lucide-image", "i-lucide-table", "i-lucide-file-code",
    "i-lucide-file-archive", "i-lucide-file-video", "i-lucide-file-audio", "i-lucide-file",
    "i-lucide-chevron-right", "i-lucide-chevron-down", "i-lucide-refresh-cw", "i-lucide-eye",
  ],
});
