// PreToolUse 守卫钩子：内核每次工具调用前 spawn 本脚本，stdin 喂一行 JSON
// {hook_event_name, tool_name, tool_input, tool_use_id, ...}，stdout 回 JSON 决策。
// 空 stdout = 放行；deny 时回 hookSpecificOutput，拒绝原因会作为工具结果回喂模型
// —— run 不终止，模型可自愈换合规写法重试（探针已验证，见 2026-11-03 会话）。
//
// 硬纪律（改代码前先读）：
//   1. 自带看门狗：5s 内没结论就放行退出，不指望内核超时承诺；
//   2. stdin 读到 EOF 为止且 >1MB 直接放行（正常 tool_input 远小于此）；
//   3. 任何内部异常 fail-open：防护出 bug 必须是「少拦」而不是「卡死租户任务」；
//   4. 只经 stdout 回结论，不写任何文件（audit 由 portal 从流里识别后写）；
//   5. 显式 process.exit(0)，不 spawn 子进程、零依赖、不持有跨调用状态。
//
// 判定逻辑从 server.mjs guardrailCheck 原样移植（黑洞豁免/glob 跳过/写命令与
// 重定向两分支/protectRead/cd 检查），语义与 2026-11-02、11-03 两轮误杀修复一致。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORTAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(PORTAL_DIR, "..");

// 写命令 / 高危命令 / 结构化写工具与 server.mjs 旧版完全一致（语义冻结，别顺手改）
const BASH_WRITE_RE = /\b(tee|cp|mv|rm|rmdir|dd|touch|mkdir|truncate|shred|del|rd|erase|Remove-Item|Copy-Item|Move-Item|New-Item|Set-Content|Add-Content|Out-File|Clear-Content)\b/i;
const DESTRUCTIVE_RE = /\b(git\s+push\s+(?:--force\b|-f\b)|git\s+reset\s+--hard|mkfs|shutdown\b|reboot\b|format\s+[a-zA-Z]:|reg\s+delete|vssadmin|bcdedit)\b/i;
const WRITE_TOOLS_RE = /^(write|edit|multiedit|notebookedit|create|replace)$/i;
// 黑洞设备：重定向到这里 = 丢弃输出，不是真实写入
const BLACKHOLE_RE = /^(?:[a-zA-Z]:)?[\\/]?(?:dev[\\/])?(?:null|stdout|stderr|zero|nul)[\\/]?$/i;

function redirectTargets(cmd) {
  const out = [];
  for (const m of cmd.matchAll(/(?:^|[\s;(&|])(\d?>>?)\s*("[^"]*"|'[^']*'|[^\s;|&)]+)/g)) {
    if (m[1] === "<" || m[1].startsWith("<")) continue; // stdin 不落盘
    out.push(m[2]);
  }
  return out;
}

function pathTokens(cmd) {
  const out = new Set();
  // 带左边界（行首/分隔符之后才算路径起点）：否则 scripts/openserp.mjs 会被从中间
  // 切出 /openserp.mjs，Windows 下被误判为盘符根的绝对路径造成误杀
  for (const m of cmd.matchAll(/(?:^|[\s"'`|;&<>()\[,]((?:[A-Za-z]:)?(?:[\\/][^\s"'`|;&<>()]+)+))/g)) {
    if (m[1] && m[1].trim()) out.add(m[1]);
  }
  for (const m of cmd.matchAll(/(?:^|[\s=("';&|])(\.\.(?:[\\/][^\s"'`|;&<>()]*)?)/g)) { if (m[1]) out.add(m[1]); }
  return [...out];
}

/**
 * 判定一次工具调用。返回拒绝理由字符串（null = 放行）。
 * 路径语义与旧 portal 守卫一致：相对路径按工作区解析；Git Bash 风格 /c/...
 * 会落在工作区盘符下解析（不等于真实宿主路径，但必然不在租户范围内 → 拦）。
 */
export function evaluate({ tool, input, wsPath, wsRoot, homePath, root = DEFAULT_ROOT, dataDir = path.join(DEFAULT_ROOT, "data"), kernelDir = path.join(DEFAULT_ROOT, "kernel") }) {
  // 路径归一化：portal env 与工具入参的盘符分隔符必须一致（env 若为正斜杠，
  // startsWith 前缀比对会全 miss → 连工作区内写入都被误拦，runD 实测踩过）
  wsPath = path.resolve(wsPath);
  wsRoot = path.resolve(wsRoot);
  homePath = path.resolve(homePath);
  root = path.resolve(root);
  dataDir = path.resolve(dataDir);
  kernelDir = path.resolve(kernelDir);
  let obj = null;
  if (input && typeof input === "object") obj = input;
  else if (typeof input === "string" && input.trim().startsWith("{")) { try { obj = JSON.parse(input); } catch { /* 纯文本摘要 */ } }
  const insideWs = (abs) => abs === wsPath || abs.startsWith(wsPath + path.sep);
  const insideOwn = (abs) => insideWs(abs) || abs === wsRoot || abs.startsWith(wsRoot + path.sep) ||
    abs === homePath || abs.startsWith(homePath + path.sep);
  // 受保护读取：宿主程序目录 / 数据目录 / 内核目录里，自己工作区与 HOME 之外的一切
  const protectRead = (abs) => !insideOwn(abs) &&
    ((abs === root || abs.startsWith(root + path.sep)) ||
     (abs === dataDir || abs.startsWith(dataDir + path.sep)) ||
     (abs === kernelDir || abs.startsWith(kernelDir + path.sep)) ||
     /(^|[\\/])\.env([\\/]|$)/i.test(abs));
  const resolveOne = (t) => path.isAbsolute(t) ? path.normalize(t) : path.resolve(wsPath, t);
  const DENY_WRITE = "写入被拒绝：只允许写当前工作区与自己的用户主目录（含 .zcode/skills）。请把文件写到当前工作区内（临时脚本与中间产物放 .tmp/）；若只是丢弃输出，用 >/dev/null 重定向即可、不要写盘。";
  const DENY_READ = "访问被拒绝：门户程序目录、kernel/、data/ 中非本租户区域与 .env 文件是禁区。请只在当前工作区与自己的用户主目录内工作。";
  const DENY_DANGEROUS = "高危破坏性命令被拒绝（强制推送/硬重置/格式化/关机/批量删除等）。请改用安全做法；确实做不到就向用户如实说明限制。";
  const DENY_SYSTEM = "高危系统操作被拒绝（计划任务/注册表删除/强制杀进程等）。";
  const at = (t) => `（目标：${String(t).slice(0, 120)}）`;

  // 1) 结构化路径参数（Write/Edit/Read/Glob/Grep/NotebookEdit 均可能带 file_path/path）
  const filePath = obj?.file_path || obj?.filePath || obj?.path || obj?.notebook_path;
  if (typeof filePath === "string" && filePath.trim()) {
    const abs = resolveOne(filePath);
    if (WRITE_TOOLS_RE.test(String(tool || ""))) {
      if (!insideOwn(abs)) return DENY_WRITE + at(filePath);
    } else if (protectRead(abs)) {
      return DENY_READ + at(filePath);
    }
  }
  // 2) bash/shell 命令
  const command = typeof obj?.command === "string" ? obj.command : null;
  if (command && command.trim()) {
    if (DESTRUCTIVE_RE.test(command)) return DENY_DANGEROUS;
    // 写入判定按「最终落点」：
    //   a) 写命令（tee/cp/mv/...）——参数是写入/移动目标，必须在本租户范围内
    //   b) 显式重定向 > >> 2> ——目标必须在本租户范围内或黑洞设备（/dev/null、NUL）
    // 纯探测命令（ls/command -v/grep… 2>/dev/null）没有写命令也没有落盘重定向，直接放行
    const writeCmd = BASH_WRITE_RE.test(command);
    const redirects = redirectTargets(command).filter((t) => !BLACKHOLE_RE.test(t.replace(/^["']|["']$/g, "").replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, "x")));
    const hasWrite = writeCmd || redirects.length > 0;
    for (const t of pathTokens(command)) {
      const abs = resolveOne(t);
      if (!hasWrite && protectRead(abs)) return DENY_READ + at(t);
    }
    if (hasWrite) {
      for (const t of redirectTargets(command)) {
        const bare = t.replace(/^["']|["']$/g, "");
        if (BLACKHOLE_RE.test(bare)) continue; // /dev/null、NUL：丢弃输出，不是落盘
        const abs = resolveOne(bare);
        if (!insideOwn(abs)) return DENY_WRITE + at(bare);
      }
      // 写命令（cp/mv/tee/rm...）的目标参数：绝对路径或 ../ 的必须在本租户范围内；
      // 相对路径不做逐 token 判定（cd 检查兜底），探测式列举（ls /c/Python* 不含写命令）本来就不会进来
      if (writeCmd) {
        for (const t of pathTokens(command)) {
          if (BLACKHOLE_RE.test(t.replace(/^["']|["']$/g, ""))) continue; // rm/cp 带 2>/dev/null 尾巴（文档任务曾因此被误杀）
          if (!t.includes("/") && !t.includes("\\")) continue; // 无路径分隔符：文件名，随 cd 落点判定
          if (/[*?]/.test(t)) continue; // glob：探测式列举（曾把 ls /c/Python* 误判成写目标）
          if (/^(?:[a-zA-Z]:)?[\\/]/.test(t) || t.startsWith("..")) {
            const abs = resolveOne(t);
            if (!insideOwn(abs)) return DENY_WRITE + at(t);
          }
        }
        // cd 出本租户范围后执行写命令：相对路径解析不可信，直接拦截
        const cd = command.match(/\bcd\b(?:\s+\/[dD])?\s*"?([^"\n|;&]*)"?(?=\s*(?:&&|;|$|\n))/);
        if (cd) {
          const target = (cd[1] || "").trim();
          const abs = target ? resolveOne(target) : wsPath;
          if (!insideOwn(abs)) return DENY_WRITE + at(target || "cd 出租户范围");
        }
      }
    }
    // 非路径型高危：写注册表、计划任务持久化等常见手段
    if (/\b(schtasks|at\s+\d|taskkill\s+\/f|wmic\s+process\s+call)\b/i.test(command)) return DENY_SYSTEM;
  }
  return null;
}

// ---------- 入口（仅直接执行时；被 import 跑测试不启动 stdin 循环） ----------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const watchdog = setTimeout(() => process.exit(0), 5000); // 纪律 1：看门狗放行
  watchdog.unref();
  let raw = "";
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 1_000_000) process.exit(0); // 纪律 2：异常大输入放行
    }
  } catch { process.exit(0); }
  let payload = null;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  const wsPath = process.env.ZCODE_PORTAL_WS || "";
  const homePath = process.env.ZCODE_PORTAL_HOME || "";
  // 非 portal 派发（缺 env）不拦：本钩子只对门户租户进程生效
  if (!wsPath || !homePath) process.exit(0);
  const tool = String(payload.tool_name || "");
  try {
    const reason = evaluate({
      tool,
      input: payload.tool_input ?? payload.input ?? payload.args ?? "",
      wsPath,
      wsRoot: path.dirname(wsPath),
      homePath,
    });
    if (reason) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      }));
    }
  } catch { process.exit(0); } // 纪律 3：fail-open
  process.exit(0); // 纪律 5
}
