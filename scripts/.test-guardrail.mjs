// guardrail 回归：直接 import portal/guardrail-hook.mjs 的 evaluate()（钩子化后的判定核心）。
// 覆盖：两轮真实误杀原命令（探测命令、rm 带 2>/dev/null 尾巴）+ 破坏场景 + 工作区内正常场景。
import { evaluate } from "../portal/guardrail-hook.mjs";

const ws = ["D:", "proj", "data", "workspaces", "uid", "default"].join("\\");
const wsRoot = ["D:", "proj", "data", "workspaces", "uid"].join("\\");
const home = ["D:", "proj", "data", "users", "uid"].join("\\");
const root = "D:\\proj";
const dataDir = ["D:", "proj", "data"].join("\\");
const kernelDir = ["D:", "proj", "kernel"].join("\\");

const cases = [
  // —— 真实误杀回归（2026-11-02 审计原命令）：应放行 ——
  ["linyu-审计(探测python)", { command: `cd "${ws}" && echo "--- node ---"; node -v 2>&1; echo "--- npm ---"; npm -v 2>&1; echo "--- python pkgs ---"; python -c "help('modules')" 2>/dev/null | tr ' ' '\\n' | grep -iE "^(pandas|numpy|xlsxwriter|openpyxl|win32com)\\$" | head`, description: "Check" }, null],
  ["bxh-审计(探测unzip/python/soffice)", { command: `command -v unzip; command -v 7z; command -v powershell; command -v py; ls /c/Python* -d 2>/dev/null; ls "/c/Program Files/libreoffice/program/soffice.exe" 2>/dev/null`, description: "Check available unzip and python tools" }, null],
  // —— 2026-11-03 误杀回归：写命令带黑洞尾巴 ——
  ["rm/cp 带 2>/dev/null 尾巴", { command: `rm -f .tmp/old.pdf 2>/dev/null; cp "uploads/in.pdf" "output/out.pdf" && echo done` }, null],
  ["写命令目标是黑洞", { command: `cp secret.txt /dev/null 2>&1` }, null],
  ["纯黑洞重定向", { command: `echo drop > /dev/null` }, null],
  // —— 防护回归：必须拒绝 ——
  ["重定向写到工作区外", { command: `echo hi > /etc/passwd` }, "deny"],
  ["重定向写到宿主代码目录", { command: `echo x > ${["D:", "proj", "portal", "server.mjs"].join("\\")}` }, "deny"],
  ["写命令到工作区外", { command: `cp a.txt /c/Windows/temp/x.txt` }, "deny"],
  ["cd 出租户范围后写", { command: `cd /c/Windows && touch evil.txt` }, "deny"],
  ["读宿主 .env", { command: `cat ${["D:", "proj", ".env"].join("\\")}` }, "deny"],
  ["写工作区外 heredoc 落盘", { command: `cat > /c/Windows/bad.txt <<EOF\nhi\nEOF` }, "deny"],
  ["git push --force", { command: `git push --force origin main` }, "deny"],
  ["git reset --hard", { command: `git reset --hard HEAD~3` }, "deny"],
  ["schtasks 持久化", { command: `schtasks /create /tn evil /sc daily /tr calc` }, "deny"],
  ["Write 工具越界", { file_path: ["D:", "proj", "portal", "evil.txt"].join("\\") }, "deny"],
  ["Read 工具读宿主 .env", { tool: "Read", file_path: ["D:", "proj", ".env"].join("\\") }, "deny"],
  ["data/ 其他租户区读取", { tool: "Glob", path: ["D:", "proj", "data", "users", "other"].join("\\") }, "deny"],
  // —— 正常工作：应放行 ——
  ["工作区内写文件", { command: `echo result > ${ws}\\out.txt` }, null],
  ["python 分析脚本写工作区", { command: `python -c "import pandas" > ${ws}\\.tmp\\analysis.log 2>&1` }, null],
  ["工作区内 mkdir/temp 脚本", { command: `mkdir -p ${ws}\\.tmp && python ${ws}\\.tmp\\analyze.py` }, null],
  ["Write 工具写工作区", { file_path: `${ws}\\报告.md` }, null],
  ["Read 工具读工作区", { tool: "Read", file_path: `${ws}\\uploads\\in.pdf` }, null],
  ["HOME 技能目录写入", { tool: "Write", file_path: `${home}\\.zcode\\skills\\x\\SKILL.md` }, null],
];
let pass = 0, fail = 0;
for (const [label, input, expect] of cases) {
  const tool = input.tool || (input.command !== undefined ? "Bash" : "Write");
  const r = evaluate({ tool, input, wsPath: ws, wsRoot, homePath: home, root, dataDir, kernelDir });
  const blocked = !!r;
  const ok = expect === "deny" ? blocked : !blocked;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} -> ${r ? "DENY" : "(放行)"}`);
}
console.log(`\n${pass}/${pass + fail} passed`);
