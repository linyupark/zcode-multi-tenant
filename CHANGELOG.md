# Changelog

追踪门户的每次改动，重点记录「为什么改」和「影响面」，避免后续迭代 reintroduce 旧 bug。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号暂以日期分节。
每节按 **修复 / 变更 / 新增** 分组，注明涉及文件与回归验证方法。

## [2026-11-10]

### 修复

- **`POST /api/chat` 补回 `{ auth: true }`** (`120c5d2`, `portal/server.mjs`)
  同会话打断排队重构时把路由的 auth 选项弄丢：`route()` 默认 `auth: false`，
  不解析登录态，`user` 传入 `null`，所有发消息请求报
  `Cannot read properties of null (reading 'uid')`。
  ⚠️ 教训：**改 route 签名/搬移处理器主体时，尾部 `}, { auth: true });` 必须跟着走**。

- **attach 续播 `ev is not defined`** (`8d6c823`, `portal/frontend/src/lib/sse.js`)
  `replay-done` 分支引用了不存在的 `ev` 变量（事件数据是内联传给 `onEvent` 的），
  attach 时服务端必发 `replay-done` → 抛 ReferenceError → 显示「恢复运行失败」。
  触发面：模拟登录恢复会话、刷新页面恢复后台 run —— 全走 attach 链路，必现。
  表面上是「报错」，实际危害是**假死**：续播失败界面回空闲态，但 CLI 进程还在跑。

- **错误信息改走 toast** (`8d6c823`, `ui.svelte.js` / `Shell.svelte` / `chat.svelte.js` / `session.svelte.js` / `uploads.js`)
  错误/失败类消息（恢复运行失败、回放失败、上传失败、删除失败、流错误）不再写
  底部状态行，改为顶部居中 toast（4s 自动消失）；中性进度/结果（完成、退出码、
  已停止、上传中）保留状态行。口径同 11-06 guardrail 改法：错误与进度不混在一行。

### 新增

- **同会话新指令自动打断旧任务 + 排队续发** (`59444f1`, `portal/server.mjs` + 前端)
  背景：attach 假死 + 服务端无同会话并发防护 → 两个 CLI 同时 `--resume` 同一会话，
  交错写会话历史、互踩工作区文件（模型反复看到「文件被外部编辑」、docx 表格串改）。
  行为：
  - 同会话存在未完结 run 时，新指令 = 打断旧任务（`stopped` + kill，等同停止按钮）；
  - 打断间隙到达的消息暂存 `runQueue`，旧 run 收 `end` 后 `dispatchQueued` **串行**续发
    （派发前重查并发，余量转入新队列，防队列自己打架）；
  - run 条目新增 `reqSession`：保留派发请求原样携带的 sessionId（首条消息 CLI 尚未
    回真实 id 时也能匹配）；
  - 前端：`queue` 事件置 `t.queued`，状态行显示「已打断旧任务，本条排队中…」；
    被打断轮的 `end` 不再显示误导性的「退出码 1」。
  验证：长任务会话连发两条消息 → 第一条显示排队提示、旧任务停止，无两轮交错。

## [2026-11-06]

### 新增

- **租户显示名注入会话上下文与技能命名空间** (`b6cd723`)
  `ZCODE_USER_NAME` / `ZCODE_USER_ACCOUNT` 注入 CLI env，AGENTS.md「当前对话用户」
  节与 personal-memo 等按人区分的技能同源。

- **admin 统一配置技能环境变量** (`593965d`)
  技能脚本进程内直读，值不落工作区、钩子拦外显；`ZCODE_*` 保留前缀不可覆盖。

- **行为审计一键清空拦截记录** (`62deabc`)

### 修复

- **guardrail 拦截文案只进对话流** (`8f43c07`)
  不再重复写底部状态行——同一条文案上下重复误导用户。

## [2026-11-02 ~ 11-05]

- `97a7d6b` **CLI run 与 SSE 连接解耦**：刷新/切走不再杀进程，run hub（ring 缓冲 +
  attach 重放）支撑断线续播。⚠️ 这是本次串改问题的架构起点——解耦后「界面空闲 ≠
  任务结束」，同会话并发防护（11-10）是它的必要补丁。
- `c623a5b` guardrail 迁移为内核 PreToolUse 钩子（deny 回喂自愈，run 不再终止）。
- `f54b4f4` admin 模拟登录租户（独立 `zimp` cookie，审计记录）。
- 其余：输出文件卡片只显交付物、Office 上传放行、工作区文件删除、AGENTS.md 瘦身等。

## 回归自查清单（改动 chat 链路时过一遍）

1. 正常发消息 → 流式回复、`end` 后侧栏转圈消失。
2. 刷新页面 → attach 续播无报错（`replay-done` 分支）。
3. 模拟登录 → 恢复会话正常续播。
4. 长任务中再发一条 → 旧任务打断、新消息排队续发，无并发交错。
5. 断网/停止按钮 → 「已停止（上下文保留）」，后台 run 确实终止。
6. 新路由/改路由 → 尾部 `{ auth: true }` 是否还在（grep 该文件所有 `route(` 尾行）。
