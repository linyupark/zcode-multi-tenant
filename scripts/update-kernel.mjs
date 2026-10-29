#!/usr/bin/env node
/**
 * update-kernel.mjs — zcode 内核升级脚本（零依赖，Node >= 22）
 *
 * 内核 = zcode.cjs（CLI 引擎）+ packages/（官方全局插件与技能）+ provider/zcode-builtin.json
 * 内核放在 kernel/ 下，portal 以只读方式引用；升级期间运行中的会话不受影响（原子切换）。
 *
 * 三个来源（按优先级）：
 *   1. cdn    — 官方 CDN 组件分发（自动探测最新可用版本，sha256 校验）
 *   2. desktop— 本机 ZCode 桌面安装目录（Windows/Linux/macOS 自动探测或 --desktop 指定）
 *   3. manual — 手动放置 kernel/.staging/（自建/官方 repo 构建产物），--commit 提交
 *
 * 用法：
 *   node scripts/update-kernel.mjs --check            # 只查看当前/可用版本
 *   node scripts/update-kernel.mjs                    # 探测并升级到最新可用
 *   node scripts/update-kernel.mjs --source cdn       # 强制走 CDN
 *   node scripts/update-kernel.mjs --source desktop   # 从桌面安装复制
 *   node scripts/update-kernel.mjs --source manual --commit   # 提交 staging 为新内核
 *   node scripts/update-kernel.mjs --rollback         # 回滚到上一个版本
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KERNEL_DIR = path.join(ROOT, "kernel");
const STAGING_DIR = path.join(KERNEL_DIR, ".staging");
const VERSION_FILE = path.join(KERNEL_DIR, "KERNEL_VERSION.json");
const BACKUP_GLOB = /^kernel\.bak-/;

const CDN_BASE = process.env.ZCODE_CDN_BASE || "https://cdn-zcode.z.ai/zcode/electron/releases";
const PLATFORM = os.platform() === "darwin" ? "macos"
  : os.platform() === "win32" ? "windows" : "linux";
const ARCH = os.arch() === "arm64" ? "arm64" : "x64";
const CDN_PLATFORM = `${PLATFORM}-${ARCH === "arm64" ? "arm64" : "x64"}`;

// ---------- utils ----------

const log = (...a) => console.log("[update-kernel]", ...a);
const die = (msg) => { console.error("[update-kernel] ERROR:", msg); process.exit(1); };

function sha256(bufOrFile) {
  if (Buffer.isBuffer(bufOrFile)) return crypto.createHash("sha256").update(bufOrFile).digest("hex");
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(bufOrFile));
  return h.digest("hex");
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 原子切换：当前内核改名备份 → staging 就位；失败则回退 */
function atomicSwap(stageDir, versionMeta) {
  const backup = path.join(ROOT, `kernel.bak-${versionMeta.from || "unknown"}-${Date.now()}`);
  let moved = false;
  if (fs.existsSync(KERNEL_DIR)) {
    // 保留 staging（它是 KERNEL_DIR 的子目录），先移走
    if (fs.existsSync(STAGING_DIR)) fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    fs.renameSync(KERNEL_DIR, backup);
    moved = true;
  }
  try {
    fs.renameSync(stageDir, KERNEL_DIR);
  } catch (e) {
    if (moved) fs.renameSync(backup, KERNEL_DIR);
    die(`新内核就位失败，已恢复原内核: ${e.message}`);
  }
  // 写版本元数据
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ ...versionMeta, updated_at: new Date().toISOString() }, null, 2));
  // 清理旧备份（保留最近 2 个）
  const baks = fs.readdirSync(ROOT).filter((n) => BACKUP_GLOB.test(n)).sort();
  for (const b of baks.slice(0, -2)) rmrf(path.join(ROOT, b));
  return backup;
}

function currentKernel() {
  try {
    const meta = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
    const cli = path.join(KERNEL_DIR, "zcode.cjs");
    if (!fs.existsSync(cli)) return { ...meta, broken: true };
    // 读 CLI 版本（快速探针）
    const r = spawnSync(process.execPath, [cli, "version"], { encoding: "utf8", timeout: 20000 });
    const cliVersion = (r.stdout || "").trim().split("\n")[0] || meta.cli_version || "?";
    return { ...meta, cli_version: cliVersion };
  } catch {
    return null;
  }
}

// ---------- source: cdn ----------

/** 探测 CDN 上「manifest 存在 + glm 组件可下载」的最高版本（新版组件包有延迟上线，需回退探测） */
async function probeCdnLatest() {
  const candidates = [];
  // 基线 3.12.x 已知可用；向上探测 + 版本号兜底
  for (let mi = 12; mi <= 20; mi++)
    for (let pa = 0; pa <= 8; pa++) candidates.push(`3.${mi}.${pa}`);
  const found = [];
  await Promise.all(candidates.map(async (v) => {
    try {
      const r = await fetch(`${CDN_BASE}/${v}/manifest-linux-x64.json`, { method: "GET", signal: AbortSignal.timeout(8000) });
      if (r.ok) found.push(v);
    } catch { /* ignore */ }
  }));
  if (!found.length) return null;
  found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // 从最高往下找第一个 glm 组件包真实可下载的版本
  for (const v of found.reverse()) {
    try {
      const m = await (await fetch(`${CDN_BASE}/${v}/manifest-linux-x64.json`, { signal: AbortSignal.timeout(8000) })).json();
      const glm = (m.components || []).find((c) => c.id === "glm");
      if (!glm) continue;
      const url = `${CDN_BASE}/${v}/${glm.artifactPath.split("/").map(encodeURIComponent).join("/")}`;
      const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (head.ok) return { version: v, glm };
    } catch { /* try next */ }
  }
  return null;
}

async function installFromCdn() {
  const probe = await probeCdnLatest();
  if (!probe) die("CDN 上没有找到可用的内核版本（网络或上游问题）");
  const { version, glm } = probe;
  log(`CDN 最新可用版本: ${version} (glm ${glm.version})`);
  log("下载 glm 组件包 …");
  const url = `${CDN_BASE}/${version}/${glm.artifactPath.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) die(`组件包下载失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== glm.sha256) die(`SHA256 校验失败（清单 ${glm.sha256.slice(0, 12)}… vs 实际 ${actual.slice(0, 12)}…）`);
  log("SHA256 校验通过，解包 …");
  const work = path.join(ROOT, ".kernel-work");
  rmrf(work); fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "glm.tar.gz"), buf);
  const r = spawnSync("tar", ["-xzf", path.join(work, "glm.tar.gz"), "-C", work], { encoding: "utf8" });
  if (r.status !== 0) die(`解包失败: ${r.stderr}`);
  // CDN 包不含 provider/（0.16.x 需要桌面版附带），若旧内核有则保留
  const oldProvider = path.join(KERNEL_DIR, "provider");
  if (fs.existsSync(oldProvider)) copyDir(oldProvider, path.join(work, "provider"));
  rmrf(path.join(work, "glm.tar.gz"));
  return { stageDir: work, version, cliVersion: null, source: "cdn" };
}

// ---------- source: desktop ----------

function findDesktopGlm(explicit) {
  const candidates = explicit ? [explicit] : [
    process.env.ZCODE_DESKTOP_DIR,
    "C:/Program Files/ZCode/resources/glm",
    "/opt/ZCode/resources/glm",
    "/usr/lib/zcode/resources/glm",
    "/Applications/ZCode.app/Contents/Resources/glm",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "zcode.cjs"))) return c;
  }
  return null;
}

function installFromDesktop(explicit) {
  const src = findDesktopGlm(explicit);
  if (!src) die("找不到 ZCode 桌面安装目录，用 --desktop <path> 指定（…/ZCode/resources/glm）");
  const work = path.join(ROOT, ".kernel-work");
  rmrf(work);
  log(`从桌面安装复制内核: ${src}`);
  copyDir(src, work);
  // 桌面版的 builtin provider 配置在 resources/config/provider/，一并复制（headless 必需）
  const confRoot = path.dirname(src); // .../resources
  const providerSrc = path.join(confRoot, "config", "provider", "zcode-builtin.json");
  if (fs.existsSync(providerSrc)) {
    fs.mkdirSync(path.join(work, "provider"), { recursive: true });
    fs.copyFileSync(providerSrc, path.join(work, "provider", "zcode-builtin.json"));
  } else {
    log("⚠ 桌面安装未找到 config/provider/zcode-builtin.json，headless prompt 可能需要手动补");
  }
  // 读 CLI 版本
  const r = spawnSync(process.execPath, [path.join(work, "zcode.cjs"), "version"], { encoding: "utf8", timeout: 20000 });
  const cliVersion = (r.stdout || "").trim().split("\n")[0] || "?";
  return { stageDir: work, version: `desktop-${cliVersion}`, cliVersion, source: "desktop" };
}

// ---------- source: manual ----------

function installFromManual() {
  if (!fs.existsSync(path.join(STAGING_DIR, "zcode.cjs")))
    die(`staging 目录缺少 zcode.cjs：把构建产物放进 kernel/.staging/（zcode.cjs + packages/ [+ provider/]）后加 --commit`);
  const work = path.join(ROOT, ".kernel-work");
  rmrf(work); fs.renameSync(STAGING_DIR, work);
  const r = spawnSync(process.execPath, [path.join(work, "zcode.cjs"), "version"], { encoding: "utf8", timeout: 20000 });
  const cliVersion = (r.stdout || "").trim().split("\n")[0] || "?";
  return { stageDir: work, version: `manual-${cliVersion}`, cliVersion, source: "manual" };
}

// ---------- rollback ----------

function rollback() {
  const baks = fs.readdirSync(ROOT).filter((n) => BACKUP_GLOB.test(n))
    .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
  if (!baks.length) die("没有可回滚的备份");
  const target = path.join(ROOT, baks[0]);
  log(`回滚到 ${baks[0]}`);
  rmrf(KERNEL_DIR);
  fs.renameSync(target, KERNEL_DIR);
  log("完成。");
}

// ---------- main ----------

const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = (k) => args.includes(k);

if (has("--rollback")) { rollback(); process.exit(0); }

const cur = currentKernel();
if (has("--check") || (!has("--source") && !has("--commit") && cur)) {
  log("当前内核:", cur ? `${cur.version} (cli ${cur.cli_version || "?"})` : "未安装");
  log("探测 CDN 最新 …");
  const probe = await probeCdnLatest();
  log("CDN 最新可用:", probe ? `${probe.version} (glm ${probe.glm.version})` : "不可达");
  log("");
  log("升级: node scripts/update-kernel.mjs --source cdn|desktop|manual [--commit]");
  log("回滚: node scripts/update-kernel.mjs --rollback");
  process.exit(0);
}

const source = get("--source") || "cdn";
let result;
if (source === "cdn") result = await installFromCdn();
else if (source === "desktop") result = installFromDesktop(get("--desktop"));
else if (source === "manual") {
  result = installFromManual();
  if (!has("--commit")) {
    log("staging 已就绪。检查无误后执行: node scripts/update-kernel.mjs --source manual --commit");
    process.exit(0);
  }
} else die(`未知 source: ${source}（可选 cdn | desktop | manual）`);

// smoke 校验：新内核能跑 version
const vr = spawnSync(process.execPath, [path.join(result.stageDir, "zcode.cjs"), "version"], { encoding: "utf8", timeout: 20000 });
if (vr.status !== 0) die(`新内核 smoke 校验失败: ${vr.stderr}`);
log(`smoke 通过 (cli ${(vr.stdout || "").trim()})，原子切换 …`);

const backup = atomicSwap(result.stageDir, {
  from: cur?.version || null,
  version: result.version,
  cli_version: result.cliVersion || (vr.stdout || "").trim(),
  source: result.source,
});
log(`✓ 内核已更新 → ${result.version}（旧内核备份: ${path.basename(backup)}）`);
log("portal 重启后生效；正在运行的会话不受影响。");
