# zcode-multi-tenant

把官方 [ZCode](https://github.com/zai-org/ZCode) CLI 变成**多用户 Web 服务**：每个用户浏览器注册登录后获得独立工作区，享受同一套官方内核、全局插件与技能，同时可以创建自己的用户级 / 工作区级技能。

**服务端零 npm 依赖、单文件 Node 服务**（Node ≥ 22），无需 Docker。前端为 Svelte 5 + UnoCSS 源码（`portal/frontend/`），部署时构建一次，产物输出到 `portal/static/`。

```

```
浏览器 ──HTTP/SSE──> portal/server.mjs（单文件 Node 服务）
   │注册/登录            │  每条消息派发一次 headless CLI 进程
   │                    ▼
   │            官方内核 kernel/zcode.cjs --prompt … --output-format stream-json
   │                    │  HOME = data/users/<uid>/   ← 该用户专属
   ▼                    ▼
data/users/<uid>/.zcode/       ← 凭据、会话 db、用户级技能（per-user 隔离）
data/workspaces/<uid>/<ws>/.zcode/skills/  ← 工作区级技能
kernel/glm/packages/           ← 官方全局插件 + 技能（随内核升级，全员共享，只读）
```

## 核心设计

| 需求 | 实现方式 |
|---|---|
| 多用户登录 | 用户名+密码注册（scrypt 加盐），HttpOnly 签名 cookie 会话 |
| 用户隔离 | 每个用户一个 `data/users/<uid>/` 目录作为专属 `HOME/USERPROFILE`；每条消息以独立进程派发 CLI，凭据/会话/技能互不可见 |
| 工作区 | `data/workspaces/<uid>/<工作区名>/`，CLI `--cwd` 指向它；用户可在网页新建 |
| **管理员统一配模型** | 管理员在 `/admin` 后台配置一次（存 `data/model.json`，600 权限），自动写入每个用户 HOME；新用户注册即用；改配置立即推送全量用户；租户侧只读展示、无配置入口 |
| **产出物保存到本地** | 「📂 文件」面板：工作区目录树 → 点击预览（图片直接渲染/文本高亮）→ 一键下载到本地电脑（路径穿越防护 + 类型白名单） |
| **上传附件给 AI** | 聊天框「📎 附件」：图片/文档上传到工作区 `uploads/`（重名自动加序号），派发时走 zcode 官方 `--attach` 契约，AI 可直接读图读文档 |
| **品牌白标** | 管理员在后台配置企业名/Logo/主题色/标语/自定义 CSS（`data/branding.json`），租户端登录页与主界面即时套用 |
| **企业全局技能** | 管理员把技能放 `data/skills/`（或后台上传 zip/SKILL.md）→ 自动注入每个租户的用户级技能目录；租户自建同名技能不被覆盖 |
| **全局 MCP** | 管理员后台统一配置 MCP servers（command 本地型 / url 远程型），保存即写入全部租户的 CLI 配置 |
| **租户自建技能** | 网页「技能一览」只能上传 zip/SKILL.md 到**当前工作区**（仅本工作区生效）；全局层（跨工作区）由管理员统一下发，租户只读、不可删除 |
| 全局插件/技能 | 内核自带 `packages/`（官方插件与 bundled skills），以只读方式随内核分发，全员共享 |
| 用户自建技能 | 放 `data/users/<uid>/.zcode/skills/`（用户级）或工作区 `.zcode/skills/`（工作区级），CLI 原生识别三层叠加 |
| 内核升级 | `scripts/update-kernel.mjs`：官方 CDN manifest + sha256 校验 + 原子切换（也支持从桌面安装目录复制 / 手动放置），**portal 代码零改动** |

## 快速开始

```bash
# 0. 要求 Node >= 22（本机已装 ZCode 桌面端则直接可用）

# 1. 安装内核（从本机桌面安装复制；Linux 服务器可用 --source cdn）
node scripts/update-kernel.mjs --source desktop
#   Windows 自动探测 C:/Program Files/ZCode/resources/glm
#   或指定路径: node scripts/update-kernel.mjs --source desktop --desktop <…/ZCode/resources/glm>

# 2. 构建前端（Svelte 5 源码在 portal/frontend/，产物输出到 portal/static/）
#    Windows 上 dev.bat / prod.bat 启动时会自动 npm ci + build；Linux/手动部署执行：
cd portal/frontend && npm ci && npm run build && cd ../..

# 3. 启动（Windows 可直接双击 prod.bat：自动构建后起服务）
ADMIN_PASSWORD=youradmin PORT=9900 node portal/server.mjs

# 4. 租户：浏览器打开 http://localhost:9900 → 注册 → 直接聊天
# 5. 管理员：浏览器打开 http://localhost:9900/admin → 用 ADMIN_PASSWORD 登录
#    → 「全局模型配置」填 provider（Z.ai Coding Plan: kind=anthropic,
#      baseURL=https://open.bigmodel.cn/api/anthropic）→ 保存即推送给全部租户
#    模型列表逐行配置：每个模型可单独设置上下文窗口、最大输出、视觉/PDF/视频输入、
#    思考等级（逗号分隔，最后一级为默认）；首行为默认模型，其余按顺序失效回退。
```

## 内核升级（官方发新版后）

仓库根目录有免记参数的包装脚本，双击 `update-kernel.bat`（Windows）会出交互菜单：

```bash
bash update-kernel.sh check        # 看当前/最新可用版本
bash update-kernel.sh update       # 自动升级（CDN 源，探测+sha256 校验+原子切换）
bash update-kernel.sh desktop      # 从新装的桌面端复制（版本最新时推荐）
bash update-kernel.sh rollback     # 出问题回滚

update-kernel.bat check            # Windows 同款；无参数运行出菜单
```

需要更细的控制（手动 staging、指定桌面路径等）直接调底层脚本，包装脚本也支持原样透传 flag：

```bash
node scripts/update-kernel.mjs --check                  # 同 check
node scripts/update-kernel.mjs --source manual --commit # 提交 kernel/.staging 为新内核
node scripts/update-kernel.mjs --source desktop --desktop <…/ZCode/resources/glm>
node scripts/update-kernel.mjs --rollback               # 同 rollback
```

升级期间运行中的会话不受影响（内核目录原子切换）；用户数据在 `data/` 下与内核完全无关。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 9900 | 监听端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `FLASK_SECRET` | 从数据目录派生 | session 签名密钥（多实例部署必须显式设） |
| `ADMIN_PASSWORD` | 空（禁用） | 设置后 admin 用户可访问 `/api/admin/users` |
| `ADMIN_USER` | admin | 管理员用户名 |
| `ZCODE_MODEL` | 空 | 新用户默认模型 |
| `ZCODE_MODE` | plan | 默认权限模式（plan/build/edit/guarded） |
| `ZCODE_CLI_ENTRY` | kernel/zcode.cjs | 内核路径 |
| `ZCODE_CDN_BASE` | 官方 CDN | update-kernel 的下载源 |
| `ZCODE_DESKTOP_DIR` | 自动探测 | 桌面安装目录 |

**页面入口**：

| 路径 | 谁 | 功能 |
|---|---|---|
| `/` | 租户 | 聊天、工作区、技能（上传/删除）、文件目录树/下载、附件上传；界面按管理员品牌配置渲染 |
| `/admin` | 管理员 | 独立密码门：全局模型配置、品牌白标、企业全局技能、全局 MCP、租户列表（重置密码 / 删除租户及其工作区） |

## 目录结构

```
zcode-multi-tenant/
├── portal/
│   ├── server.mjs          # 全部后端（单文件）
│   └── static/index.html   # 前端单页
├── scripts/update-kernel.mjs  # 内核升级（多源 + 校验 + 原子切换）
├── kernel/                 # 内核（zcode.cjs + packages/ + provider/），勿手改
├── data/                   # 运行时数据（备份这个目录 = 备份一切）
│   ├── users.json          # 账号表（密码哈希）
│   ├── users/<uid>/        # 每用户 HOME：凭据、会话、用户级技能
│   └── workspaces/<uid>/   # 每用户工作区
└── ref/                    # 参考项目（可删）
```

## 技能分层说明

zcode CLI 原生支持三层技能（portal 无需任何特殊处理）：

| 层 | 路径（宿主视角） | 生效范围 | 谁能写 |
|---|---|---|---|
| 全局（官方） | `kernel/packages/` | 所有用户所有工作区 | 仅内核升级 |
| 用户级 | `data/users/<uid>/.zcode/skills/` | 该用户所有工作区 | 用户自己 |
| 工作区级 | `data/workspaces/<uid>/<ws>/.zcode/skills/` | 仅该工作区 | 用户自己 |

网页「🧩 技能一览」可查看当前用户/工作区加载了哪些自建技能（官方插件技能在内核层，不在此列）。

## 安全模型（内网自部署）

- 密码 scrypt 加盐哈希存储；cookie HttpOnly + SameSite=Lax + HMAC 签名；管理员会话（zadmin）与用户会话（zportal）完全独立
- 管理员 API key 存 `data/model.json`（0600）并下发到各用户 HOME（0600）；portal 不落日志；用户/管理员 API 互不可见对方密钥
- 模型配置只允许 admin 会话修改；租户侧 `/api/me/provider` 一律 403
- 用户身份 → `uid`（用户名派生 16 hex）→ 目录名，严格正则校验防路径穿越；文件预览/下载同样做 root 前缀校验 + 扩展名白名单
- 附件上传：类型白名单 + 20MB 上限 + 重名自动加序号不覆盖；派发前再次校验路径落在工作区内
- CLI 每次消息独立进程派发，默认 `plan` 模式；用户可切 `build/edit/guarded`
- ⚠️ 这是给 agent 执行 shell 的服务，务必：仅内网部署 / 前置反向代理加 TLS / 不要把 9900 直接暴露公网

## 已验证

- ✅ 内核安装（桌面源 + CDN 源探测、sha256 校验、原子切换、回滚）
- ✅ 注册/登录、会话 cookie、用户目录隔离（alice 看不到 bob 的技能）
- ✅ 技能三层叠加（内核 13+ → 用户级 → 工作区级）
- ✅ headless 派发 → SSE 流式（reasoning_delta / text_delta / session.updated / result）
- ✅ `--resume` 续会话（同 sessionId 上下文延续）
- ✅ 管理员后台：独立密码门登录、全局模型配置保存 → 自动推送全部用户、新用户注册即用、租户侧只读 403
- ✅ 工作区目录树 / 文件预览（图片渲染）/ 下载到本地
- ✅ 附件上传 → `--attach` 派发（AI 可读上传的图片与文档）
- ✅ 品牌白标：企业名/Logo/主题色/标语即时生效于租户端（登录页与主界面）
- ✅ 企业全局技能：管理员上传 → 自动注入全部租户 → CLI `skills list` 识别
- ✅ 租户自建技能：网页上传（用户级/工作区级）→ CLI 识别
- ✅ 全局 MCP：管理员配置 → 下发到每个租户的 CLI 配置

## 参考与致谢

- [Syakaraka/claude-code-portal](https://github.com/Syakaraka/claude-code-portal) —— 多用户门户 + per-user 容器的架构参考（本项目把它改成零 Docker 的 HOME 隔离方案）
- [windviki/zcode-webui](https://github.com/windviki/zcode-webui) —— 官方 CDN 组件分发 / 内核升级脚本逻辑参考
- [ther12k/zcode-web](https://github.com/ther12k/zcode-web) —— headless CLI 契约（`--prompt`/`--resume`/`ZCODE_MODEL`）参考
