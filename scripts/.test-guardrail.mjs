// 复现两条审计拦截：提取 server.mjs 的 guardrail 逻辑，用真实审计命令测试
import fs from "node:fs";
const src = fs.readFileSync(new URL("../portal/server.mjs", import.meta.url), "utf8");
const need = [];
for (const name of ["BASH_WRITE_RE", "REDIRECT_RE", "DESTRUCTIVE_RE", "WRITE_TOOLS_RE", "BLACKHOLE_RE", "redirectTargets", "pathTokens", "guardrailCheck"]) {
  const re = new RegExp(`(?:const ${name}\\s*=.*\\n|function ${name}\\([\\s\\S]*?\\n})`, "m");
  const m = src.match(re);
  if (m) need.push(m[0]);
  else console.error("MISS:", name);
}
const check = new Function("path", "ROOT", "DATA_DIR", "KERNEL_DIR", need.join("\n\n") + "; return guardrailCheck;")(
  await import("node:path"),
  "D:\\proj",
  "D:\\proj\\data",
  "D:\\proj\\kernel",
);

const ws = ["D:", "proj", "data", "workspaces", "uid", "default"].join("\\");
const wsRoot = ["D:", "proj", "data", "workspaces", "uid"].join("\\");
const home = ["D:", "proj", "data", "users", "uid"].join("\\");

const cases = [
  // —— 两条真实误杀（审计原命令）：现在应放行 ——
  ["linyu-审计(探测python)", { command: `cd "${ws}" && echo "--- node ---"; node -v 2>&1; echo "--- npm ---"; npm -v 2>&1; echo "--- python pkgs ---"; python -c "help('modules')" 2>/dev/null | tr ' ' '\\n' | grep -iE "^(pandas|numpy|xlsxwriter|openpyxl|win32com)\\$" | head`, description: "Check" }, null],
  ["bxh-审计(探测unzip/python/soffice)", { command: `command -v unzip; command -v 7z; command -v powershell; command -v py; ls /c/Python* -d 2>/dev/null; ls "/c/Program Files/libreoffice/program/soffice.exe" 2>/dev/null`, description: "Check available unzip and python tools" }, null],
  // —— 防护回归：必须仍然拦截 ——
  ["重定向写到工作区外", { command: `echo hi > /etc/passwd` }, "拦截"],
  ["重定向写到宿主代码目录", { command: `echo x > ${["D:", "proj", "portal", "server.mjs"].join("\\")}` }, "拦截"],
  ["写命令到工作区外", { command: `cp a.txt /c/Windows/temp/x.txt` }, "拦截"],
  ["cd 出租户范围后写", { command: `cd /c/Windows && touch evil.txt` }, "拦截"],
  ["读宿主 .env", { command: `cat ${["D:", "proj", ".env"].join("\\")}` }, "拦截"],
  ["写工作区外 heredoc 落盘", { command: `cat > /c/Windows/bad.txt <<EOF\nhi\nEOF` }, "拦截"],
  // —— 正常工作：应放行 ——
  ["工作区内写文件", { command: `echo result > ${ws}\\out.txt` }, null],
  ["python 分析脚本写工作区", { command: `python -c "import pandas" > ${ws}\\.tmp\\analysis.log 2>&1` }, null],
  ["写黑洞设备", { command: `echo drop > /dev/null` }, null],
  ["工作区内 mkdir/temp 脚本", { command: `mkdir -p ${ws}\\.tmp && python ${ws}\\.tmp\\analyze.py` }, null],
];
let pass = 0, fail = 0;
for (const [label, input, expect] of cases) {
  const r = check({ tool: "Bash", input, wsPath: ws, wsRoot, homePath: home });
  const blocked = !!r;
  const ok = expect === "拦截" ? blocked : !blocked;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} -> ${r || "(放行)"}`);
}
console.log(`\n${pass}/${pass + fail} passed`);
