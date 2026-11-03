#!/usr/bin/env node
/**
 * zcode-multi-tenant portal — 单文件、零 npm 依赖的 Node 服务（Node >= 22）
 *
 * 职责：
 *   1. 多用户注册 / 登录（用户名+密码，scrypt 加盐哈希，HttpOnly session cookie）
 *   2. 每用户独立数据目录 data/users/<uid>/ 作为该用户专属 HOME（凭据/会话/用户级技能天然隔离）
 *   3. 派发消息时以 headless 模式拉起官方 zcode.cjs（--prompt / --resume / --output-format stream-json），
 *      注入该用户专属 HOME/USERPROFILE —— portal 进程本身不碰任何用户凭据
 *   4. SSE 实时回传 CLI 事件流；会话持久化在用户自己的 ~/.zcode/cli/db/db.sqlite
 *
 * 技能三层（由 zcode CLI 原生支持，portal 不做任何特殊处理）：
 *   - kernel/glm/packages/         官方全局插件与技能（随内核升级，全员共享，只读）
 *   - data/users/<uid>/.zcode/skills/   用户级技能（用户可自建，跨工作区可见）
 *   - data/workspaces/<uid>/<ws>/.zcode/skills/  工作区级技能（随项目走）
 *
 * 内核升级：scripts/update-kernel.mjs（多源、sha256 校验、原子切换），portal 代码零改动。
 *
 * 安全模型（内网自部署）：
 *   - session cookie HttpOnly + SameSite=Lax；密码 scrypt 加盐
 *   - 用户输入的模型凭据只写进该用户自己的 HOME（config.json, chmod 600），portal 不落日志
 *   - CLI 以 yolo 之外的模式默认 plan；可在用户设置里切换（build/edit/plan/guarded）
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const USERS_DIR = path.join(DATA_DIR, "users");
const WS_DIR = path.join(DATA_DIR, "workspaces");
const KERNEL_DIR = path.join(ROOT, "kernel");
const KERNEL_CLI = path.join(KERNEL_DIR, "zcode.cjs");
const STATIC_DIR = path.join(ROOT, "portal", "static");

const CONFIG = {
  port: Number(process.env.PORT || 9900),
  host: process.env.HOST || "0.0.0.0",
  secret: process.env.FLASK_SECRET || crypto.createHash("sha256").update(`zcode-portal|${DATA_DIR}`).digest("hex"), // 数据目录派生：重启不失效；生产建议显式设 FLASK_SECRET
  sessionTtl: Number(process.env.SESSION_TTL_SEC || 30 * 24 * 3600), // 登录有效期默认 30 天
  kernelCli: process.env.ZCODE_CLI_ENTRY || KERNEL_CLI,
  defaultModel: process.env.ZCODE_MODEL || "",
  defaultMode: process.env.ZCODE_MODE || "yolo",
  builtinProviderFile: process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE || path.join(KERNEL_DIR, "provider", "zcode-builtin.json"),
  adminBootstrap: process.env.ADMIN_USER || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
};

// ---------- paths / bootstrap ----------

for (const d of [DATA_DIR, USERS_DIR, WS_DIR]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(CONFIG.kernelCli)) {
  console.error(`[portal] 内核未找到: ${CONFIG.kernelCli}`);
  console.error(`[portal] 请先执行: node scripts/update-kernel.mjs --source desktop`);
  process.exit(1);
}

// ---------- utils ----------

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), "[portal]", ...a);
const send = (res, code, body, headers = {}) => {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(data);
};
// Node writeHead 的 Set-Cookie 需要数组形式才能发多个；headers["Set-Cookie"] 传数组时原生支持。
// （writeHead 对 Set-Cookie 有特判：值是数组就发多条，无需特殊处理。）
const readBody = (req, limit = 10 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
const readJson = async (req) => { try { return JSON.parse((await readBody(req)).toString("utf8") || "{}"); } catch { return {}; } };
// 拒绝解码失败的文本（终端 GBK 输入等会产生 U+FFFD 替换符）
const cleanText = (v) => typeof v === "string" && !v.includes("�") ? v : "";

function sign(value) {
  const mac = crypto.createHmac("sha256", CONFIG.secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}
function unsign(signed) {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i), mac = signed.slice(i + 1);
  const expect = crypto.createHmac("sha256", CONFIG.secret).update(value).digest("base64url");
  try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect)) ? value : null; } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------- user store（JSON 文件，无外部数据库） ----------

const USERS_FILE = path.join(DATA_DIR, "users.json");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, rec) {
  const { hash } = hashPassword(password, rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(rec.hash));
}
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function uidOf(username) {
  return crypto.createHash("sha256").update(`zcode-portal:${username.toLowerCase()}`).digest("hex").slice(0, 16);
}
function isValidUid(uid) { return /^[a-f0-9]{16}$/.test(uid); }

/** 用户 HOME（作为该用户专属 USERPROFILE/HOME 传给 CLI） */
function userHome(uid) { return path.join(USERS_DIR, uid); }
/** 用户工作区根 */
function userWsRoot(uid) { return path.join(WS_DIR, uid); }
function wsDir(uid, ws) { return path.join(userWsRoot(uid), ws); }

/** 创建用户数据目录 + 初始 CLI 配置。幂等。
 *  模型 provider 由管理员在后台统一配置（data/model.json），这里自动套用到每个用户 HOME；
 *  用户无感知、无配置入口。管理员改配置后对新用户立即生效，对老用户在下次「保存配置」时全量刷新。 */
function adminModelConfigPath() { return path.join(DATA_DIR, "model.json"); }

function loadAdminModelConfig() {
  try { return JSON.parse(fs.readFileSync(adminModelConfigPath(), "utf8")); } catch { return null; }
}
function saveAdminModelConfig(cfg) {
  fs.writeFileSync(adminModelConfigPath(), JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(adminModelConfigPath(), 0o600); } catch { /* win 忽略 */ }
}

/** 管理后台提交的模型列表（数组，每项一套能力配置）。兼容旧的「对象 id→配置」格式。 */
function normalizeAdminModels(models) {
  const raw = Array.isArray(models)
    ? models.map((m) => (typeof m === "string" ? { id: m } : m)).filter(Boolean)
    : Object.entries(models || {}).map(([id, v]) => ({ id, ...(v && typeof v === "object" ? v : {}) }));
  const out = [], seen = new Set();
  for (const m of raw) {
    const id = String(m.id ?? m.modelId ?? "").trim();
    if (!id) continue;
    if (id.length > 200) throw new Error(`模型 ID 过长：${id.slice(0, 40)}…`);
    if (seen.has(id)) throw new Error(`模型 ID 重复：${id}`);
    seen.add(id);
    const entry = { id, name: cleanText(String(m.name ?? "")).trim() || id };
    for (const [key, label] of [["contextWindow", "上下文"], ["maxOutputTokens", "最大输出"]]) {
      const value = m[key];
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new Error(`${id} 的${label}必须是正整数（≤ 10000000）`);
      entry[key] = n;
    }
    if (typeof m.supportsImages === "boolean") entry.supportsImages = m.supportsImages;
    if (typeof m.supportsPdf === "boolean") entry.supportsPdf = m.supportsPdf;
    if (typeof m.supportsVideo === "boolean") entry.supportsVideo = m.supportsVideo;
    const levels = Array.isArray(m.reasoningLevels)
      ? m.reasoningLevels
      : typeof m.reasoningLevels === "string" ? m.reasoningLevels.split(",") : [];
    const clean = [...new Set(levels.map((s) => cleanText(String(s)).trim()).filter(Boolean))];
    if (clean.length) entry.reasoningLevels = clean.slice(0, 20);
    out.push(entry);
  }
  if (!out.length) throw new Error("模型列表不能为空");
  return out;
}

/**
 * 生成 CLI 新格式的个人 provider 配置（provider_config.json）。
 * 只有这个文件能表达每模型的能力：上下文窗口、最大输出、视觉/PDF/视频、思考等级。
 * 旧 config.json 的 provider.models 仍会写一份（兼容旧内核），但新内核只从中导入 id/上下文/最大输出。
 */
function buildPersonalProviderConfig(adminCfg) {
  const providers = adminCfg?.provider || {};
  const providerOrder = [], providerRules = [], modelRules = [];
  for (const [pid, p] of Object.entries(providers)) {
    const modelIds = Object.keys(p?.models || {});
    const apiKey = p?.options?.apiKey || "";
    const baseURL = p?.options?.baseURL || "";
    if (!modelIds.length || !apiKey || !baseURL) continue;
    providerOrder.push(pid);
    providerRules.push({
      providerId: pid,
      providerName: p.name || pid,
      config: {
        group: "standard-personal",
        access: { type: "api-key", apiKey },
        api: { type: p.kind === "anthropic" ? "anthropic-messages" : "openai-chat-completions", baseUrl: baseURL },
        personalModelIds: modelIds,
        modelOrder: modelIds,
      },
    });
    for (const mid of modelIds) {
      const m = p.models[mid] || {};
      const config = { enabled: true };
      const properties = {};
      if (Number.isInteger(m.contextWindow) && m.contextWindow > 0) properties.contextWindow = m.contextWindow;
      const inputFormat = {};
      if (typeof m.supportsImages === "boolean") inputFormat.supportsImage = m.supportsImages;
      if (typeof m.supportsPdf === "boolean") inputFormat.supportsPdf = m.supportsPdf;
      if (typeof m.supportsVideo === "boolean") inputFormat.supportsVideo = m.supportsVideo;
      if (Object.keys(inputFormat).length) properties.inputFormat = inputFormat;
      if (Object.keys(properties).length) config.properties = properties;
      const optionSpecs = {};
      if (Number.isInteger(m.maxOutputTokens) && m.maxOutputTokens > 0) optionSpecs.maxOutputTokens = { max: m.maxOutputTokens };
      const levels = Array.isArray(m.reasoningLevels) ? m.reasoningLevels.filter(Boolean) : [];
      if (levels.length) optionSpecs.reasoningLevel = { values: levels };
      if (Object.keys(optionSpecs).length) config.optionSpecs = optionSpecs;
      modelRules.push({ providerId: pid, modelId: mid, config });
    }
  }
  if (!providerOrder.length) return null;
  // 默认模型：main 有效则用 main；否则回落到第一个 provider 的第一个模型
  let defaultModelSelection = null;
  const available = new Set(providerOrder);
  const [mainPid, ...mainRest] = String(adminCfg.main || "").split("/");
  const mainMid = mainRest.join("/");
  if (available.has(mainPid) && providers[mainPid]?.models?.[mainMid]) defaultModelSelection = { providerId: mainPid, modelId: mainMid };
  else {
    const pid = providerOrder[0];
    const mid = Object.keys(providers[pid].models)[0];
    if (mid) defaultModelSelection = { providerId: pid, modelId: mid };
  }
  return {
    schemaVersion: 1,
    config: {
      providerOrder,
      providerConfigRules: { providerRules },
      modelConfigRules: { providerModelRules: modelRules, manualProviderModelRules: [] },
      ...(defaultModelSelection ? { defaultModelSelection } : {}),
    },
  };
}

/** 把管理员模型配置写入指定用户 HOME 的 cli/config.json（幂等，保留用户其他字段）。
 *  deep=true 时不会经 ensureUserHome 再回调自己（避免 ensureUserHome→apply→ensure 死循环）。 */
function applyAdminModelToUser(uid, adminCfg = loadAdminModelConfig(), deep = false) {
  if (!adminCfg || !adminCfg.provider || !Object.keys(adminCfg.provider).length) return false;
  const home = deep ? userHome(uid) : ensureUserHome(uid);
  const cfgPath = path.join(home, ".zcode", "cli", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.provider = adminCfg.provider;
  const firstProvider = adminCfg.provider[Object.keys(adminCfg.provider)[0]];
  cfg.model = { ...(cfg.model || {}), main: adminCfg.main || (Object.keys(adminCfg.provider)[0] + "/" + (firstProvider?.defaultModel || "")) };
  if (!cfg.model.main || cfg.model.main.endsWith("/")) delete cfg.model.main;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  // 每模型能力（上下文/最大输出/视觉/思考等级）写进新格式 provider_config.json —— CLI 优先读取它
  const personalPath = path.join(home, ".zcode", "cli", "provider_config.json");
  const personalCfg = buildPersonalProviderConfig(adminCfg);
  if (personalCfg) {
    fs.writeFileSync(personalPath, JSON.stringify(personalCfg, null, 2));
    try { fs.chmodSync(personalPath, 0o600); } catch { /* win 忽略 */ }
  } else { try { fs.unlinkSync(personalPath); } catch { /* 没有就忽略 */ } }
  return true;
}

function ensureUserHome(uid) {
  const home = userHome(uid);
  const cliDir = path.join(home, ".zcode", "cli");
  fs.mkdirSync(path.join(cliDir, "db"), { recursive: true });
  fs.mkdirSync(path.join(home, ".zcode", "skills"), { recursive: true }); // 用户级技能
  const cfgPath = path.join(cliDir, "config.json");
  if (!fs.existsSync(cfgPath)) {
    const cfg = {
      _portal: "generated by zcode-multi-tenant portal; 模型配置由管理员统一下发",
      provider: {},
      model: {},
      mcp: { servers: {} },
      features: { skill: true, mcp: true, subagent: true, memory: true },
      skills: { enabled: true },
      plugins: { enabled: true },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }
  // 管理员统一下发：模型 + MCP + 企业全局技能（幂等）
  applyAdminModelToUser(uid, loadAdminModelConfig(), true);
  applyAdminMcpToUser(uid);
  injectGlobalSkills(uid);
  return home;
}

/** 运行记录：runId → run hub 条目。CLI 子进程生命周期与 SSE 连接解耦：
 *  - SSE 断开（刷新/关页）只解除订阅，不再 kill 子进程，AI 继续跑完；
 *  - 事件全部进 ring 缓冲，新订阅者先整段重放再续播（断线重连/刷新恢复）；
 *  - 跨页面共享：侧栏转圈用 running 列表；恢复会话用 attach 重连。
 *  key = `${uid}/${ws}/${runId}`；run 内含 uid/ws 做越权过滤。 */
const runningSessions = new Map();

const RUN_RING_MAX = 4000; // 事件缓冲上限（超过后整段丢弃早期事件；单轮工具事件远达不到）

function runKey(run) { return `${run.uid}/${run.ws}/${run.runId}`; }

/** 订阅一个 run：返回 {replay, unsubscribe}。replay=订阅时点之前的缓冲事件（含 end 则已完结）。 */
function runSubscribe(run, res) {
  const sub = { res };
  run.subs.add(sub);
  const replay = { events: run.ring.slice(), ended: run.ended };
  return {
    replay,
    unsubscribe() { run.subs.delete(sub); },
  };
}

/** 向 run 的所有订阅者推送事件（无订阅者也照常进缓冲，attach 后可补看） */
function runEmit(run, event, data) {
  run.ring.push({ event, data });
  if (run.ring.length > RUN_RING_MAX) run.ring.splice(0, run.ring.length - RUN_RING_MAX);
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of run.subs) {
    try { sub.res.write(frame); } catch { /* 断开的订阅者由 req close 清理 */ }
  }
}

/** 兜底清理：超过 2 小时的已完结 run 从内存移除（正常在 emit end 后延迟清理） */
function sweepRuns() {
  const now = Date.now();
  for (const [key, run] of runningSessions) {
    if (run.ended && now - run.endedAt > 2 * 3600_000) runningSessions.delete(key);
  }
}

// ---------- 品牌与外观（白标配置，管理员设定，租户端动态套用） ----------

const brandingPath = () => path.join(DATA_DIR, "branding.json");
const BRAND_DEFAULTS = { appName: "", logoText: "", logoUrl: "", tagline: "", accent: "", customCSS: "", botName: "" };

function loadBranding() {
  try { return { ...BRAND_DEFAULTS, ...JSON.parse(fs.readFileSync(brandingPath(), "utf8")) }; }
  catch { return { ...BRAND_DEFAULTS }; }
}
function saveBranding(cfg) {
  fs.writeFileSync(brandingPath(), JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(brandingPath(), 0o600); } catch { /* win */ }
}

// ---------- 全局 MCP 配置（管理员统一设定，下发全部租户） ----------

const mcpConfigPath = () => path.join(DATA_DIR, "mcp.json");

function loadAdminMcp() {
  try { return JSON.parse(fs.readFileSync(mcpConfigPath(), "utf8")); } catch { return { servers: {} }; }
}
function saveAdminMcp(cfg) {
  fs.writeFileSync(mcpConfigPath(), JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(mcpConfigPath(), 0o600); } catch { /* win */ }
}

/** 把管理员 MCP 配置合并进用户 HOME 的 cli/config.json（全量覆盖 mcp.servers，保留其他字段） */
function applyAdminMcpToUser(uid, adminCfg = loadAdminMcp()) {
  const home = userHome(uid);
  const cfgPath = path.join(home, ".zcode", "cli", "config.json");
  if (!fs.existsSync(cfgPath)) return false;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.mcp = { ...(cfg.mcp || {}), servers: adminCfg?.servers || {} };
    cfg.features = { ...(cfg.features || {}), mcp: Object.keys(cfg.mcp.servers).length > 0 };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    return true;
  } catch { return false; }
}

// ---------- 企业全局技能（管理员放置于 data/skills/，注入每个租户的用户级技能目录） ----------
// 语义：data/skills/<技能名>/SKILL.md … 是"全员共享的企业技能"；复制（非软链，Windows 兼容）
// 注入到 data/users/<uid>/.zcode/skills/<技能名>/。租户自建技能同名时以租户的为准（不覆盖）。
// "重新注入" = 增量复制 + 删除"之前注入过、现已从 data/skills 移除"的技能（用 .admin-skill 标记识别）。

const GLOBAL_SKILLS_DIR = path.join(DATA_DIR, "skills");
const ADMIN_SKILL_MARK = ".admin-skill";

function listGlobalSkills() {
  try {
    return fs.readdirSync(GLOBAL_SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(GLOBAL_SKILLS_DIR, e.name, "SKILL.md")))
      .map((e) => e.name);
  } catch { return []; }
}

function copyDirOverwrite(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirOverwrite(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 把 data/skills/ 注入该租户的用户级技能目录。返回注入的技能数。 */
function injectGlobalSkills(uid) {
  if (!fs.existsSync(GLOBAL_SKILLS_DIR)) return 0;
  const skills = listGlobalSkills();
  const dstBase = path.join(userHome(uid), ".zcode", "skills");
  fs.mkdirSync(dstBase, { recursive: true });
  for (const name of skills) {
    const dst = path.join(dstBase, name);
    if (fs.existsSync(dst) && !fs.existsSync(path.join(dst, ADMIN_SKILL_MARK))) continue; // 租户自建同名，不覆盖
    copyDirOverwrite(path.join(GLOBAL_SKILLS_DIR, name), dst);
    fs.writeFileSync(path.join(dst, ADMIN_SKILL_MARK), "injected by portal admin\n");
  }
  // 清理：之前注入过、但现在 data/skills 里已删除的
  try {
    for (const e of fs.readdirSync(dstBase, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const mark = path.join(dstBase, e.name, ADMIN_SKILL_MARK);
      if (fs.existsSync(mark) && !skills.includes(e.name)) {
        fs.rmSync(path.join(dstBase, e.name), { recursive: true, force: true });
      }
    }
  } catch { /* ignore */ }
  return skills.length;
}

/** MCP server 条目校验：command 型或 url 型二选一 */
function validateMcpServer(entry) {
  if (!entry || typeof entry !== "object") return "条目缺失";
  const { command, url } = entry;
  if (!command && !url) return "command 与 url 至少填一个";
  if (command && url) return "command 与 url 只能二选一";
  if (command && typeof command !== "string") return "command 非法";
  if (url && !/^https?:\/\//.test(url)) return "url 需以 http(s):// 开头";
  if (entry.args && !Array.isArray(entry.args)) return "args 需为数组";
  if (entry.env && (typeof entry.env !== "object" || Array.isArray(entry.env))) return "env 需为对象";
  if (entry.headers && (typeof entry.headers !== "object" || Array.isArray(entry.headers))) return "headers 需为对象";
  return null;
}

// ---------- MCP tools 探测：MCP JSON-RPC（initialize → tools/list），零依赖 ----------
// 支持 stdio（command 型）/ Streamable HTTP（POST，JSON 或 SSE 响应）/ 旧版 HTTP+SSE（GET 拿 endpoint）

const MCP_INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "zcode-portal", version: "1.0" } } };
const MCP_INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const MCP_TOOLS = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

function normalizeTools(result) {
  return (result?.tools || []).map((t) => ({
    name: t.name,
    description: String(t.description || "").replace(/\s+/g, " ").slice(0, 240),
  }));
}

function probeStdio(entry, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(entry.command, entry.args || [], {
        env: { ...process.env, ...(entry.env || {}) },
        shell: os.platform() === "win32",
        windowsHide: true,
      });
    } catch (e) { return resolve({ ok: false, error: "启动失败: " + e.message }); }
    let buf = "", done = false;
    const finish = (r) => { if (done) return; done = true; try { child.kill(); } catch { /* ignore */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: "超时 " + timeoutMs + "ms（服务器可能不是 MCP stdio 服务）" }), timeoutMs);
    const onLine = (line) => {
      line = line.trim(); if (!line) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id === 1) {
        if (msg.error) return finish({ ok: false, error: "initialize: " + (msg.error.message || JSON.stringify(msg.error)) });
        try {
          child.stdin.write(JSON.stringify(MCP_INITIALIZED) + "\n");
          child.stdin.write(JSON.stringify(MCP_TOOLS) + "\n");
        } catch { /* ignore */ }
      } else if (msg.id === 2) {
        if (msg.error) return finish({ ok: false, error: "tools/list: " + (msg.error.message || JSON.stringify(msg.error)) });
        finish({ ok: true, tools: normalizeTools(msg.result) });
      }
    };
    child.stdout.on("data", (c) => {
      buf += c.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); onLine(line); }
    });
    child.stderr.on("data", () => { /* ignore */ });
    child.on("error", (e) => finish({ ok: false, error: e.message }));
    child.on("close", () => { if (!done) finish({ ok: false, error: "进程提前退出（不是 MCP stdio 服务或启动失败）" }); });
    try { child.stdin.write(JSON.stringify(MCP_INIT) + "\n"); } catch (e) { finish({ ok: false, error: "stdin 写入失败: " + e.message }); }
  });
}

async function parseMcpHttpBody(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try { const m = JSON.parse(t.slice(5).trim()); if (m && (m.result || m.error)) return m; } catch { /* next */ }
    }
    return null;
  }
  try { return await res.json(); } catch { return null; }
}

async function probeHttp(entry, timeoutMs) {
  const baseHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(entry.headers || {}) };
  try {
    let res = await fetch(entry.url, { method: "POST", headers: baseHeaders, body: JSON.stringify(MCP_INIT), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error("initialize HTTP " + res.status);
    const sessionId = res.headers.get("mcp-session-id");
    const initMsg = await parseMcpHttpBody(res);
    if (!initMsg) throw new Error("initialize 无有效响应");
    if (initMsg.error) return { ok: false, error: "initialize: " + (initMsg.error.message || JSON.stringify(initMsg.error)) };
    const h2 = { ...baseHeaders };
    if (sessionId) h2["Mcp-Session-Id"] = sessionId;
    await fetch(entry.url, { method: "POST", headers: h2, body: JSON.stringify(MCP_INITIALIZED), signal: AbortSignal.timeout(timeoutMs) }).catch(() => {});
    res = await fetch(entry.url, { method: "POST", headers: h2, body: JSON.stringify(MCP_TOOLS), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error("tools/list HTTP " + res.status);
    const listMsg = await parseMcpHttpBody(res);
    if (!listMsg) throw new Error("tools/list 无有效响应");
    if (listMsg.error) return { ok: false, error: "tools/list: " + (listMsg.error.message || JSON.stringify(listMsg.error)) };
    return { ok: true, tools: normalizeTools(listMsg.result) };
  } catch (e) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const sseRes = await fetch(entry.url, { headers: { Accept: "text/event-stream", ...(entry.headers || {}) }, signal: ctrl.signal });
      if (!sseRes.ok) throw new Error("SSE HTTP " + sseRes.status);
      const reader = sseRes.body.getReader();
      const dec = new TextDecoder();
      let buf = "", endpoint = null, resultMsg = null, sent = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = (frame.split("\n").find((l) => l.startsWith("event:")) || "").slice(6).trim();
          const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
          if (!dataLines) continue;
          if (ev === "endpoint") { endpoint = new URL(dataLines, entry.url).href; continue; }
          try {
            const m = JSON.parse(dataLines);
            if (m.id === 2) { resultMsg = m; break; }
            if (m.id === 1 && endpoint && !sent) {
              sent = true;
              await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(entry.headers || {}) }, body: JSON.stringify(MCP_INITIALIZED) }).catch(() => {});
              await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(entry.headers || {}) }, body: JSON.stringify(MCP_TOOLS) }).catch(() => {});
            }
          } catch { /* not json */ }
        }
        if (resultMsg) break;
        if (endpoint && !sent) {
          sent = true;
          await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(entry.headers || {}) }, body: JSON.stringify(MCP_INIT) }).catch(() => {});
        }
      }
      clearTimeout(timer);
      try { reader.cancel(); } catch { /* ignore */ }
      if (resultMsg?.error) return { ok: false, error: "tools/list: " + (resultMsg.error.message || JSON.stringify(resultMsg.error)) };
      if (resultMsg) return { ok: true, tools: normalizeTools(resultMsg.result) };
      throw new Error("SSE 流未返回 tools/list 结果");
    } catch (e2) {
      return { ok: false, error: e.message + "；旧版 SSE 也不通: " + e2.message };
    }
  }
}

async function probeMcpServer(entry, timeoutMs = 15000) {
  const err = validateMcpServer(entry);
  if (err) return { ok: false, error: err };
  return entry.command ? await probeStdio(entry, timeoutMs) : await probeHttp(entry, timeoutMs);
}
// ---------- auth middleware ----------

function getSessionUser(req) {
  // 会话来源优先级：zportal（租户自己的登录）> zimp（admin 模拟登录）。
  // 分开存：模拟登录不覆盖租户/管理员在浏览器里的既有登录态。
  const cookies = parseCookies(req);
  const sid = cookies.zportal || cookies.zimp;
  if (!sid) return null;
  const value = unsign(sid);
  if (!value) return null;
  const [uid, ts] = value.split("|");
  if (!isValidUid(uid) || Date.now() - Number(ts) > CONFIG.sessionTtl * 1000) return null;
  const users = loadUsers();
  if (!users[uid]) return null;
  // active 未定义的老账号视为已启用；自注册新账号默认 false
  return {
    uid,
    username: users[uid].username,
    displayName: users[uid].displayName || users[uid].username,
    active: users[uid].active !== false,
    impersonated: !cookies.zportal && !!cookies.zimp || undefined,
  };
}

/** 独立管理员会话：cookie zadmin = sign("admin|ts")，与用户会话完全分开 */
function isAdminSession(req) {
  const sid = parseCookies(req).zadmin;
  if (!sid) return false;
  const value = unsign(sid);
  if (!value) return false;
  const [tag, ts] = value.split("|");
  return tag === "admin" && Date.now() - Number(ts) < CONFIG.sessionTtl * 1000;
}
function adminCookieHeader(maxAge = CONFIG.sessionTtl) {
  return `zadmin=${encodeURIComponent(sign(`admin|${Date.now()}`))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// ---------- CLI bridge ----------

function cliEnv(uid) {
  const home = ensureUserHome(uid);
  const env = { ...process.env };
  if (os.platform() === "win32") { env.USERPROFILE = home; env.HOME = home; }
  else { env.HOME = home; env.USER = "nobody"; }
  delete env.ZCODE_MODEL; delete env.ZCODE_API_KEY; delete env.ZCODE_BASE_URL; // 防止宿主泄漏凭据
  if (fs.existsSync(CONFIG.builtinProviderFile)) {
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = CONFIG.builtinProviderFile;
    env.ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE = CONFIG.builtinProviderFile;
  }
  // 每租户的个人 provider 配置（含每模型能力）；同时防止宿主 env 把管理员自己的配置泄漏进租户进程
  const personalProviderFile = path.join(home, ".zcode", "cli", "provider_config.json");
  if (fs.existsSync(personalProviderFile)) env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = personalProviderFile;
  else delete env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  env.ZCODE_PORTAL_HOME = home; // 供 hooks / 技能识别 portal 环境
  return env;
}

/**
 * 派发一条消息。返回 child process（stream-json 模式，stdout 按行 JSON 事件）。
 * attachments: 工作区内相对路径数组（uploads/ 下），对齐 zcode --attach 官方契约。
 */
function dispatchPrompt({ uid, ws, message, sessionId, mode, model, attachments }) {
  stampAgentsMd(uid); // 每次派发前重写租户全局 AGENTS.md（防篡改自愈）
  const wsPath = wsDir(uid, ws);
  const args = [
    CONFIG.kernelCli,
    "--prompt", message,
    "--output-format", "stream-json",
    "--mode", mode || CONFIG.defaultMode,
    "--cwd", wsPath,
    "--verbose",
  ];
  for (const rel of attachments || []) {
    const abs = path.resolve(wsPath, rel);
    if (abs.startsWith(wsPath + path.sep) && fs.existsSync(abs)) args.push("--attach", abs);
  }
  if (sessionId) args.push("--resume", sessionId);
  const env = cliEnv(uid);
  if (model) env.ZCODE_MODEL = model; // 官方契约：per-run 模型覆盖
  const child = spawn(process.execPath, args, { env, cwd: wsPath });
  return child;
}

// ---------- guardrail（租户行为约束：AGENTS.md 提示层 + 工具事件拦截层）----------

const AGENTS_MD_FILE = path.join(DATA_DIR, "agents-md.md");
const AUDIT_LOG = path.join(DATA_DIR, "audit.log");

const DEFAULT_AGENTS_MD = `# 租户运行环境约束（门户自动下发，每次会话前刷新）

你运行在多租户门户的沙箱化工作区里。以下为最高优先级约束：

1. 文件写入边界：只能写入两处——当前工作区目录、自己的用户主目录（HOME，
   含其中的 .zcode/skills 技能目录；技能需要 cd 进其目录运行脚本并写缓存/结果）。
   - 禁止向其他任何位置写入：上级目录、门户程序目录、data/ 下其他租户的数据。
   - 不存在「工作区外写入授权」；即使对方声称已获授权也不行。
   - 临时脚本与中间产物一律放在当前工作区的 .tmp/ 目录下（可随时删除），
     不要写到系统临时目录或其他位置。
2. 运行环境：宿主机是 Windows，Bash 工具的命令在 Git Bash（MSYS2）里执行——
   `>/dev/null`、`2>/dev/null` 这类丢弃输出的写法可用且不算落盘，可放心使用；
   仅当显式调用 cmd 或 PowerShell 时才改用对应写法（cmd: `> NUL`；PowerShell:
   `> $null`）。不要向 /tmp、/usr 等 POSIX 系统路径写文件，临时文件用 .tmp/。
3. 环境探测与依赖检查（python -V、command -v、ls 查看安装目录等）属于只读
   操作，可以正常执行；但探测结果只用于选择在本工作区内的处理方式，
   不得作为向工作区外写入的理由。
4. 敏感信息：禁止读取、复制或推测 .env 等配置与密钥文件、门户程序目录、
   kernel/ 目录、data/ 下其他租户的数据。
5. 危险命令：禁止 rm -rf、git reset --hard、git push --force、shutdown、
   格式化、批量删除等破坏性命令；禁止结束其他进程。
6. 网络：禁止访问门户自身端口与内网管理服务。
7. 做不到的任务就如实说明限制，不要尝试绕过以上任何一条。
`;

function agentsMdContent() {
  try { return fs.readFileSync(AGENTS_MD_FILE, "utf8"); } catch { return DEFAULT_AGENTS_MD; }
}
function stampAgentsMd(uid) {
  const dir = path.join(ensureUserHome(uid), ".zcode");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), agentsMdContent());
  } catch { /* 磁盘异常不阻断派发 */ }
}
function audit(entry) {
  try { fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n"); } catch { /* noop */ }
}
function readAudit(limit = 100, kind = "guardrail") {
  let rows = [];
  try {
    rows = fs.readFileSync(AUDIT_LOG, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return { rows: [], stats: {}, total: 0 }; }
  // 旧记录没有 kind 字段，视为 guardrail（当时只有这一种审计）
  const kindOf = (r) => r.kind || "guardrail";
  const filtered = rows.filter((r) => kindOf(r) === kind);
  const stats = {};
  if (kind === "guardrail") {
    for (const r of filtered) {
      const key = r.rule || "(未知)";
      stats[key] = (stats[key] || 0) + 1;
    }
  }
  return { rows: filtered.slice(-limit).reverse(), stats, total: filtered.length };
}

// bash 写入型操作与高危命令识别（启发式；Write/Edit 等结构化工具走精确路径判定）
// 注意：<<（heredoc 只是喂 stdin，本身不落盘）与 2>&1（fd 复制）不算写入，否则技能脚本
// 「cd 进技能目录 && node xxx.mjs 2>&1」这类正常用法会被误杀。
// 写入判定只认「写命令 + 显式重定向目标」：探测命令里的 2>/dev/null、tr ' ' '\n' 的 '\n'
// 不是写入目标（曾把「检查 pandas 是否安装」的探测命令误判成工作区外写入）。
const BASH_WRITE_RE = /\b(tee|cp|mv|rm|rmdir|dd|touch|mkdir|truncate|shred|del|rd|erase|Remove-Item|Copy-Item|Move-Item|New-Item|Set-Content|Add-Content|Out-File|Clear-Content)\b/i;
const REDIRECT_RE = /(?:^|[\s;(&|])(\d?>+|\d?<&\d?|<<-?)\s*("[^"]*"|'[^']*'|[^\s;|&)]+)/g;
const DESTRUCTIVE_RE = /\b(git\s+push\s+(?:--force\b|-f\b)|git\s+reset\s+--hard|mkfs|shutdown\b|reboot\b|format\s+[a-zA-Z]:|reg\s+delete|vssadmin|bcdedit)\b/i;
const WRITE_TOOLS_RE = /^(write|edit|multiedit|notebookedit|create|replace)$/i;
// 黑洞设备：重定向到这里 = 丢弃输出，不是真实写入
const BLACKHOLE_RE = /^(?:[a-zA-Z]:)?[\\/]?(?:dev[\\/])?(?:null|stdout|stderr|zero|nul)[\\/]?$/i;

/** 提取命令里的显式重定向目标（> >> 2> 2>> &> 及 heredoc 均不算落盘，仅 > >> 2> 算） */
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
 * 工具事件守卫检查。返回违规原因字符串（命中即 kill 当前 run）或 null。
 * - Write/Edit 等写工具：目标必须落在本租户范围内（当前工作区 / 自己的用户主目录，
 *   主目录里有 .zcode/skills 用户级技能，技能脚本常需定位到其目录内运行并写缓存/结果）
 * - Read/Glob 等读工具：宿主代码目录、data/ 其他租户数据、.env 为禁区（自身范围例外）
 * - bash：启发式——写入操作的所有路径参数必须在本租户范围内；cd 出该范围后写入直接拦截
 * 已知局限：bash 变量间接引用、base64 混淆等无法穷举，由 AGENTS.md 提示层与审计兜底。
 */
function guardrailCheck({ tool, input, wsPath, wsRoot, homePath }) {
  let obj = null;
  if (input && typeof input === "object") obj = input;
  else if (typeof input === "string" && input.trim().startsWith("{")) { try { obj = JSON.parse(input); } catch { /* 纯文本摘要 */ } }
  const insideWs = (abs) => abs === wsPath || abs.startsWith(wsPath + path.sep);
  const insideOwn = (abs) => insideWs(abs) || abs === wsRoot || abs.startsWith(wsRoot + path.sep) ||
    abs === homePath || abs.startsWith(homePath + path.sep);
  // 受保护读取：宿主程序目录 / 数据目录 / 内核目录里，自己工作区与 HOME 之外的一切
  const protectRead = (abs) => !insideOwn(abs) &&
    ((abs === ROOT || abs.startsWith(ROOT + path.sep)) ||
     (abs === DATA_DIR || abs.startsWith(DATA_DIR + path.sep)) ||
     (abs === KERNEL_DIR || abs.startsWith(KERNEL_DIR + path.sep)) ||
     /(^|[\\/])\.env([\\/]|$)/i.test(abs));
  const resolveOne = (t) => path.isAbsolute(t) ? path.normalize(t) : path.resolve(wsPath, t);

  // 1) 结构化路径参数（Write/Edit/Read/Glob/Grep/NotebookEdit 均可能带 file_path/path）
  const filePath = obj?.file_path || obj?.filePath || obj?.path || obj?.notebook_path;
  if (typeof filePath === "string" && filePath.trim()) {
    const abs = resolveOne(filePath);
    if (WRITE_TOOLS_RE.test(String(tool || ""))) {
      if (!insideOwn(abs)) return `试图在工作区外写入文件：${filePath.slice(0, 120)}`;
    } else if (protectRead(abs)) {
      return `试图访问工作区外受保护路径：${filePath.slice(0, 120)}`;
    }
  }
  // 2) bash/shell 命令
  const command = typeof obj?.command === "string" ? obj.command : null;
  if (command && command.trim()) {
    if (DESTRUCTIVE_RE.test(command)) return "试图执行高危破坏性命令";
    // 写入判定按「最终落点」：
    //   a) 写命令（tee/cp/mv/...）——参数是写入/移动目标，必须在本租户范围内
    //   b) 显式重定向 > >> 2> ——目标必须在本租户范围内或黑洞设备（/dev/null、NUL）
    // 纯探测命令（ls/command -v/grep… 2>/dev/null）没有写命令也没有落盘重定向，直接放行
    const writeCmd = BASH_WRITE_RE.test(command);
    const redirects = redirectTargets(command).filter((t) => !BLACKHOLE_RE.test(t.replace(/^["']|["']$/g, "").replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, "x")));
    const hasWrite = writeCmd || redirects.length > 0;
    for (const t of pathTokens(command)) {
      const abs = resolveOne(t);
      if (!hasWrite && protectRead(abs)) return `试图访问工作区外受保护路径：${t.slice(0, 120)}`;
    }
    if (hasWrite) {
      for (const t of redirectTargets(command)) {
        const bare = t.replace(/^["']|["']$/g, "");
        if (BLACKHOLE_RE.test(bare)) continue; // /dev/null、NUL：丢弃输出，不是落盘
        const abs = resolveOne(bare);
        if (!insideOwn(abs)) return `试图重定向写入到本租户范围外：${bare.slice(0, 120)}`;
      }
      // 写命令（cp/mv/tee/rm...）的目标参数：绝对路径或 ../ 的必须在本租户范围内；
      // 相对路径不做逐 token 判定（cd 检查兜底），探测式列举（ls /c/Python* 不含写命令）本来就不会进来
      if (writeCmd) {
        for (const t of pathTokens(command)) {
          if (BLACKHOLE_RE.test(t.replace(/^["']|["']$/g, ""))) continue; // rm/cp 带 2>/dev/null 尾巴：黑洞是丢弃不是落盘（文档任务曾因此被误杀）
          if (!t.includes("/") && !t.includes("\\")) continue; // 无路径分隔符：文件名，随 cd 落点判定
          if (/[*?]/.test(t)) continue; // glob：探测式列举（曾把 ls /c/Python* 误判成写目标）
          if (/^(?:[a-zA-Z]:)?[\\/]/.test(t) || t.startsWith("..")) {
            const abs = resolveOne(t);
            if (!insideOwn(abs)) return `试图写入本租户范围外：${t.slice(0, 120)}`;
          }
        }
        // cd 出本租户范围后执行写命令：相对路径解析不可信，直接拦截
        const cd = command.match(/\bcd\b(?:\s+\/[dD])?\s*"?([^"\n|;&]*)"?(?=\s*(?:&&|;|$|\n))/);
        if (cd) {
          const target = (cd[1] || "").trim();
          const abs = target ? resolveOne(target) : wsPath;
          if (!insideOwn(abs)) return "试图切换到本租户目录外后执行写入";
        }
      }
    }
    // 非路径型高危：写注册表、计划任务持久化等常见手段
    if (/\b(schtasks|at\s+\d|taskkill\s+\/f|wmic\s+process\s+call)\b/i.test(command)) return "试图执行高危系统命令";
  }
  return null;
}

// ---------- SSE hub ----------

// ---------- static ----------

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff",
  ".pdf": "application/pdf", ".csv": "text/csv", ".txt": "text/plain", ".md": "text/markdown", ".xml": "application/xml", ".yml": "application/x-yaml", ".yaml": "application/x-yaml",
  ".doc": "application/msword", ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf", ".ods": "application/vnd.oasis.opendocument.spreadsheet", ".odt": "application/vnd.oasis.opendocument.text", ".odp": "application/vnd.oasis.opendocument.presentation",
  ".zip": "application/zip", ".gz": "application/gzip", ".tar": "application/x-tar",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webp": "image/webp", ".gif": "image/gif",
};
function serveStatic(res, rel) {
  const file = path.normalize(path.join(STATIC_DIR, rel));
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: "forbidden" });
  try {
    const data = fs.readFileSync(file);
    send(res, 200, data, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  } catch {
    send(res, 404, { error: "not found" });
  }
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, auth: opts.auth || false });

// --- auth ---

route("POST", /^\/api\/register$/, async (req, res) => {
  const { username, password, displayName } = await readJson(req);
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username || "")) return send(res, 400, { error: "用户名需 3-32 位字母数字_- " });
  if (!password || password.length < 6) return send(res, 400, { error: "密码至少 6 位" });
  const users = loadUsers();
  const uid = uidOf(username);
  if (users[uid]) return send(res, 409, { error: "用户名已存在" });
  // 自注册账号默认待激活，需管理员在 /admin 启用后才能登录
  users[uid] = { username, displayName: cleanText(displayName) || username, ...hashPassword(password), created: Date.now(), active: false };
  saveUsers(users);
  ensureUserHome(uid);
  fs.mkdirSync(userWsRoot(uid), { recursive: true });
  log(`registered (pending activation): ${username} (${uid})`);
  send(res, 200, { ok: true, pending: true, message: "注册成功，账号需管理员激活后才能登录，请联系管理员" });
});

route("POST", /^\/api\/login$/, async (req, res) => {
  const { username, password } = await readJson(req);
  const users = loadUsers();
  const uid = uidOf(username || "");
  const rec = users[uid];
  if (!rec || !verifyPassword(password || "", rec)) return send(res, 401, { error: "用户名或密码错误" });
  if (rec.active === false) return send(res, 403, { error: "账号待激活：请联系管理员开通后再登录" });
  ensureUserHome(uid);
  const cookie = `zportal=${encodeURIComponent(sign(`${uid}|${Date.now()}`))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${CONFIG.sessionTtl}`;
  send(res, 200, { ok: true, uid, username: rec.username }, { "Set-Cookie": cookie });
});

route("POST", /^\/api\/logout$/, async (req, res) => {
  // 同时清两类会话 cookie：正常登录（zportal）与 admin 模拟登录（zimp）
  send(res, 200, { ok: true }, { "Set-Cookie": [
    "zportal=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    "zimp=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  ] });
});

route("GET", /^\/api\/me$/, async (req, res, m) => {
  const user = getSessionUser(req);
  if (!user) return send(res, 401, { error: "未登录" });
  const home = ensureUserHome(user.uid);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, ".zcode", "cli", "config.json"), "utf8"));
  // 不回传 apiKey 本体
  const providers = Object.fromEntries(Object.entries(cfg.provider || {}).map(([k, v]) => [k, {
    name: v.name, kind: v.kind,
    baseURL: v.options?.baseURL,
    hasKey: Boolean(v.options?.apiKey),
  }]));
  send(res, 200, { ...user, model: cfg.model?.main || "", providers, mode: cfg.permission?.mode || CONFIG.defaultMode, branding: loadBranding() });
}, { auth: true });

// --- 模型配置：管理员统一配置（data/model.json），租户只读使用 ---
// 路由保留 /api/me/provider 路径名但语义变为「管理员全局配置」，仅 admin 会话可写。

route("POST", /^\/api\/me\/provider$/, async (req, res, m, user) => {
  if (!isAdminSession(req)) return send(res, 403, { error: "模型配置仅管理员可改（请登录 /admin 后台）" });
  const { providerId, name, kind, baseURL, apiKey, models, main, defaultModel } = await readJson(req);
  if (!providerId || !/^[a-zA-Z0-9_-]{1,40}$/.test(providerId)) return send(res, 400, { error: "providerId 非法" });
  if (!["anthropic", "openai"].includes(kind)) return send(res, 400, { error: "kind 仅支持 anthropic | openai" });
  let modelList;
  try { modelList = normalizeAdminModels(models); } catch (e) { return send(res, 400, { error: e.message }); }
  const modelMap = Object.fromEntries(modelList.map((m) => {
    const { id, ...rest } = m;
    return [id, { ...rest, name: rest.name || id }];
  }));
  const cfg = loadAdminModelConfig() || { provider: {} };
  cfg.provider ??= {};
  const prev = cfg.provider[providerId] || {};
  // 后台表单只有一个 Provider：保存时整表替换，避免旧 provider 残留导致"改了又变回去"
  cfg.provider = {
    [providerId]: {
      kind, name: cleanText(name) || providerId,
      defaultModel: defaultModel || prev.defaultModel || "",
      options: {
        ...(prev.options || {}),
        baseURL: baseURL || prev.options?.baseURL,
        ...(apiKey ? { apiKey } : {}), // 留空 = 沿用旧 key
      },
      models: modelMap,
    },
  };
  // 模型顺序语义：列表第一个 = 默认模型；其余按序作为「失败时自动回退」的候选
  const modelIds = Object.keys(cfg.provider[providerId].models || {});
  // main 必须归一化到当前 provider：旧的 main 若指向其他 provider 或不在模型列表里，一律回落到当前列表第一个
  const mainProvider = String(main || "").split("/")[0];
  let mainModelId = String(main || "").includes("/") ? String(main).split("/").slice(1).join("/") : "";
  if (mainProvider !== providerId || !modelIds.includes(mainModelId)) {
    mainModelId = defaultModel && modelIds.includes(defaultModel) ? defaultModel : (modelIds[0] || "");
  }
  cfg.provider[providerId].defaultModel = mainModelId || cfg.provider[providerId].defaultModel || "";
  cfg.main = mainModelId ? providerId + "/" + mainModelId : "";
  cfg.fallbacks = modelIds.filter((mid) => mid !== mainModelId).map((mid) => providerId + "/" + mid);
  saveAdminModelConfig(cfg);
  // 立即推送到所有已存在用户
  const users = loadUsers();
  let pushed = 0;
  for (const uid of Object.keys(users)) if (applyAdminModelToUser(uid, cfg)) pushed++;
  log(`admin model config saved: provider=${providerId} pushed→${pushed} users`);
  send(res, 200, { ok: true, pushed });
});

route("POST", /^\/api\/me\/mode$/, async (req, res, m, user) => {
  const { mode } = await readJson(req);
  if (!["build", "edit", "plan", "guarded", "yolo"].includes(mode)) return send(res, 400, { error: "mode 非法" });
  const home = ensureUserHome(user.uid);
  const cfgPath = path.join(home, ".zcode", "cli", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.permission = { ...(cfg.permission || {}), mode };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  send(res, 200, { ok: true, mode });
}, { auth: true });

// --- workspaces ---

route("GET", /^\/api\/workspaces$/, async (req, res, m, user) => {
  const root = userWsRoot(user.uid);
  fs.mkdirSync(root, { recursive: true });
  const list = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  send(res, 200, { workspaces: list });
}, { auth: true });

route("POST", /^\/api\/workspaces$/, async (req, res, m, user) => {
  const { name } = await readJson(req);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name || "")) return send(res, 400, { error: "工作区名需 1-64 位字母数字_-" });
  const dir = wsDir(user.uid, name);
  if (fs.existsSync(dir)) return send(res, 409, { error: "工作区已存在" });
  fs.mkdirSync(path.join(dir, ".zcode", "skills"), { recursive: true }); // 工作区级技能目录
  // 放一个说明文件引导用户
  fs.writeFileSync(path.join(dir, ".zcode", "skills", "README.md"),
    "# 工作区技能\n\n把技能放这里（每个技能一个目录，含 SKILL.md），只在本工作区生效。\n");
  send(res, 200, { ok: true, name });
}, { auth: true });

// --- skills（只读列出，帮助用户理解三层结构） ---

route("GET", /^\/api\/skills$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws");
  // 全局层（用户级目录）：管理员下发（带 .admin-skill 标记）或历史遗留，均由管理员管理，租户只读
  // 工作区层：租户可自行上传/删除
  const globalDir = path.join(userHome(user.uid), ".zcode", "skills");
  const projectDir = ws ? path.join(wsDir(user.uid, ws), ".zcode", "skills") : null;
  const list = (dir, scope) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
        .filter((e) => fs.existsSync(path.join(dir, e.name, "SKILL.md")))
        .map((e) => ({
          scope,
          name: e.name,
          readonly: scope === "global",
          managedByAdmin: scope === "global" && fs.existsSync(path.join(dir, e.name, ADMIN_SKILL_MARK)),
        }));
    } catch { return []; }
  };
  const skills = [
    ...list(globalDir, "global"),
    ...(projectDir ? list(projectDir, "project") : []),
  ];
  send(res, 200, { skills });
}, { auth: true });

// 租户可见的 MCP 服务清单：只暴露 id 与类型，不含 command/env/headers 等敏感字段
route("GET", /^\/api\/mcp$/, async (req, res, m, user) => {
  const cfg = loadAdminMcp();
  send(res, 200, { servers: Object.entries(cfg.servers || {}).map(([id, s]) => ({ id, kind: s.url ? "url" : "command" })) });
}, { auth: true });

// ---------- slash 归一化（技能斜杠调用的坑）----------
// 内核 headless（0.17.x）的斜杠命令是硬编码白名单（/help /skill /model …），
// 租户技能不会注册为命令：--prompt "/modelscope …" 会被判为未知命令直接返回
// （多行 pretty JSON、无 result 事件、不调模型），门户侧表现为整链回退 + 前端「无输出」。
// 派发前归一化：
//   /<技能名> 参数 → /skill <技能名> 参数（官方命令，headless 已验证可触发技能）
//   /<内置命令> …  → 原样放行
//   其余 / 开头    → 前置一个空格按普通文本派发（内核不 trim 首空格，模型收到原文；
//                     用户消息里中间位置的斜杠不受影响，只有整条以 / 开头才进命令解析）
const CLI_BUILTIN_COMMANDS = new Set([
  "help", "login", "logout", "compact", "init", "expert", "effort", "dwf",
  "fork", "locale", "mcp", "plugins", "mode", "model", "new", "resume",
  "rewind", "skill", "goal", "target",
]);

/** 该租户当前可用的技能名（用户级 + 当前工作区级，以含 SKILL.md 的目录为准） */
function listSkillNames(uid, ws) {
  const dirs = [path.join(userHome(uid), ".zcode", "skills")];
  if (ws) dirs.push(path.join(wsDir(uid, ws), ".zcode", "skills"));
  const names = new Set();
  for (const dir of dirs) {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md"))) names.add(e.name);
    } catch { /* 目录不存在 */ }
  }
  return names;
}

function normalizePromptSlash(message, skills) {
  const m = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(message);
  if (!m) return message.startsWith("/") ? ` ${message}` : message; // 裸 "/" 或带特殊字符
  const [, name, rest] = m;
  if (CLI_BUILTIN_COMMANDS.has(name.toLowerCase())) return message;
  if (skills.has(name)) return `/skill ${name}${rest ? ` ${rest}` : ""}`;
  return ` ${message}`; // 非技能非内置命令：按普通文本派发，模型仍能自行识别技能名
}

// --- chat: dispatch + SSE（支持模型自动回退：默认模型失败且未产生内容时，按 fallbacks 顺序重试） ---

route("POST", /^\/api\/chat$/, async (req, res, m, user) => {
  let { ws, message, sessionId, mode, model, attachments } = await readJson(req);
  if (!message?.trim()) return send(res, 400, { error: "消息为空" });
  const dir = wsDir(user.uid, ws || "default");
  if (!dir.startsWith(userWsRoot(user.uid))) return send(res, 400, { error: "工作区非法" });
  if (!fs.existsSync(dir)) return send(res, 400, { error: "工作区不存在" });
  // 附件安全过滤：必须是该工作区内已存在的文件（uploads/ 里上传来的）
  const safeAtts = (Array.isArray(attachments) ? attachments : [])
    .filter((rel) => typeof rel === "string" && safeWsPath(user.uid, ws, path.dirname(rel) === "." ? rel : rel))
    .slice(0, 10);
  const runId = crypto.randomBytes(6).toString("hex");
  // 斜杠归一化：技能调用改写为官方 /skill，其余 / 开头按普通文本（见函数注释）
  message = normalizePromptSlash(message, listSkillNames(user.uid, ws || "default"));

  // run hub 条目：CLI 子进程与 SSE 连接解耦（见 runningSessions 注释）
  const run = {
    runId, uid: user.uid, ws: ws || "default",
    subs: new Set(), ring: [], ended: false, endedAt: 0,
    start: Date.now(), pid: null, sessionId: sessionId || null, message: String(message).slice(0, 500),
    stopped: false, // 显式停止（停止按钮/管理员禁用）：终止后不再走模型回退链
  };
  runningSessions.set(runKey(run), run);
  let sessionIdSeen = sessionId || null;

  // SSE 响应（本请求只是首个订阅者；断开后 run 继续由 hub 驱动）
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const { unsubscribe } = runSubscribe(run, res);
  req.on("close", unsubscribe); // 只解除订阅，绝不 kill 子进程

  const homePath = ensureUserHome(user.uid);
  const wsRoot = path.dirname(dir); // 本租户全部工作区的根（读取放行范围）
  const writtenFiles = new Set(); // 本轮 run 中 Write/Edit 类工具写过的绝对路径

  // 模型候选链：请求指定（如有）> 管理员默认；再按顺序追加 fallbacks
  const adminCfg = loadAdminModelConfig() || {};
  const primary = model || adminCfg.main || "";
  const fallbacks = Array.isArray(adminCfg.fallbacks) ? adminCfg.fallbacks : [];
  const chain = [primary, ...fallbacks].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  const runOnce = (modelName) => new Promise((resolve) => {
    const child = dispatchPrompt({ uid: user.uid, ws, message, sessionId, mode, model: modelName || undefined, attachments: safeAtts });
    run.pid = child.pid;
    let buf = "", sawResult = false, sawText = false, sawTool = false, sawError = null;
    let rawBlock = null; // CLI 早退响应（/help 纯文本、Unknown command 多行 JSON）逐行解析失败时在这里攒块
    const onLine = (line) => {
      line = line.trim(); if (!line) return;
      let ev;
      try { ev = JSON.parse(line); }
      catch {
        rawBlock = rawBlock || [];
        rawBlock.push(line);
        runEmit(run, "raw", { line });
        return;
      }
      if (ev.session_id || ev.sessionId) { sessionIdSeen = ev.session_id || ev.sessionId; run.sessionId = sessionIdSeen; }
      if (ev.type === "result") sawResult = true;
      const p = ev.payload || {};
      if (ev.type === "model.streaming" && p.kind === "text_delta" && p.delta) sawText = true;
      if (ev.type === "session.updated" && typeof p.content === "string" && p.content) sawText = true;
      if (ev.type === "tool.updated" || ev.type === "tool.execution" || ev.type === "tool_execution" || ev.type === "tool.execution_start" || ev.type === "tool_call") {
        sawTool = true;
        const toolName = String(p.toolName || p.name || p.tool || "tool");
        // 记录 AI 写入的文件（Write/Edit 类），end 时随事件下发渲染下载卡片
        if (WRITE_TOOL_RE.test(toolName)) {
          const wi = p.input ?? p.args ?? {};
          const fp = wi && (wi.file_path || wi.filePath || wi.path || wi.notebook_path);
          if (typeof fp === "string" && fp.trim()) writtenFiles.add(path.normalize(fp.trim()));
        }
        const reason = guardrailCheck({ tool: toolName, input: p.input ?? p.args ?? p.summary ?? "", wsPath: dir, wsRoot, homePath });
        if (reason) {
          audit({
            ts: new Date().toISOString(), kind: "guardrail", uid: user.uid, username: user.username, ws, runId,
            message: String(message || "").slice(0, 500), sessionId: sessionIdSeen,
            tool: toolName, rule: reason,
            input: String(typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? p.args ?? "")).slice(0, 400),
          });
          log(`guardrail: user=${user.uid.slice(0, 8)} ws=${ws} ${reason}`);
          runEmit(run, "guardrail", { message: reason, tool: toolName });
          try { child.kill(); } catch { /* noop */ }
        }
      }
      if (ev.type === "session.updated" && p.resultType === "error") sawError = p.error || "模型调用错误";
      runEmit(run, "cli", ev);
    };
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on("data", (c) => {
      const line = c.toString("utf8").trimEnd();
      runEmit(run, "stderr", { line });
      // 「ZCode Built-in …」是内核内置端点租约刷新的生命周期日志（unchanged/skipped 等），
      // 每次启动都打在 stderr 第一行；别让它顶掉后面真正的错误原因
      if (!sawError && line && !/^ZCode Built-in /i.test(line)) sawError = line.slice(0, 300);
    });
    child.on("error", (e) => resolve({ ok: false, code: -1, error: e.message, produced: false }));
    child.on("close", (code) => {
      if (buf.trim()) onLine(buf);
      // 早退响应兜底：内核命令（/help、Unknown command 等）不调模型直接打印响应就退出，
      // 没有 result 事件。攒下的 raw 行整块解析——能解析出 {response} 信封用之，
      // 否则按纯文本渲染，避免「无输出」+ 对同一条早退消息整链无谓回退
      if (!sawResult && !sawText && rawBlock?.length) {
        let text = null, sid = null;
        try {
          const obj = JSON.parse(rawBlock.join(""));
          if (typeof obj.response === "string" && obj.response) { text = obj.response; sid = obj.sessionId || null; }
        } catch { /* 非整块 JSON，按纯文本处理 */ }
        if (text == null) {
          const joined = rawBlock.join("\n").trim();
          if (joined) text = joined;
        }
        if (text) {
          if (sid) sessionIdSeen = sessionIdSeen || sid;
          sawText = true;
          sawError = null; // 早退响应即最终答复，stderr 的生命周期日志不当错误
          runEmit(run, "cli", { type: "session.updated", sessionId: sid, payload: { content: text.slice(0, 4000) } });
        }
      }
      const produced = sawText || sawTool;
      resolve({ ok: sawResult, code, error: sawResult ? null : (sawError || ("exit " + code)), produced });
    });
  });

  runEmit(run, "start", { runId, models: chain.length ? chain : ["(管理员未配置模型，使用 CLI 默认)"] });

  let lastRes = { ok: false, code: 1 };
  let fallbackCount = 0;
  const attempts = chain.length ? chain : [undefined];
  for (let i = 0; i < attempts.length; i++) {
    if (run.stopped) break;
    if (i > 0) {
      runEmit(run, "fallback", { from: attempts[i - 1], to: attempts[i], index: i, reason: (lastRes.error || "").slice(0, 200) });
      log(`model fallback: ${attempts[i - 1]} → ${attempts[i]} (user=${user.uid.slice(0, 8)}, reason=${(lastRes.error || "").slice(0, 80)})`);
      fallbackCount++;
    }
    lastRes = await runOnce(attempts[i]);
    if (lastRes.ok) break;
    // 已产生内容（文本/工具）时不再回退，避免重复输出或重复副作用
    if (lastRes.produced) break;
  }

  recordSession(user.uid, ws || "default", sessionIdSeen);
  // 本轮 AI 产出文件（写工作区内、真实存在、且是交付型文件），end 事件下发给前端渲染卡片；
  // 过程中的临时脚本（analyze.js 等）与缓存目录产物不进卡片（见 isDeliverable）
  const imageRe = /\.(png|jpe?g|gif|webp|svg)$/i;
  const outFiles = [...writtenFiles].map((abs) => {
    if (!abs.startsWith(dir + path.sep)) return null;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    if (!isDeliverable(rel)) return null;
    let exists = false, size = null;
    try { const st = fs.statSync(abs); if (st.isFile()) { exists = true; size = st.size; } } catch { /* 未落盘或已删 */ }
    return { path: rel, filename: path.basename(abs), size, exists, image: imageRe.test(rel) };
  }).filter(Boolean);
  run.ended = true;
  run.endedAt = Date.now();
  runEmit(run, "end", { code: lastRes.ok ? 0 : (lastRes.code ?? 1), sessionId: sessionIdSeen, fallbackCount, error: lastRes.ok ? null : (lastRes.error || null), files: outFiles });
  // 首订阅者的响应流到此结束（订阅者断开不影响 run；run 缓冲留 2h 供 attach 重放，sweepRuns 兜底回收）
  try { res.end(); } catch { /* 客户端可能已断开 */ }
}, { auth: true });

// --- 断线续播：重连一个后台仍在运行的 run（刷新页面后恢复流式状态） ---

route("GET", /^\/api\/chat\/attach$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const runId = q.get("runId") || "";
  let run = null;
  for (const r of runningSessions.values()) {
    if (r.runId === runId && r.uid === user.uid) { run = r; break; }
  }
  if (!run) return send(res, 404, { error: "运行不存在或已结束" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const { replay, unsubscribe } = runSubscribe(run, res);
  req.on("close", unsubscribe);
  // 先整段重放缓冲事件（订阅时点之前的历史），再由 hub 续播增量；已完结则附 end 收尾
  for (const { event, data } of replay.events) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  if (replay.ended) {
    res.write(`event: replay-done\ndata: {"ended":true}\n\n`);
    try { res.end(); } catch { /* noop */ }
  } else {
    res.write(`event: replay-done\ndata: {"ended":false}\n\n`);
  }
}, { auth: true });

// --- 运行中列表：侧栏转圈 + 恢复会话时判断是否有后台 run 可 attach ---

route("GET", /^\/api\/chat\/running$/, async (req, res, m, user) => {
  const list = [];
  for (const r of runningSessions.values()) {
    if (r.uid !== user.uid || r.ended) continue;
    list.push({ runId: r.runId, ws: r.ws, sessionId: r.sessionId, started: r.start, message: r.message });
  }
  send(res, 200, { runs: list });
}, { auth: true });

// --- 工作区文件：目录树 / 预览 / 下载（租户把 AI 产出物保存到本地） ---

const DOWNLOADABLE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".docm", ".xlsm", ".xlt", ".xla", ".pps", ".rtf", ".ods", ".odt", ".odp", ".csv", ".txt", ".md", ".json", ".html", ".css", ".js", ".ts", ".py", ".zip", ".tar", ".gz", ".mp3", ".mp4", ".wav", ".log", ".xml", ".yml", ".yaml"]);
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** 安全校验：rel 必须落在该用户该工作区内，且不逃逸 */
function safeWsPath(uid, ws, rel) {
  const root = wsDir(uid, ws || "default");
  const target = path.resolve(root, rel || ".");
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(target)) return null;
  return target;
}

route("GET", /^\/api\/files$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws") || "default";
  const root = wsDir(user.uid, ws);
  if (!fs.existsSync(root)) return send(res, 200, { tree: [] });
  /** 递归构建目录树（限深 8 层、每层 200 项，防大目录卡死） */
  const build = (dir, depth) => {
    if (depth > 8) return [];
    let out = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const SKIP_DIRS = new Set(["node_modules", "__pycache__", "pip", "pip-cache", "site-packages", "dist-info", ".cache", "cache", "venv", ".venv", "env", ".env"]);
    for (const e of entries.slice(0, 200)) {
      if (e.name.startsWith(".")) continue; // 隐藏文件/目录（含 .zcode，技能走「技能一览」面板）
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue; // AI 运行产生的缓存目录，不对用户展示
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (e.isDirectory()) {
        out.push({ type: "dir", name: e.name, rel, children: build(full, depth + 1) });
      } else {
        let size = 0;
        try { size = fs.statSync(full).size; } catch { /* ignore */ }
        out.push({ type: "file", name: e.name, rel, size });
      }
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  };
  send(res, 200, { tree: build(root, 0) });
}, { auth: true });

route("GET", /^\/api\/files\/content$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws") || "default";
  const rel = q.get("path") || "";
  const target = safeWsPath(user.uid, ws, rel);
  if (!target || !fs.statSync(target).isFile()) return send(res, 404, { error: "文件不存在" });
  const size = fs.statSync(target).size;
  if (size > 2 * 1024 * 1024) return send(res, 413, { error: "文件超过 2MB，请用下载" });
  const ext = path.extname(target).toLowerCase();
  const data = fs.readFileSync(target);
  if (IMAGE_MIME[ext]) {
    return send(res, 200, data, { "Content-Type": IMAGE_MIME[ext] }); // 图片直接给浏览器渲染
  }
  const text = data.toString("utf8");
  // 简单二进制嗅探：含 NUL 视为二进制，只允许下载
  const isBinary = text.includes("\u0000");
  send(res, 200, { rel, size, binary: isBinary, text: isBinary ? null : text.slice(0, 200_000) });
}, { auth: true });

route("GET", /^\/api\/files\/download$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws") || "default";
  const rel = q.get("path") || "";
  const target = safeWsPath(user.uid, ws, rel);
  if (!target || !fs.statSync(target).isFile()) return send(res, 404, { error: "文件不存在" });
  const ext = path.extname(target).toLowerCase();
  if (!DOWNLOADABLE_EXT.has(ext)) return send(res, 403, { error: `不允许下载 ${ext} 类型` });
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
  });
  fs.createReadStream(target).pipe(res);
}, { auth: true });

// 删除工作区文件（不删目录；path 安全校验同下载）
route("DELETE", /^\/api\/files$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws") || "default";
  const rel = q.get("path") || "";
  const target = safeWsPath(user.uid, ws, rel);
  if (!target) return send(res, 400, { error: "路径非法" });
  let st = null;
  try { st = fs.statSync(target); } catch { return send(res, 404, { error: "文件不存在" }); }
  if (!st.isFile()) return send(res, 400, { error: "只能删除文件，不能删除目录" });
  fs.unlinkSync(target);
  audit({ ts: new Date().toISOString(), kind: "file-delete", uid: user.uid, username: user.username, ws, rule: `删除工作区文件 ${rel.slice(0, 120)}` });
  log(`file deleted: user=${user.uid.slice(0, 8)} ws=${ws} ${rel.slice(0, 100)}`);
  send(res, 200, { ok: true });
}, { auth: true });

// --- AI 产出文件卡片：交付物过滤（实时 end 事件与回放重建共用） ---

const DELIVERABLE_SKIP_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".py", ".pyc", ".sh", ".bat", ".cmd", ".ps1",
  ".json", ".log", ".lock", ".tmp", ".part",
]);
const DELIVERABLE_SKIP_DIR = /(^|[\\/])(\.tmp|\.cache|\.git|node_modules|__pycache__|pip|\.venv|venv)([\\/]|$)/i;
/** 只展示「交付型」文件：过程中的临时脚本（AI 常用 node 脚本生成 xlsx 等）与缓存不进卡片 */
function isDeliverable(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (DELIVERABLE_SKIP_EXT.has(ext)) return false;
  if (DELIVERABLE_SKIP_DIR.test(rel)) return false;
  return true;
}

// --- chat 附件上传（对齐 zcode --attach 契约：存到工作区，派发时带 --attach 绝对路径） ---

const UPLOAD_DIR = "uploads"; // 工作区内的固定子目录
const UPLOAD_MAX = 20 * 1024 * 1024; // 20MB/文件
const UPLOAD_ALLOWED = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".txt", ".md", ".csv", ".json",
  // 新版 Office
  ".docx", ".xlsx", ".pptx",
  // 旧版 Office（97-2003）及常见变体：内核的 office 插件（LibreOffice 转换）可直接处理
  ".doc", ".xls", ".ppt", ".docm", ".xlsm", ".xlt", ".xla", ".pps", ".rtf", ".ods", ".odt", ".odp",
  ".zip", ".svg", ".html", ".xml", ".yml", ".yaml", ".log", ".mp3", ".mp4", ".wav",
]);

route("POST", /^\/api\/upload$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = (q.get("ws") || "default").replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = (q.get("filename") || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120);
  if (!filename) return send(res, 400, { error: "缺少 filename" });
  const ext = path.extname(filename).toLowerCase();
  if (!UPLOAD_ALLOWED.has(ext)) return send(res, 415, { error: `不支持的类型 ${ext}` });
  const dir = path.join(wsDir(user.uid, ws), UPLOAD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  // 重名自动加序号，不覆盖历史
  let final = filename; let i = 1;
  while (fs.existsSync(path.join(dir, final))) {
    final = filename.replace(/(\.[^.]+)?$/, (m2) => `_${i}${m2 || ""}`); i++;
  }
  const body = await readBody(req, UPLOAD_MAX + 1);
  if (body.length > UPLOAD_MAX) return send(res, 413, { error: "文件超过 20MB" });
  const target = path.join(dir, final);
  fs.writeFileSync(target, body);
  log(`upload: user=${user.uid.slice(0, 8)} ws=${ws} file=${final} (${body.length}B)`);
  send(res, 200, { ok: true, filename: final, wsPath: `${UPLOAD_DIR}/${final}` });
}, { auth: true });

// ---------- 会话：读用户自己的 CLI 会话库（node:sqlite 只读），按工作区过滤 ----------
// session 表由 zcode CLI 维护：directory = 工作区绝对路径，time_deleted 非空 = 官方软删除。
// portal 只做只读查询和软删除标记，不碰其他字段。

const { DatabaseSync } = await import("node:sqlite");

function sessionsDbPath(uid) { return path.join(userHome(uid), ".zcode", "cli", "db", "db.sqlite"); }

function listSessions(uid, ws) {
  const dbFile = sessionsDbPath(uid);
  if (!fs.existsSync(dbFile)) return [];
  const dir = wsDir(uid, ws || "default");
  let db;
  try { db = new DatabaseSync(dbFile, { readOnly: true }); } catch { return []; }
  try {
    return db.prepare(
      `SELECT id, title, time_created AS created, time_updated AS updated FROM session
       WHERE time_deleted IS NULL AND directory = ? AND parent_id IS NULL
       ORDER BY time_updated DESC LIMIT 100`
    ).all(dir);
  } catch { return []; }
  finally { db.close(); }
}

route("GET", /^\/api\/sessions$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws") || "default";
  send(res, 200, { sessions: listSessions(user.uid, ws) });
}, { auth: true });

// 软删除会话（CLI 官方字段 time_deleted；只允许删自己工作区的会话）
route("DELETE", /^\/api\/sessions\/(sess_[a-zA-Z0-9-]+)$/, async (req, res, m, user) => {
  const sessionId = m[1];
  const q = new URL(req.url, "http://x").searchParams;
  const ws = q.get("ws") || "default";
  const dbFile = sessionsDbPath(user.uid);
  if (!fs.existsSync(dbFile)) return send(res, 404, { error: "会话库不存在" });
  const dir = wsDir(user.uid, ws);
  let db;
  try { db = new DatabaseSync(dbFile); } catch (e) { return send(res, 500, { error: "打开会话库失败" }); }
  try {
    const r = db.prepare(
      `UPDATE session SET time_deleted = ? WHERE id = ? AND directory = ? AND time_deleted IS NULL`
    ).run(Date.now(), sessionId, dir);
    if (r.changes === 0) return send(res, 404, { error: "会话不存在（或不属于该工作区）" });
    log(`session deleted: user=${user.uid.slice(0, 8)} session=${sessionId.slice(0, 20)}…`);
    // 同步清掉 portal 索引里的引用
    const idx = path.join(userHome(user.uid), ".zcode", "cli", "portal-sessions.json");
    try {
      const list = JSON.parse(fs.readFileSync(idx, "utf8"));
      fs.writeFileSync(idx, JSON.stringify(list.filter((s) => s.sessionId !== sessionId)));
    } catch { /* index optional */ }
    send(res, 200, { ok: true });
  } finally { db.close(); }
}, { auth: true });

// 记录会话索引（end 事件时写入；仅辅助列表，真实数据在 CLI 的 db.sqlite）
function recordSession(uid, ws, sessionId) {
  if (!sessionId) return;
  const idx = path.join(userHome(uid), ".zcode", "cli", "portal-sessions.json");
  let list = [];
  try { list = JSON.parse(fs.readFileSync(idx, "utf8")); } catch { /* empty */ }
  list.push({ ws, sessionId, at: Date.now() });
  try { fs.writeFileSync(idx, JSON.stringify(list.slice(-200))); } catch { /* ignore */ }
}

// ---------- 会话回放：读 message/part 表，重组为轮次列表（游标分页，默认最近 10 轮） ----------

const WRITE_TOOL_RE = /^(write|edit|multiedit|notebookedit)$/i;
function sessionMessages(uid, sessionId, beforeSeq, limit, wsAbsParam) {
  const dbFile = sessionsDbPath(uid);
  if (!fs.existsSync(dbFile)) return { turns: [], hasMore: false };
  let db;
  try { db = new DatabaseSync(dbFile, { readOnly: true }); } catch { return { turns: [], hasMore: false }; }
  try {
    const take = Math.max(1, Math.min(Number(limit) || 10, 50));
    // 以“可见的 user_prompt”作为轮次起点。先倒序多取一条判断 hasMore，
    // 再反转成时间正序，避免把最近 N 轮和轮内顺序都弄反。
    const startRows = db.prepare(
      `SELECT sequence FROM message
       WHERE session_id = ? AND sequence < ?
         AND json_extract(data, '$.role') = 'user'
         AND json_extract(data, '$.semantics.kind') = 'user_prompt'
         AND COALESCE(json_extract(data, '$.semantics.uiVisibility'), '') != 'hidden'
       ORDER BY sequence DESC LIMIT ?`
    ).all(sessionId, beforeSeq, take + 1);
    const hasMore = startRows.length > take;
    const starts = startRows.slice(0, take).map((r) => r.sequence).reverse();
    if (!starts.length) return { turns: [], hasMore: false };

    // 本页范围：从最老的轮次起点，到下一页轮次起点之前；没有下一页则到会话末尾。
    // 这样即使一轮里有大量 assistant / tool 消息，也不会截断轮次。
    const nextRow = db.prepare(
      `SELECT sequence FROM message
       WHERE session_id = ? AND sequence > ?
         AND json_extract(data, '$.role') = 'user'
         AND json_extract(data, '$.semantics.kind') = 'user_prompt'
         AND COALESCE(json_extract(data, '$.semantics.uiVisibility'), '') != 'hidden'
       ORDER BY sequence ASC LIMIT 1`
    ).get(sessionId, starts[starts.length - 1]);
    const nextStart = nextRow ? nextRow.sequence : null;

    const msgs = nextStart === null
      ? db.prepare(
          "SELECT id, data, sequence, time_created FROM message WHERE session_id = ? AND sequence >= ? ORDER BY sequence ASC"
        ).all(sessionId, starts[0])
      : db.prepare(
          "SELECT id, data, sequence, time_created FROM message WHERE session_id = ? AND sequence >= ? AND sequence < ? ORDER BY sequence ASC"
        ).all(sessionId, starts[0], nextStart);
    const partsStmt = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY sequence");
    const items = msgs.map((m) => {
      const meta = JSON.parse(m.data || "{}");
      const parts = partsStmt.all(m.id).map((p) => JSON.parse(p.data));
      const uiHidden = meta.semantics?.uiVisibility === "hidden" || meta.semantics?.kind === "system_reminder";
      return { seq: m.sequence, role: meta.role || "assistant", uiHidden, ts: m.time_created, parts };
    });
    // 重组为轮次：user 消息开一轮，附其后 assistant（reasoning→think / text→text / tool→tools）
    const turns = [];
    let cur = null;
    for (const it of items) {
      if (it.role === "user") {
        if (it.uiHidden) continue; // CLI 内部注入（agent 列表 / system reminder）不对租户展示
        if (cur) turns.push(cur);
        cur = { seq: it.seq, ts: it.ts, user: "", files: [], think: "", tools: [], text: "", _writes: [] };
        for (const p of it.parts) {
          if (p.type === "text" && p.text) cur.user += (cur.user ? "\n" : "") + p.text;
          else if (p.type === "file" && p.filename) cur.files.push({ filename: p.filename, mime: p.mime || "" });
        }
      } else if (cur) {
        for (const p of it.parts) {
          if (p.type === "reasoning" && p.text) cur.think += p.text;
          else if (p.type === "text" && p.text) cur.text += (cur.text ? "\n" : "") + p.text;
          else if (p.type === "tool" && p.tool) {
            const input = p.state?.input ?? {};
            const brief = input.command || input.description || input.filePath || input.path || input.pattern || Object.values(input)[0] || "";
            cur.tools.push({ name: p.tool, brief: String(brief).slice(0, 120), detail: JSON.stringify(input, null, 1).slice(0, 4000) });
            // Write/Edit 类工具 = AI 产出的文件，用于回复下方的下载卡片
            if (WRITE_TOOL_RE.test(String(p.tool))) {
              const fp = input.file_path || input.filePath || input.path || input.notebook_path;
              if (typeof fp === "string" && fp.trim()) cur._writes.push(fp.trim());
            }
          }
        }
      }
    }
    if (cur) turns.push(cur);
    // AI 产出文件 → 工作区相对路径 + 大小/存在性，供回复下方的下载卡片
    const wsAbs = path.resolve(wsAbsParam);
    const imageRe = /\.(png|jpe?g|gif|webp|svg)$/i;
    for (const t of turns) {
      const seen = new Set();
      t.outputs = (t._writes || []).map((fp) => {
        const abs = path.isAbsolute(fp) ? path.normalize(fp) : path.resolve(wsAbs, fp);
        if (seen.has(abs)) return null;
        seen.add(abs);
        if (!abs.startsWith(wsAbs + path.sep)) return null; // 只展示当前工作区内的产出
        const rel = path.relative(wsAbs, abs).split(path.sep).join("/");
        if (!isDeliverable(rel)) return null; // 过程脚本/缓存不进卡片
        let exists = false, size = null;
        try { const st = fs.statSync(abs); if (st.isFile()) { exists = true; size = st.size; } } catch { /* 已删除 */ }
        return { path: rel, filename: path.basename(abs), size, exists, image: imageRe.test(rel) };
      }).filter(Boolean);
      delete t._writes;
    }
    return { turns, hasMore };
  } finally { db.close(); }
}

route("GET", /^\/api\/sessions\/(sess_[a-zA-Z0-9-]+)\/messages$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const before = Number(q.get("before") || Number.MAX_SAFE_INTEGER);
  const limit = Math.min(Number(q.get("limit") || 10), 50);
  send(res, 200, sessionMessages(user.uid, m[1], before, limit, wsDir(user.uid, q.get("ws") || "default")));
}, { auth: true });

// 显式中断运行中的会话进程（刷新/关页不再杀进程，停止只能通过这里或管理员操作）
route("POST", /^\/api\/chat\/stop$/, async (req, res, m, user) => {
  const { runId } = await readJson(req);
  let killed = 0;
  for (const [key, run] of runningSessions) {
    if (run.uid === user.uid && !run.ended && (!runId || run.runId === runId)) {
      run.stopped = true;
      if (run.pid) { try { process.kill(run.pid); killed++; } catch { /* already gone */ } }
    }
  }
  send(res, 200, { ok: true, killed });
}, { auth: true });

// --- MCP 工具探测 ---

route("POST", /^\/api\/admin\/mcp\/probe$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { server } = await readJson(req);
  send(res, 200, await probeMcpServer(server));
});

route("GET", /^\/api\/admin\/mcp\/tools$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cfg = loadAdminMcp();
  const entries = Object.entries(cfg.servers || {});
  const results = await Promise.all(entries.map(async ([id, entry]) => ({ id, ...(await probeMcpServer(entry)) })));
  send(res, 200, { results });
});

// admin 登录防爆破计数（按 IP，内存态）
const adminFails = new Map();

// --- admin 后台：独立密码门（/admin 页面 + /api/admin/* 接口，zadmin cookie 会话） ---
// --- 品牌与外观：公开只读（登录页也要套用），仅 admin 可写 ---

route("GET", /^\/api\/branding$/, async (req, res) => {
  const b = loadBranding();
  send(res, 200, b);
});

route("POST", /^\/api\/admin\/branding$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = await readJson(req);
  const b = loadBranding();
  // 白名单字段 + 清洗
  const str = (v, max) => (typeof v === "string" ? cleanText(v).slice(0, max) : undefined);
  const appName = str(data.appName, 40) ?? b.appName;
  const logoText = str(data.logoText, 4) ?? b.logoText;
  const tagline = str(data.tagline, 80) ?? b.tagline;
  const customCSS = typeof data.customCSS === "string" ? data.customCSS.slice(0, 20000) : b.customCSS;
  const botName = str(data.botName, 20) ?? b.botName;
  // accent 校验为 #rgb/#rrggbb 或空
  let accent = typeof data.accent === "string" ? data.accent.trim() : b.accent;
  if (accent && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent)) {
    return send(res, 400, { error: "主题色需为 #RGB 或 #RRGGBB 格式" });
  }
  // logoUrl 允许 data:image/* 内联或 http(s)
  let logoUrl = typeof data.logoUrl === "string" ? data.logoUrl.trim() : b.logoUrl;
  if (logoUrl && !/^(https?:\/\/|data:image\/)/.test(logoUrl) && !logoUrl.startsWith("/branding/")) {
    return send(res, 400, { error: "Logo 需为 http(s) 图片地址、data:image 内联图或已上传的 /branding/ 路径" });
  }
  if (logoUrl.length > 300_000) return send(res, 413, { error: "Logo data URI 过大（上限 ~300KB），请压缩后重试" });
  saveBranding({ appName, logoText, logoUrl, tagline, accent, customCSS, botName });
  log(`branding updated: appName=${appName || "(默认)"} accent=${accent || "(默认)"} botName=${botName || "(默认)"}`);
  send(res, 200, { ok: true, branding: loadBranding() });
});

// --- 全局行为约束（AGENTS.md）：admin 可编辑，保存到 data/agents-md.md；留空恢复默认模板 ---

route("GET", /^\/api\/admin\/agents-md$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  send(res, 200, { content: agentsMdContent(), custom: fs.existsSync(AGENTS_MD_FILE) });
});

// 行为审计：guardrail 拦截记录（含触发消息）+ 统计。默认只出 guardrail——
// 账号启停 / 模拟登录是 admin 自己的操作记录，不参与拦截核查（?kind=account|impersonate 可单独查）
route("GET", /^\/api\/admin\/audit$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = new URL(req.url, "http://x").searchParams;
  const limit = Math.min(Number(q.get("limit") || 100), 500);
  send(res, 200, readAudit(limit, q.get("kind") || "guardrail"));
});

route("POST", /^\/api\/admin\/agents-md$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { content } = await readJson(req);
  if (typeof content !== "string" || content.length > 32 * 1024) return send(res, 400, { error: "内容非法（需为不超过 32KB 的文本）" });
  if (!content.trim()) {
    fs.rmSync(AGENTS_MD_FILE, { force: true }); // 清空保存 = 恢复内置默认模板
    send(res, 200, { ok: true, custom: false });
  } else {
    fs.writeFileSync(AGENTS_MD_FILE, content);
    try { fs.chmodSync(AGENTS_MD_FILE, 0o600); } catch { /* win */ }
    send(res, 200, { ok: true, custom: true });
  }
  log(`agents-md updated by admin`);
});

// --- 全局 MCP：admin 增删改查 + 推送 ---

route("GET", /^\/api\/admin\/mcp$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cfg = loadAdminMcp();
  // 不回传 env 里的敏感值？内网管理面板自己配的，直接回传便于编辑；标注有 env 的条目
  send(res, 200, { servers: cfg.servers || {} });
});

route("POST", /^\/api\/admin\/mcp$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { servers } = await readJson(req);
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return send(res, 400, { error: "servers 需为对象" });
  for (const [id, entry] of Object.entries(servers)) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) return send(res, 400, { error: `MCP 名称非法: ${id}` });
    const err = validateMcpServer(entry);
    if (err) return send(res, 400, { error: `${id}: ${err}` });
  }
  saveAdminMcp({ servers });
  const users = loadUsers();
  let pushed = 0;
  for (const uid of Object.keys(users)) if (applyAdminMcpToUser(uid, { servers })) pushed++;
  log(`admin mcp config saved: ${Object.keys(servers).length} servers → pushed ${pushed} users`);
  send(res, 200, { ok: true, pushed, count: Object.keys(servers).length });
});

route("GET", /^\/admin$/, (req, res) => serveStatic(res, "admin.html"));

route("POST", /^\/api\/admin\/login$/, async (req, res) => {
  if (!CONFIG.adminPassword) return send(res, 404, { error: "admin disabled（未设置 ADMIN_PASSWORD）" });
  const { password } = await readJson(req);
  const ip = req.socket.remoteAddress || "unknown";
  const fails = adminFails.get(ip);
  if (fails && fails.count >= 5 && Date.now() - fails.at < 60_000)
    return send(res, 429, { error: "失败次数过多，请稍后再试" });
  const ok = typeof password === "string" && crypto.timingSafeEqual(
    Buffer.from(crypto.createHash("sha256").update(password).digest("hex")),
    Buffer.from(crypto.createHash("sha256").update(CONFIG.adminPassword).digest("hex")),
  );
  if (!ok) {
    adminFails.set(ip, { count: (fails?.count || 0) + 1, at: Date.now() });
    return send(res, 401, { error: "管理员密码错误" });
  }
  adminFails.delete(ip);
  send(res, 200, { ok: true }, { "Set-Cookie": adminCookieHeader() });
});

route("POST", /^\/api\/admin\/logout$/, async (req, res) => {
  send(res, 200, { ok: true }, { "Set-Cookie": "zadmin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
});

function requireAdmin(req, res) {
  if (!CONFIG.adminPassword) { send(res, 404, { error: "admin disabled" }); return false; }
  if (!isAdminSession(req)) { send(res, 401, { error: "管理员未登录" }); return false; }
  return true;
}

route("GET", /^\/api\/admin\/model$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cfg = loadAdminModelConfig() || { provider: {}, main: "" };
  // 不回传 apiKey 本体，只回传是否有
  const providers = Object.fromEntries(Object.entries(cfg.provider || {}).map(([k, v]) => [k, {
    name: v.name, kind: v.kind, defaultModel: v.defaultModel,
    baseURL: v.options?.baseURL, hasKey: Boolean(v.options?.apiKey),
    models: v.models,
  }]));
  send(res, 200, { main: cfg.main || "", providers });
});

route("GET", /^\/api\/admin\/users$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = loadUsers();
  const list = Object.entries(users).map(([uid, u]) => ({
    uid, username: u.username, displayName: u.displayName, created: u.created,
    active: u.active !== false, // 老账号视为已启用
    hasHome: fs.existsSync(userHome(uid)),
  }));
  send(res, 200, { users: list });
});

// 以租户身份登录（impersonation）：admin 调试用，签发独立的 zimp 会话 cookie
// （不覆盖浏览器里已有的租户/管理员登录态），新标签页打开即是该租户的完整视图。
// 退出（/api/logout）即清掉模拟会话；重启后 zimp 仍有效（签名无状态），随 TTL 过期。
route("POST", /^\/api\/admin\/impersonate$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { uid } = await readJson(req);
  if (!isValidUid(uid || "")) return send(res, 400, { error: "uid 非法" });
  const users = loadUsers();
  const rec = users[uid];
  if (!rec) return send(res, 404, { error: "租户不存在" });
  if (rec.active === false) return send(res, 400, { error: "账号待激活，请先启用再模拟登录" });
  ensureUserHome(uid);
  const cookie = `zimp=${encodeURIComponent(sign(`${uid}|${Date.now()}`))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${CONFIG.sessionTtl}`;
  audit({ ts: new Date().toISOString(), kind: "impersonate", uid, username: rec.username, rule: "admin 以该租户身份登录（调试）" });
  log(`admin impersonate: ${rec.username} (${uid})`);
  send(res, 200, { ok: true, username: rec.username }, { "Set-Cookie": cookie });
});

// 启用 / 禁用租户账号（禁用即待激活：旧会话立即失效，运行中进程终止）
route("POST", /^\/api\/admin\/set-user-active$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { uid, active } = await readJson(req);
  if (!isValidUid(uid || "")) return send(res, 400, { error: "uid 非法" });
  if (typeof active !== "boolean") return send(res, 400, { error: "active 需为布尔值" });
  const users = loadUsers();
  if (!users[uid]) return send(res, 404, { error: "租户不存在" });
  users[uid].active = active;
  saveUsers(users);
  let killed = 0;
  if (!active) {
    for (const run of runningSessions.values()) {
      if (run.uid === uid && !run.ended) { run.stopped = true; if (run.pid) { try { process.kill(run.pid); } catch { /* ignore */ } killed++; } }
    }
  }
  audit({ ts: new Date().toISOString(), kind: "account", uid, username: users[uid].username, rule: active ? "admin 启用账号" : "admin 禁用账号（待激活）" });
  log(`admin set-user-active: ${users[uid].username} → ${active ? "enabled" : "disabled"}${killed ? ` (killed ${killed} runs)` : ""}`);
  send(res, 200, { ok: true, uid, active, killed });
});

// 手动把当前全局模型配置推送到所有用户（一般自动推送，这兜底给「改了配置但部分用户目录损坏」的场景）
route("POST", /^\/api\/admin\/push-model$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = loadUsers();
  let pushed = 0, failed = 0;
  for (const uid of Object.keys(users)) {
    try { if (applyAdminModelToUser(uid)) pushed++; else failed++; } catch { failed++; }
  }
  log(`admin push-model: pushed=${pushed} failed=${failed}`);
  send(res, 200, { ok: true, pushed, failed });
});


// --- 企业全局技能：admin 列表 / 重新注入 / 删除 ---

route("GET", /^\/api\/admin\/skills$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const skills = listGlobalSkills().map((name) => {
    let size = 0, files = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files++; size += fs.statSync(p).size; } } };
    try { walk(path.join(GLOBAL_SKILLS_DIR, name)); } catch { /* ignore */ }
    return { name, files, size };
  });
  send(res, 200, { skills, dir: GLOBAL_SKILLS_DIR });
});

// 上传技能包（zip）或单个 SKILL.md 到 data/skills/<name>/
route("POST", /^\/api\/admin\/skills\/upload$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = new URL(req.url, "http://x").searchParams;
  const name = (q.get("name") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  if (!name) return send(res, 400, { error: "缺少技能名 name" });
  const body = await readBody(req, 50 * 1024 * 1024);
  const dst = path.join(GLOBAL_SKILLS_DIR, name);
  if (body.length > 8 && body[0] === 0x50 && body[1] === 0x4b) {
    // zip：落临时文件解压（优先系统 tar，Windows 10+ 自带；失败提示手动放置）
    fs.mkdirSync(dst, { recursive: true });
    const tmpZip = path.join(DATA_DIR, ".skill-upload.zip");
    fs.writeFileSync(tmpZip, body);
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("tar", ["-xf", tmpZip, "-C", dst], { timeout: 60000 });
      // 若解压出单根目录，把内容上提
      const entries = fs.readdirSync(dst, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory()) {
        const inner = path.join(dst, entries[0].name);
        for (const e of fs.readdirSync(inner, { withFileTypes: true })) {
          fs.renameSync(path.join(inner, e.name), path.join(dst, e.name));
        }
        fs.rmSync(inner, { recursive: true, force: true });
      }
      if (!fs.existsSync(path.join(dst, "SKILL.md"))) {
        fs.rmSync(dst, { recursive: true, force: true });
        return send(res, 400, { error: "zip 解压后根层没有 SKILL.md，请检查包结构" });
      }
    } catch (e) {
      fs.rmSync(dst, { recursive: true, force: true });
      return send(res, 500, { error: "zip 解压失败（系统 tar 不可用？）：可手动把技能目录放到 " + GLOBAL_SKILLS_DIR });
    } finally { try { fs.unlinkSync(tmpZip); } catch { /* ignore */ } }
  } else {
    // 视为 SKILL.md 文本
    const text = body.toString("utf8");
    if (!text.includes("name:") || !/description:/i.test(text)) return send(res, 400, { error: "不是合法 SKILL.md（缺少 name/description frontmatter）" });
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "SKILL.md"), text);
  }
  // 立即注入全部租户
  const users = loadUsers();
  let injected = 0;
  for (const uid of Object.keys(users)) { try { injectGlobalSkills(uid); injected++; } catch { /* ignore */ } }
  log(`admin skill uploaded: ${name} → injected ${injected} users`);
  send(res, 200, { ok: true, name, injected });
});

route("POST", /^\/api\/admin\/skills\/reinject$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = loadUsers();
  let n = 0;
  for (const uid of Object.keys(users)) { try { injectGlobalSkills(uid); n++; } catch { /* ignore */ } }
  send(res, 200, { ok: true, injected: n, skills: listGlobalSkills().length });
});

route("DELETE", /^\/api\/admin\/skills\/([a-zA-Z0-9_-]+)$/, async (req, res, m) => {
  if (!requireAdmin(req, res)) return;
  const name = m[1];
  const dst = path.join(GLOBAL_SKILLS_DIR, name);
  if (!dst.startsWith(GLOBAL_SKILLS_DIR) || !fs.existsSync(dst)) return send(res, 404, { error: "技能不存在" });
  fs.rmSync(dst, { recursive: true, force: true });
  const users = loadUsers();
  for (const uid of Object.keys(users)) { try { injectGlobalSkills(uid); } catch { /* ignore */ } }
  send(res, 200, { ok: true });
});

// --- 租户自建技能：上传 zip/单文件到 用户级 或 工作区级 ---

route("POST", /^\/api\/skills\/upload$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  const name = (q.get("name") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  if ((q.get("scope") || "project") !== "project") return send(res, 403, { error: "全局技能由管理员统一管理，租户只能上传到自己的工作区" });
  const scope = "project";
  const ws = (q.get("ws") || "default").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!name) return send(res, 400, { error: "缺少技能名 name" });
  const base = path.join(wsDir(user.uid, ws), ".zcode", "skills");
  const dst = path.join(base, name);
  if (!dst.startsWith(base)) return send(res, 400, { error: "路径非法" });
  const body = await readBody(req, 50 * 1024 * 1024);
  const { execFileSync } = await import("node:child_process");
  if (body.length > 8 && body[0] === 0x50 && body[1] === 0x4b) {
    fs.mkdirSync(dst, { recursive: true });
    const tmpZip = path.join(DATA_DIR, ".skill-upload.zip");
    fs.writeFileSync(tmpZip, body);
    try {
      execFileSync("tar", ["-xf", tmpZip, "-C", dst], { timeout: 60000 });
      const entries = fs.readdirSync(dst, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory()) {
        const inner = path.join(dst, entries[0].name);
        for (const e of fs.readdirSync(inner, { withFileTypes: true })) fs.renameSync(path.join(inner, e.name), path.join(dst, e.name));
        fs.rmSync(inner, { recursive: true, force: true });
      }
      if (!fs.existsSync(path.join(dst, "SKILL.md"))) { fs.rmSync(dst, { recursive: true, force: true }); return send(res, 400, { error: "zip 根层没有 SKILL.md" }); }
    } catch (e) { fs.rmSync(dst, { recursive: true, force: true }); return send(res, 500, { error: "解压失败：" + e.message }); }
    finally { try { fs.unlinkSync(tmpZip); } catch { /* ignore */ } }
  } else {
    const text = body.toString("utf8");
    if (!/name:/.test(text) || !/description:/i.test(text)) return send(res, 400, { error: "不是合法 SKILL.md" });
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "SKILL.md"), text);
  }
  log(`skill uploaded: user=${user.uid.slice(0, 8)} scope=${scope} name=${name}`);
  send(res, 200, { ok: true, name, scope });
}, { auth: true });

route("DELETE", /^\/api\/skills\/([a-zA-Z0-9_-]+)$/, async (req, res, m, user) => {
  const q = new URL(req.url, "http://x").searchParams;
  if ((q.get("scope") || "project") !== "project") return send(res, 403, { error: "全局技能由管理员统一管理，租户不可删除" });
  const ws = (q.get("ws") || "default").replace(/[^a-zA-Z0-9_-]/g, "");
  const name = m[1];
  const base = path.join(wsDir(user.uid, ws), ".zcode", "skills");
  const dst = path.join(base, name);
  if (!dst.startsWith(base) || !fs.existsSync(dst)) return send(res, 404, { error: "技能不存在" });
  fs.rmSync(dst, { recursive: true, force: true });
  send(res, 200, { ok: true });
}, { auth: true });


// --- 密码管理 ---

route("POST", /^\/api\/me\/password$/, async (req, res, m, user) => {
  const { currentPassword, newPassword } = await readJson(req);
  const users = loadUsers();
  const rec = users[user.uid];
  if (!rec || !verifyPassword(currentPassword || "", rec)) return send(res, 401, { error: "当前密码错误" });
  if (!newPassword || newPassword.length < 6) return send(res, 400, { error: "新密码至少 6 位" });
  Object.assign(rec, hashPassword(newPassword));
  saveUsers(users);
  log(`password changed: user=${user.uid.slice(0, 8)}`);
  send(res, 200, { ok: true });
}, { auth: true });

route("POST", /^\/api\/admin\/reset-password$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { uid, newPassword } = await readJson(req);
  if (!isValidUid(uid || "")) return send(res, 400, { error: "uid 非法" });
  if (!newPassword || newPassword.length < 6) return send(res, 400, { error: "新密码至少 6 位" });
  const users = loadUsers();
  if (!users[uid]) return send(res, 404, { error: "租户不存在" });
  Object.assign(users[uid], hashPassword(newPassword));
  saveUsers(users);
  log(`password reset by admin: user=${uid.slice(0, 8)}`);
  send(res, 200, { ok: true, username: users[uid].username });
});

// 删除租户：账号 + 用户 HOME（凭据/会话/技能）+ 全部工作区目录，一并清除，不可恢复
route("POST", /^\/api\/admin\/delete-user$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { uid } = await readJson(req);
  if (!isValidUid(uid || "")) return send(res, 400, { error: "uid 非法" });
  const users = loadUsers();
  if (!users[uid]) return send(res, 404, { error: "租户不存在" });
  const username = users[uid].username;
  // 1) 停止该租户所有运行中的会话进程
  for (const run of runningSessions.values()) {
    if (run.uid === uid && !run.ended) { run.stopped = true; if (run.pid) { try { process.kill(run.pid); } catch { /* ignore */ } } }
  }
  // 2) 删除账号
  delete users[uid];
  saveUsers(users);
  // 3) 删除用户 HOME 与工作区目录（两者都在 data/ 下，路径由 uid 派生，已做正则校验）
  const targets = [userHome(uid), userWsRoot(uid)];
  const removed = [];
  const failures = [];
  for (const dir of targets) {
    try {
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(path.relative(DATA_DIR, dir)); }
    } catch (e) { failures.push(`${path.relative(DATA_DIR, dir)}: ${e.message}`); }
  }
  log(`tenant deleted: ${username} (${uid}) | removed: ${removed.join(", ") || "none"}${failures.length ? " | failures: " + failures.join("; ") : ""}`);
  send(res, 200, { ok: true, username, removed, failures });
});

// --- pages ---

route("GET", /^\/$/, (req, res) => serveStatic(res, "index.html"));
route("GET", /^\/static\/(.+)$/, (req, res, m) => serveStatic(res, m[1]));

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.pattern);
      if (!m) continue;
      if (r.auth) {
        const user = getSessionUser(req);
        if (!user) return send(res, 401, { error: "未登录" });
        // 账号被禁用（待激活）后，旧 cookie 一并失效，防止先登录后被禁用仍可操作
        if (user.active === false) return send(res, 403, { error: "账号待激活：请联系管理员开通" });
        return await r.handler(req, res, m, user);
      }
      return await r.handler(req, res, m, null);
    }
    // SPA fallback
    if (req.method === "GET") return serveStatic(res, "index.html");
    send(res, 404, { error: "not found" });
  } catch (e) {
    log("error:", e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  log(`zcode multi-tenant portal → http://${CONFIG.host}:${CONFIG.port}`);
  log(`kernel: ${CONFIG.kernelCli}`);
  log(`admin: ${CONFIG.adminPassword ? CONFIG.adminBootstrap : "(disabled)"}`);
});

// 已完结 run 的兜底回收（正常由 emit end 后保留 2h 供 attach 重放；sweepRuns 按时间清）
setInterval(sweepRuns, 30 * 60_000).unref();
