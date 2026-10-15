<h1 align="center">🛰️ larkctl</h1>
<p align="center"><b>代码在家里，人在外面？在飞书里发一句话，电脑替你干活。</b></p>

<p align="center">
  <a href="https://github.com/hucheng91/larkctl/actions/workflows/ci.yml"><img src="https://github.com/hucheng91/larkctl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.17-339933?logo=node.js&logoColor=white" alt="node >= 18.17">
  <img src="https://img.shields.io/badge/Feishu%20%2F%20Lark-long%20connection-3370FF" alt="Feishu / Lark">
  <img src="https://img.shields.io/badge/agents-Codex%20%7C%20Claude%20Code%20%7C%20OpenCode-8A2BE2" alt="agents">
</p>

<p align="center"><a href="README.md">English</a> · <a href="#-快速开始">快速开始</a> · <a href="#命令">命令</a> · <a href="#安全">安全</a> · <a href="#-常见问题">常见问题</a></p>

---

### 🚇 你在地铁上，突然想起……

家里电脑上跑着的 AI Agent 可能早就跑完了，也可能卡在一个问题上；或者那个 bug 的修法你刚好想到了。可电脑在家里，你手里只有手机。

### 😩 想连回自己的电脑？这是个网络问题

家里或公司的电脑躲在路由器和防火墙（NAT）后面。要连回去，得有公网 IP、做端口映射，或者搭 VPN、内网穿透隧道（frp、ngrok、Tailscale……）并一直维护着；跨境网络连接还时断时续。就为了在终端里敲一行字。

### 💡 有了 larkctl：在飞书里发一句话就行

飞书本来就在你手机上，在哪儿都连得上。larkctl 在你的电脑上运行，主动向飞书建立 **出站长连接**：不用开端口，不用公网 IP，也不用隧道。私聊机器人「修一下 web 项目里挂掉的测试」，你电脑上的 Codex / Claude Code / OpenCode 就开工了，进度实时回到聊天里。

| | 传统远程访问 | **larkctl** |
|---|---|---|
| 网络配置 | 公网 IP、端口映射、VPN 或内网穿透（frp / ngrok / Tailscale） | **无需配置**，只有出站长连接 |
| 暴露端口 | SSH / RDP / VNC 暴露在公网 | **零** 入站端口 |
| 手机上操作 | 小屏终端或远程桌面，打字费劲 | **聊天**：点按钮、说一句话，或者发语音 |
| 网络不稳 | 断线、重连、从头再来 | 消息由飞书送达，任务在你电脑上继续跑 |
| 多个任务 | 来回切终端标签、tmux | **一个话题 = 一个任务**，并行进行 |
| 看进度 | 翻日志 | 实时进度卡片，随时截图 |
| 安全 | 谁连进来都有完整 Shell | 白名单、危险命令二次确认、只读模式、审计日志 |

<p align="center">
  <a href="docs/demo.mp4"><img src="docs/demo.gif" width="800" alt="larkctl 演示 —— 点击观看带配音的 MP4"></a><br/>
  <sub>▶️ <a href="docs/demo.mp4">观看 45 秒配音演示视频（MP4）</a></sub>
</p>

## ☕ 用 larkctl 的一天

<table>
<tr><td width="46%"><img src="docs/images/01-menu.png" alt="01-menu"></td><td>

**08:40 · 地铁上：「电脑在干嘛呢？」**

发一句 `/menu`。一张卡片显示当前 Agent、项目和会话，所有操作都有按钮。你的飞书版本点按钮没反应？直接回复数字。

</td></tr>
<tr><td width="46%"><img src="docs/images/02-switch.png" alt="02-switch"></td><td>

**08:45 · 「这个活让 Claude 来」**

点 **claude**（或回复 `2`），下一句话就交给 Claude Code。每个 Agent 各自保留会话。

</td></tr>
<tr><td width="46%"><img src="docs/images/03-task.png" alt="03-task"></td><td>

**09:10 · 咖啡馆里：一句话，真代码**

「在 /tmp/demo 里用 Python 写一个打印九九乘法表的脚本并运行」—— Agent 在 *你的* 电脑上写好文件、跑完，回报结果：12 秒完成。

</td></tr>
<tr><td width="46%"><img src="docs/images/04-screenshot.png" alt="04-screenshot"></td><td>

**12:30 · 「真的跑通了吗？」**

发「截图」，电脑桌面截图直接回到聊天里。

</td></tr>
<tr><td width="46%"><img src="docs/images/06-thread.png" alt="06-thread"></td><td>

**15:00 · 两件事同时做**

每个任务开一个话题。每个话题有自己的 Agent、项目和会话，并行运行、互不干扰。

</td></tr>
<tr><td width="46%"><img src="docs/images/07-sh.png" alt="07-sh"></td><td>

**18:20 · 回家的路上：顺手敲个命令**

`/sh ls /tmp/demo` 或 `!git status` 在项目目录里执行命令并返回输出；危险命令会先让你确认。

</td></tr>
</table>

## ✨ 你会得到

| | | |
|---|---|---|
| 🤖 **可插拔编程 Agent**<br/>Codex、Claude Code、OpenCode、自定义命令 Agent、npm/JS 插件 | 💬 **一句话写代码**<br/>普通文本发给 Agent，进度实时更新在卡片里 | 🧵 **话题并行多任务**<br/>每个飞书话题独立的 Agent、项目、会话和任务 |
| 🎛️ **菜单卡片一键操作**<br/>切换 Agent / 项目、新会话、停止、状态；按钮不可用时回复数字即可 | 📸 **随时截图**<br/>`/screenshot` 或直接说「截图」看桌面 | 🐚 **远程命令**<br/>`/sh` 或 `!cmd`，bash/zsh/PowerShell，超时与 `/stop` |
| 🎤 **语音 & 🖼 图片输入**<br/>飞书 ASR / whisper；图片直接交给 Agent | 🔐 **默认安全**<br/>白名单、危险命令二次确认、只读模式、审计日志 | 🌐 **NAT 后也能用**<br/>只有出站 WebSocket，电脑不暴露任何端口 |

## 🔌 工作原理

```mermaid
flowchart LR
  P["📱 Feishu / Lark<br/>on your phone"] --> F["☁️ Feishu Open Platform"]
  D["💻 larkctl<br/>on your computer"] -- "outbound long connection<br/>(no open ports)" --> F
  D --> A1["Codex CLI"]
  D --> A2["Claude Code"]
  D --> A3["OpenCode / custom / plugins"]
  D --> SH["Shell · Screenshot"]
```

larkctl 是电脑上的一个小守护进程，通过飞书长连接事件订阅 *主动* 连到飞书（WebSocket），电脑无需被公网访问。每条消息会交给对应项目目录下选定的 Agent 或 Shell，进度以可更新卡片的形式回传，全部记录到审计日志。

<details><summary>详细架构</summary>

```mermaid
flowchart LR
  P[📱 手机飞书 / Lark] -- 发消息 --> F[(飞书开放平台<br/>open.feishu.cn / open.larksuite.com)]
  F -- "im.message.receive_v1<br/>出站 WebSocket 长连接<br/>(WSClient)" --> D
  subgraph PC[你的电脑 —— 在 NAT 后面，无需开放入站端口]
    D[larkctl 守护进程<br/>EventDispatcher] --> S{白名单<br/>只读模式<br/>危险命令检查}
    S -- Agent 提示词 --> A[Agent 适配器<br/>codex / claude / opencode / 自定义 / 插件]
    S -- /sh --> SH[bash/zsh · PowerShell]
    S -- /screenshot --> SC[screencapture / .NET]
    A --> R[执行器：超时、/stop、杀进程树]
    SH --> R
    R --> AU[(audit.log 审计日志)]
  end
  R -- "回复/更新卡片、上传文件/图片<br/>(Open API, HTTPS)" --> F
  F --> P
```

</details>

## 🚀 快速开始

要求：Node.js ≥ 18.17；电脑上已安装并登录需要的 Agent CLI（`codex`、`claude`、`opencode`）。

```bash
npm i -g github:hucheng91/larkctl   # 安装 larkctl 命令
larkctl init                        # App ID / Secret、飞书或 Lark、白名单、默认 Agent 和目录
larkctl start                       # 连接并开始服务（Ctrl-C 退出；--daemon 后台运行）
```

1. 创建飞书企业自建应用，开启 **机器人** 能力，添加权限，事件 **和** 回调都选 **长连接** —— 详见 [创建飞书应用（分步）](#创建飞书应用分步)。
2. 运行 `larkctl init` + `larkctl start`，发布应用版本，私聊机器人 `/whoami`，把 `open_id` 加入白名单后重启。
3. 发送 `/menu`，或者直接告诉它要做什么。

```
/whoami                        → 显示你的 open_id（用 `larkctl init` 加入白名单）
/cwd web                       → 切换到项目 web（config.projects）或任意路径
修复 api.ts 里不稳定的测试      → 普通文本 = 发给当前 Agent 的提示词（自动续接会话）
/agent claude                  → 切换 Agent（codex | claude | opencode | 自定义 | 插件）
/new                           → 开新会话
!git status                    → Shell（也可用 /sh）
/stop  /status  /screenshot  /menu
```

完全不用飞书也能试：`larkctl start --mock` —— 标准输入的每一行当作聊天消息，回复打印到终端（示例见 [docs/evidence/mock-session.txt](docs/evidence/mock-session.txt)）。

## 命令

| 命令 | 说明 |
|---|---|
| *普通文本* | 在当前目录把提示词发给当前 Agent。按「会话+Agent」记住 session id，下次自动续接。 |
| `/agent [名称] [提示词]` | 查看/切换 Agent，可直接带提示词。`/agents` 列出全部。 |
| `/new [提示词]` | 丢弃当前 Agent 会话，开新对话。 |
| `/cwd <项目名\|路径>`（别名 `/cd`、`/project`） | 切换工作目录（会重置会话）。`/projects` 列出配置里的项目快捷方式，`/pwd` 查看。 |
| `/sh <命令>` 或 `!<命令>` | macOS/Linux 用 bash/zsh（`$SHELL -lc`），Windows 用 PowerShell。 |
| `confirm <验证码>` | 执行待确认的危险命令。 |
| `/stop` | 终止正在运行的任务（整个进程树）。 |
| `/status` | 当前 Agent、会话、目录、运行中的任务。 |
| `/screenshot` | 截屏并以图片发回（macOS `screencapture`，Windows .NET，Linux gnome-screenshot/scrot/import）。 |
| `/menu`（或 `help`、`菜单`、任何未知命令） | **快捷选择卡片**：按钮切换 Agent（codex / claude / opencode / 自定义）、选择项目、新会话、停止、截图、状态，手机上不用打字。 |
| `截图` / `screenshot` | `/screenshot` 的自然语言快捷方式；`做得怎么样` / `进度` / `好了吗` → 状态卡片 + 截图（仅 ≤16 字的短消息触发）。 |
| `/whoami` | 显示你的 open_id 和 chat_id，任何人可用，用于初始配置。 |

每个会话同一时间只跑一个任务，其他请求会提示「Busy」。Agent 进度：先发一张卡片，每 `progressIntervalSec` 秒 **更新（patch）** 一次，显示最近的工具调用/命令和最新回答，结束时替换为最终结果。超过 `maxReplyChars` 的输出在卡片中截断（保留头尾），完整内容以文件形式发送。

### 手机友好：语音、图片、话题

- **语音 🎤**：在飞书里按住说话。机器人下载语音（`im.messageResource`），用 `ffmpeg` 转成 16k PCM，调用 **飞书语音识别**（`speech_to_text` 接口，需要权限 `speech_to_text:speech`），失败时回退到本地 **whisper**（whisper.cpp 的 `whisper-cli`、openai-whisper 的 `whisper`，或配置 `whisperCommand`）。识别结果会先回显（`🎤 …`），之后与文字消息完全相同处理（提示词、`/命令`、截图）。配置：`"asr": "auto" | "feishu" | "whisper" | "off"`。都不可用时会明确回复原因。
- **图片 🖼**：图片消息或富文本中的图片保存到 `<项目>/.larkctl/inbox/`，交给 Agent：Codex 使用 `--image=<文件>`，所有 Agent 的提示词里都会附上图片路径。单独发送的图片会暂存，附加到你的**下一条**消息。
- **回传图片**：`/screenshot`（或 📸 按钮、「截图」）通过 `im.image.create` 上传并回复到同一话题。Agent 回答中提到的、本次运行生成/修改的图片文件（如 `saved to chart.png`）最多回传 3 张（`"sendAgentImages": false` 关闭）。
- **Agent 可写代码**：codex 以 `-c sandbox_mode="workspace-write"` 运行，claude 以 `--permission-mode acceptEdits` 运行。`"agentAccess": "full"` 对应 codex `danger-full-access` / claude `bypassPermissions`；`readOnly: true` 对应 codex `read-only` / claude `plan`。
- **话题（Thread）**：每个飞书话题拥有独立的 Agent、项目目录、会话和运行中的任务，多个话题可**并行**工作；回复发在话题内（`reply_in_thread`）。话题外的消息共用会话级状态。`/stop` 只停止当前话题的任务。绑定关系持久化在 `state.json`（键为 `chat_id#thread_id`）。新话题继承会话当前的 Agent 和项目。

## 编程 Agent

| Agent | 调用方式 | 续接 |
|---|---|---|
| `codex` | `codex exec --json --skip-git-repo-check --cd <dir> -`（提示词走 stdin） | `codex exec resume --json … <thread_id> -` |
| `claude` | `claude -p --output-format stream-json --verbose`（提示词走 stdin） | `--resume <session_id>` |
| `opencode` | `opencode run --format json <提示词>` | `--session <sessionID>` |

这些都是非交互模式，Agent 运行中无法向你申请权限。用 `agentArgs` 给每个 Agent 设定你能接受的自主程度：

```json
"agentArgs": {
  "codex": ["--full-auto"],
  "claude": ["--permission-mode", "acceptEdits"]
}
```

### 自定义命令 Agent（仅需配置）

```json
"customAgents": {
  "aider": { "command": "aider", "args": ["--message", "{prompt}", "--yes-always"] },
  "gemini": { "command": "gemini", "args": ["-p"], "promptViaStdin": true }
}
```

占位符 `{prompt}`、`{cwd}`、`{session}`；有 session 时追加 `resumeArgs`；`parser` 可复用内置输出解析器（默认 `text`，可选 `codex`/`claude`/`opencode`）。参数不经过 shell，提示词不会被 shell 解释。

### 编写 Agent 适配器插件

插件是一个 ES 模块（本地文件或 npm 包），导出一个 `AgentAdapter`（`default` 或 `adapters`）、适配器数组，或工厂函数 `({ config }) => adapter | adapter[]`：

```ts
import type { AgentAdapter } from 'larkctl';

const adapter: AgentAdapter = {
  name: 'aider',                       // /agent aider
  description: 'Aider',
  // 纯函数：构造进程调用。larkctl 负责在 opts.cwd 中启动、超时、/stop、进度卡片和最终回复
  buildInvocation({ prompt, cwd, sessionId, extraArgs = [] }) {
    return { command: 'aider', args: ['--message', prompt, '--yes-always', ...extraArgs] /*, stdin, env */ };
  },
  // 可选：把每行输出解析为事件
  //   { type: 'session', id }   -> 记住，下次作为 sessionId 传回
  //   { type: 'text', text }    -> 最终回答的一部分
  //   { type: 'progress', text } -> 显示在实时进度卡片中
  //   { type: 'error', text }
  parseLine(line) { return line.trim() ? [{ type: 'text', text: line }] : []; },
  // 可选：没有 text 事件时根据原始输出计算回答
  finalize(raw) { return raw.slice(-2000); },
};
export default adapter;
```

在 `config.json` 中注册：`"plugins": ["./my-adapter.mjs", "larkctl-adapter-foo"]`。相对路径和包名都相对配置目录解析（npm 插件装到配置目录：`cd "<配置目录>" && npm i larkctl-adapter-foo`）。加载失败会显示在 `/agents` 和日志中，不会让守护进程崩溃。示例：[examples/aider-adapter.mjs](examples/aider-adapter.mjs)。

## 创建飞书应用（分步）

1. 打开开发者后台 **https://open.feishu.cn/app**（Lark 为 https://open.larksuite.com/app）→ **创建企业自建应用**，名称图标随意。
2. **凭证与基础信息**：复制 **App ID**（`cli_…`）和 **App Secret**。
3. **添加应用能力 → 机器人**：开启机器人能力。
4. **权限管理** → 开通以下权限（可「批量导入」：`{"scopes":{"tenant":["im:message","im:message:send_as_bot","im:message.p2p_msg:readonly","im:message.group_at_msg:readonly","im:resource","speech_to_text:speech"]}}`）：
   - `im:message.p2p_msg:readonly` 读取用户发给机器人的单聊消息
   - `im:message.group_at_msg:readonly` 接收群聊中 @机器人 的消息（只在群里用时需要）
   - `im:message:send_as_bot` 以应用身份发消息
   - `im:message` 获取与发送单聊、群组消息（回复及 **更新卡片消息** 需要）
   - `im:resource` 获取与上传图片或文件资源（截图、长输出文件、下载你发的图片/语音）
   - `speech_to_text:speech` （可选）语音消息识别（飞书 ASR）
5. **先**在电脑上运行 `larkctl init` 和 `larkctl start` —— 后台选择长连接模式时会检测是否有在线连接。
6. **事件与回调 → 事件配置**：订阅方式选 **使用长连接接收事件**，保存；**添加事件** → `im.message.receive_v1`（接收消息 v2.0）。
   **回调配置** 页签：订阅方式同样选 **使用长连接接收回调**，**添加回调** → `card.action.trigger`（卡片回传交互）—— 快捷按钮需要它。
   可选：**机器人 → 自定义菜单**：可添加「发送文字消息」类型的菜单项，如 `/menu`、`/screenshot`、`/status`、`/stop`，larkctl 当作普通文字处理（无需订阅菜单事件）。
7. **版本管理与发布** → 创建版本，可用范围设为你自己，申请发布（企业内可能需要管理员审批；权限和事件的修改都要发布新版本后才生效）。
8. 在飞书里搜索机器人名字，私聊发送 `/whoami`，把 `open_id` 加入白名单（再次 `larkctl init`），重启。
9. 群聊（可选）：把机器人拉进群，@它发送 `/whoami` 得到 `chat_id`，加入 `allowChats`。群里只有 @机器人 的消息会送达，且发送者仍需在 `allowUsers` 中（除非开启 `allowAnyUserInAllowedChats`）。

国际版 Lark（larksuite.com）在 `init` 时选择 `lark` 域名。

## 配置

`larkctl init` 写入 `config.json`（文件权限 600）：
- macOS `~/Library/Application Support/larkctl/` · Windows `%APPDATA%\larkctl\` · Linux `$XDG_CONFIG_HOME/larkctl/`（可用 `LARKCTL_CONFIG_DIR` 覆盖）。环境变量 `LARKCTL_APP_SECRET` 可覆盖存储的 Secret。

其他配置项：`allowUsers`、`allowChats`、`allowAnyUserInAllowedChats`(false)、`replyToStrangers`(false=不回复)、`readOnly`(false)、`commandTimeoutSec`(120)、`agentTimeoutSec`(1800)、`maxReplyChars`(3500)、`defaultAgent`、`defaultCwd`、`projects`（`{"web": "/Users/me/code/web"}`）、`customAgents`、`plugins`、`agentArgs`、`extraDangerousPatterns`（正则字符串）、`progressIntervalSec`(5)。同目录下有 `audit.log`（JSONL 审计日志）、`state.json`（每个会话的目录/Agent/session）和守护进程日志。`larkctl config` 打印配置（Secret 已脱敏）。

## 后台运行

- `larkctl start --daemon` / `larkctl stop` —— 简单的后台进程（日志在配置目录 `larkctl.log`）。
- macOS launchd：[docs/service/com.larkctl.plist](docs/service/com.larkctl.plist)
- Linux systemd 用户服务：[docs/service/larkctl.service](docs/service/larkctl.service)
- Windows 任务计划程序 / NSSM：[docs/service/windows.md](docs/service/windows.md)

请以 **你自己的用户** 身份运行（LaunchAgent / 登录时启动的任务），这样 Agent 能找到登录态，截图也能看到桌面。

## 安全

这在设计上就是「远程在你电脑上执行代码」，使用前请阅读：

- **默认拒绝**：只服务 `allowUsers` 中的 open_id（群聊还需 chat 在 `allowChats` 中）。其他人收不到任何回复（或在 `replyToStrangers` 时收到拒绝）。只有 `/whoami` 对任何人响应，且只返回发送者自己的 id。机器人/应用发出的消息会被忽略。
- **你的飞书账号就是钥匙**：任何能以你身份发消息的人（未锁屏的手机、被盗账号）都能控制你的电脑。妥善保管 App Secret；它以 600 权限存储，从不写入日志。发布时把可用范围限制为你自己。
- **危险命令**（`rm -r`、`sudo`、`mkfs`、`dd of=`、`shutdown/reboot`、`format C:`、`del /s`、`rd /s`、`Remove-Item -Recurse`、`diskpart`、`git push --force`、`git reset --hard`、`curl | sh`、fork 炸弹、`reg delete` 等，见 `src/security.ts`）需要同一用户在 2 分钟内回复 `confirm <验证码>`。这只是防手滑的减速带，**不是沙箱**，混淆过的命令可以绕过。
- **编程 Agent 不受危险命令过滤**，它们按你给的自主参数运行。请优先使用 Agent 自带的沙箱/权限模式。
- **只读模式** 禁用 Agent，仅允许少量查看类命令（`ls`、`cat`、`git status/log/diff` 等），且不允许管道/重定向。
- 所有命令和 Agent 运行都有 **超时**；`/stop` 会杀掉整个进程树。
- **审计日志**：每次接受/拒绝的请求、确认和结果都追加到 `audit.log`。
- 飞书重复投递的事件按 message_id 去重。

## 限制（v0.1）

- 已用 SDK 的 `EventDispatcher` + 模拟客户端和 `--mock` 模式本地验证；尚未在 CI 中连接真实租户。
- Agent 输出格式（Codex `--json`、Claude `stream-json`、OpenCode `--format json`）会随版本变化，解析为尽力而为，失败时回退为原始输出。
- 非交互 Agent 运行中无法向你申请审批；暂无交互式 TTY/tmux 模式（需要的话参考下方同类项目）。
- 支持文本、富文本、图片和语音消息；其他文件暂不支持。每个会话/话题同时只运行一个任务。
- 飞书语音识别单段最长约 60 秒。
- 卡片 Markdown 有长度限制，超长回答以文件发送。
- 危险命令检测基于正则，可被绕过。

## ❓ 常见问题

**卡片按钮点了没反应（如飞书个人版）？** 部分版本/租户不会投递卡片回调（`card.action.trigger`）。每张菜单/状态卡片都同时列出带编号的选项，并在底部提示「按钮点了没反应？（如飞书个人版不支持卡片回调）直接回复数字即可」—— 直接回复 `1`、`2`… 即可。另外请确认 **回调配置**（不只是事件）也选了长连接，并发布了新版本。

**Codex / Claude Code 能用其他模型吗？** 可以 —— 通过 [magpie](https://github.com/yetone/magpie) 这样的网关把 Codex / Claude Code 的请求转到其他模型。larkctl 只是调用这些 CLI，只要在启动 `larkctl start` 的环境里设置好它们需要的环境变量/配置（如 `MAGPIE_API_KEY`、base URL）即可生效。

**需要公网 IP / 服务器吗？** 不需要，larkctl 只建立到飞书/Lark 的出站连接。

**能同时跑多个任务吗？** 可以：每个任务开一个话题。每个会话或话题同一时间运行一个任务。

**怎么看进度？** Agent 进度每 `progressIntervalSec` 秒更新到卡片里；随时发送 `/status`、`/screenshot` 或「截图」。

**调试日志？** 设置 `LARKCTL_DEBUG=1` 记录每个收到的 WebSocket 帧（默认关闭）。

## 参考与同类项目

- **飞书官方 CLI** —— [`@larksuite/cli`](https://www.npmjs.com/package/@larksuite/cli)（`npx @larksuite/cli`）：`lark-cli event subscribe` 通过同样的长连接接收事件，`lark-cli im +messages-reply` 回复消息。适合脚本化；larkctl 则是基于 Node SDK、带白名单的专用守护进程。
- **[lark-forward](https://github.com/violin0847/lark-forward)** —— 一个 bash 脚本，用 lark-cli 事件订阅把飞书消息粘贴到运行编程 Agent 的 tmux pane 中，Agent 再通过 lark-cli 回复（[介绍文章](https://juejin.cn/post/7649611053488668712)）。启发了「手机 → Agent」的工作流；larkctl 改用非交互模式驱动 Agent，不依赖 tmux，并支持 Windows。
- 同类项目：[botmux](https://github.com/deepcoldy/botmux)、[codelark](https://github.com/huiyeruzhou/codelark)、[claude-lark-plugin](https://github.com/IS908/claude-lark-plugin)。
- 飞书文档：[接收消息事件 `im.message.receive_v1`](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)、[Node SDK `@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk)（`WSClient` + `EventDispatcher`）。

## 开发

```bash
npm ci && npm run lint && npm run typecheck && npm test
npm run build && node dist/cli.js start --mock
```

CI 在 Ubuntu、macOS、Windows 上运行 lint、类型检查、单元测试和 `--mock` 冒烟测试。

## 许可证

[MIT](LICENSE) © hucheng91
