import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { expandHome } from './config.js';
import { isAllowed, isDangerous, readOnlyAllows, genCode } from './security.js';
import { stripMentions, parseCommand, truncate, stripAnsi, naturalIntent, findImagePaths } from './text.js';
import { runProcess, runShell, type Job } from './runner.js';
import type { Transport, Card, CardButton } from './transport.js';
import { codeBlock } from './transport.js';
import type { AgentRegistry } from './agents/registry.js';
import type { AgentEvent } from './agents/types.js';
import { AuditLog } from './audit.js';

export interface IncomingMessage {
  messageId: string;
  chatId: string;
  chatType: string; // 'p2p' | 'group'
  senderOpenId: string;
  text: string;
  /** Feishu thread (话题) id; each thread has its own session/cwd/agent/job. */
  threadId?: string;
  /** Image keys (image message or images inside a post). */
  imageKeys?: string[];
  /** file_key of a voice message. */
  audioKey?: string;
}

/** Card button click (card.action.trigger). */
export interface CardAction {
  operatorOpenId: string;
  chatId?: string;
  messageId: string; // the card's message id
  value: Record<string, unknown>;
}

/** Inbound media access (Feishu im.messageResource + ASR). */
export interface Media {
  download(messageId: string, key: string, type: 'image' | 'file'): Promise<Buffer>;
  /** Audio (Feishu opus) -> text. Throws an Error with a user-facing message if unavailable. */
  transcribe(audio: Buffer): Promise<string>;
}

interface ChatState { cwd: string; agent: string; sessions: Record<string, string>; pendingImages?: string[]; choices?: string[] }
interface Pending { code: string; cmd: string; user: string; expires: number }
interface RunningJob { job: Job; kind: string; label: string; started: number }

export interface BotDeps {
  config: Config;
  transport: Transport;
  agents: AgentRegistry;
  audit?: AuditLog;
  statePath?: string | null;
  screenshot?: () => Promise<Buffer>;
  media?: Media;
  now?: () => number;
}

export const HELP = `**larkctl** — remote coding from Feishu/Lark
**Agent (default)** — any plain message (text, voice 🎤, or image 🖼) goes to the current coding agent in the current project; the session continues automatically.
**Threads 话题** — every Feishu thread has its own agent, project, session and running job; several threads can work in parallel.
• \`/menu\` quick-select buttons (also: help / 菜单)
• \`/agent [name]\` show / switch agent (\`/agents\` to list)
• \`/new\` start a fresh agent session
• \`/cwd <project|path>\` switch project dir (\`/projects\` to list)
**Shell**
• \`/sh <cmd>\` or \`!<cmd>\` run in shell · \`/cd <dir>\` · \`/pwd\`
**Control**
• \`/status\` · \`/stop\` kill this thread's job · \`/screenshot\` (or 截图 / 做得怎么样) · \`/whoami\` · \`/help\`
Dangerous commands require \`confirm <code>\`.`;

const IMG_RE = /\.(png|jpe?g|gif|webp)$/i;

export const NUMBER_HINT = '按钮点了没反应？（如飞书个人版不支持卡片回调）直接回复数字即可 · Buttons not responding? Reply with a number.';

export class Bot {
  private state = new Map<string, ChatState>();
  private pending = new Map<string, Pending>();
  private jobs = new Map<string, RunningJob>();
  private audit: AuditLog;
  private now: () => number;

  constructor(private d: BotDeps) {
    this.audit = d.audit ?? new AuditLog(null);
    this.now = d.now ?? Date.now;
    if (d.statePath && fs.existsSync(d.statePath)) {
      try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(d.statePath, 'utf8')))) this.state.set(k, v as ChatState); } catch { /* ignore */ }
    }
  }

  /** Scope = chat, or chat + thread. */
  static scope(m: Pick<IncomingMessage, 'chatId' | 'threadId'>) { return m.threadId ? `${m.chatId}#${m.threadId}` : m.chatId; }

  private st(m: IncomingMessage): ChatState {
    const key = Bot.scope(m);
    let s = this.state.get(key);
    if (!s) {
      const parent = m.threadId ? this.state.get(m.chatId) : undefined;
      s = { cwd: parent?.cwd ?? expandHome(this.d.config.defaultCwd), agent: parent?.agent ?? this.d.config.defaultAgent, sessions: {} };
      this.state.set(key, s);
      if (m.threadId) this.save();
    }
    return s;
  }
  private save() {
    if (!this.d.statePath) return;
    try { fs.mkdirSync(path.dirname(this.d.statePath), { recursive: true }); fs.writeFileSync(this.d.statePath, JSON.stringify(Object.fromEntries(this.state), null, 2)); } catch { /* ignore */ }
  }

  private opts(m: IncomingMessage) { return { thread: !!m.threadId }; }

  private card(m: IncomingMessage, title: string, body: string, color: Card['color'] = 'blue', buttons?: CardButton[][]) {
    if (buttons?.length) {
      // Fallback when card button callbacks fail: numbered options, reply with a bare digit to select.
      const flat = buttons.flat();
      const s = this.st(m);
      s.choices = flat.map((b) => b.cmd);
      this.save();
      body += `\n\n${flat.map((b, i) => `${i + 1}. ${b.text} — \`${b.cmd}\``).join('\n')}\n<font color='grey'>${NUMBER_HINT}</font>`;
    }
    return this.d.transport.replyCard(m.messageId, { title, body, color, buttons, actionContext: buttons ? this.ctx(m) : undefined }, this.opts(m));
  }
  private ctx(m: IncomingMessage): Record<string, string> {
    return { chat: m.chatId, ct: m.chatType, ...(m.threadId ? { thread: m.threadId } : {}) };
  }

  private menuButtons(s: ChatState): CardButton[][] {
    const rows: CardButton[][] = [];
    rows.push(this.d.agents.list().slice(0, 6).map((a) => ({ text: `${a.name === s.agent ? '✓ ' : ''}${a.name}`, cmd: `/agent ${a.name}`, type: a.name === s.agent ? 'primary' : 'default' })));
    const projects = Object.entries(this.d.config.projects).slice(0, 12);
    for (let i = 0; i < projects.length; i += 3) rows.push(projects.slice(i, i + 3).map(([k, v]) => ({ text: `${v === s.cwd ? '✓ ' : ''}📁 ${k}`, cmd: `/cwd ${k}`, type: v === s.cwd ? 'primary' : 'default' })));
    rows.push([{ text: '🆕 新会话 New', cmd: '/new' }, { text: '⏹ 停止 Stop', cmd: '/stop', type: 'danger' }]);
    rows.push([{ text: '📸 截图 Screenshot', cmd: '/screenshot' }, { text: '📊 状态 Status', cmd: '/status' }]);
    return rows;
  }

  private statusText(m: IncomingMessage, s: ChatState) {
    const j = this.jobs.get(Bot.scope(m));
    return [
      `agent: **${s.agent}** · session: ${s.sessions[s.agent] ?? '(new)'}`,
      `cwd: \`${s.cwd}\``,
      m.threadId ? `thread: \`${m.threadId}\`` : 'thread: (chat)',
      `read-only: ${this.d.config.readOnly}`,
      j ? `running: ${j.kind} \`${j.label.slice(0, 80)}\` for ${Math.round((this.now() - j.started) / 1000)}s` : 'running: nothing',
      s.pendingImages?.length ? `pending images: ${s.pendingImages.length}` : '',
    ].filter(Boolean).join('\n');
  }

  private async menu(m: IncomingMessage, s: ChatState, title = '菜单 Menu', extra = '') {
    await this.card(m, title, `${extra}${this.statusText(m, s)}\n\n点按钮快速操作 · tap a button`, 'blue', this.menuButtons(s));
  }

  private async shot(m: IncomingMessage) {
    if (!this.d.screenshot) { await this.card(m, 'Screenshot', 'Not available.', 'red'); return; }
    try { await this.d.transport.replyImage(m.messageId, await this.d.screenshot(), this.opts(m)); }
    catch (e) { await this.card(m, 'Screenshot failed', String((e as Error).message), 'red'); }
  }

  /** Card button click. Returns the callback response (toast). Long work continues in background. */
  async handleAction(a: CardAction): Promise<Record<string, unknown>> {
    const v = a.value ?? {};
    const cmd = typeof v.cmd === 'string' ? v.cmd : '';
    if (!cmd) return {};
    const m: IncomingMessage = {
      messageId: a.messageId,
      chatId: String(v.chat ?? a.chatId ?? ''),
      chatType: String(v.ct ?? 'p2p'),
      senderOpenId: a.operatorOpenId,
      threadId: typeof v.thread === 'string' && v.thread ? v.thread : undefined,
      text: cmd,
    };
    if (!isAllowed(this.d.config, { openId: m.senderOpenId, chatId: m.chatId, chatType: m.chatType })) {
      this.audit.write({ event: 'denied_action', user: m.senderOpenId, chat: m.chatId, cmd });
      return { toast: { type: 'error', content: 'Not authorized' } };
    }
    const p = this.handle(m);
    const done = await Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    if (!done) p.catch(() => undefined);
    return { toast: { type: 'info', content: `▶ ${cmd}` } };
  }

  /** Main entry. Resolves when the command has been handled (agent/shell jobs run to completion). */
  async handle(m: IncomingMessage): Promise<void> {
    const allowed = isAllowed(this.d.config, { openId: m.senderOpenId, chatId: m.chatId, chatType: m.chatType });
    if (!allowed) {
      if (parseCommand(m.text).cmd === 'whoami') { await this.whoami(m, false); return; }
      this.audit.write({ event: 'denied', user: m.senderOpenId, chat: m.chatId, text: m.text.slice(0, 200) });
      if (this.d.config.replyToStrangers) await this.d.transport.replyText(m.messageId, '⛔ Not authorized. Send /whoami and ask the owner to add your open_id.', this.opts(m));
      return;
    }
    const s = this.st(m);
    // voice -> text
    if (m.audioKey) {
      const text = await this.transcribe(m);
      if (text === null) return;
      m = { ...m, text };
    }
    // images -> files in the project
    let images: string[] = [];
    if (m.imageKeys?.length) {
      images = await this.saveImages(m, s);
      if (!m.text.trim()) {
        s.pendingImages = [...(s.pendingImages ?? []), ...images];
        this.save();
        if (images.length) await this.card(m, '🖼 已收到图片 Image received', `${images.map((f) => `\`${f}\``).join('\n')}\n\n发送文字说明，图片会一起交给 **${s.agent}**。\nSend your instructions next; the image(s) will be attached.`, 'grey');
        return;
      }
    }
    m = { ...m, text: stripMentions(m.text) };
    const pick = /^\s*(\d{1,2})\s*$/.exec(m.text);
    if (pick && s.choices?.[Number(pick[1]) - 1]) m = { ...m, text: s.choices[Number(pick[1]) - 1] };
    const { cmd, arg } = parseCommand(m.text);
    if (cmd === 'whoami') { await this.whoami(m, true); return; }
    this.audit.write({ event: 'command', user: m.senderOpenId, chat: m.chatId, thread: m.threadId ?? null, cmd: cmd ?? 'agent', arg: arg.slice(0, 500) });
    if (cmd === null && !images.length) {
      const intent = naturalIntent(arg);
      if (intent === 'menu') { await this.menu(m, s, 'Help', `${HELP}\n\n---\n`); return; }
      if (intent === 'screenshot') { await this.shot(m); return; }
      if (intent === 'progress') { await this.card(m, 'Status', this.statusText(m, s), 'grey', this.menuButtons(s)); await this.shot(m); return; }
    }
    switch (cmd) {
      case 'help': case 'start': await this.menu(m, s, 'Help', `${HELP}\n\n---\n`); return;
      case 'menu': case 'm': await this.menu(m, s); return;
      case 'pwd': await this.card(m, 'pwd', `\`${s.cwd}\``, 'grey'); return;
      case 'cd': case 'cwd': case 'project': await this.cd(m, s, arg); return;
      case 'projects': {
        const p = Object.entries(this.d.config.projects);
        await this.card(m, 'Projects', p.length ? p.map(([k, v]) => `• **${k}** → \`${v}\``).join('\n') : 'No projects configured. Add `projects` in config.json.', 'grey', p.length ? this.menuButtons(s).slice(1, -2) : undefined);
        return;
      }
      case 'agents': await this.card(m, 'Agents', this.d.agents.list().map((a) => `• **${a.name}**${a.name === s.agent ? ' (current)' : ''} — ${a.description ?? ''}`).join('\n') + (this.d.agents.errors.length ? `\n\nPlugin errors:\n${this.d.agents.errors.join('\n')}` : ''), 'grey', [this.menuButtons(s)[0]]); return;
      case 'agent': {
        if (!arg) { await this.card(m, 'Agent', `current: **${s.agent}**\nsession: ${s.sessions[s.agent] ?? '(new)'}\navailable: ${this.d.agents.list().map((a) => a.name).join(', ')}`, 'grey', [this.menuButtons(s)[0]]); return; }
        const [name, ...rest] = arg.split(/\s+/);
        if (!this.d.agents.get(name)) { await this.card(m, 'Agent', `Unknown agent \`${name}\`. Available: ${this.d.agents.list().map((a) => a.name).join(', ')}`, 'red'); return; }
        s.agent = name; this.save();
        if (rest.length) { await this.runAgent(m, s, rest.join(' ')); return; }
        await this.card(m, 'Agent', `Switched to **${name}**.`, 'green');
        return;
      }
      case 'new': case 'reset':
        delete s.sessions[s.agent]; this.save();
        if (arg) { await this.runAgent(m, s, arg); return; }
        await this.card(m, 'New session', `Next message starts a fresh **${s.agent}** session in \`${s.cwd}\`.`, 'green');
        return;
      case 'status': await this.card(m, 'Status', this.statusText(m, s), 'grey', this.menuButtons(s)); return;
      case 'stop': case 'cancel': {
        const key = Bot.scope(m);
        const j = this.jobs.get(key);
        if (!j) { await this.card(m, 'Stop', 'Nothing is running.', 'grey'); return; }
        j.job.stop();
        this.audit.write({ event: 'stop', chat: key, label: j.label });
        await this.card(m, 'Stop', `Stopping ${j.kind}…`, 'orange');
        return;
      }
      case 'screenshot': case 'ss': await this.shot(m); return;
      case 'confirm': {
        const key = Bot.scope(m);
        const p = this.pending.get(key);
        if (!p || p.code !== arg || p.user !== m.senderOpenId || p.expires < this.now()) { await this.card(m, 'Confirm', 'No matching pending command (expired or wrong code).', 'red'); return; }
        this.pending.delete(key);
        this.audit.write({ event: 'confirmed', user: m.senderOpenId, cmd: p.cmd });
        await this.runSh(m, s, p.cmd);
        return;
      }
      case 'sh': case 'shell': case 'run': await this.sh(m, s, arg); return;
      case null: await this.runAgent(m, s, arg, images); return;
      default: await this.card(m, 'Unknown command', `\`/${cmd}\` — tap a button or send /help`, 'red', this.menuButtons(s));
    }
  }

  private async whoami(m: IncomingMessage, allowed: boolean) {
    this.audit.write({ event: 'whoami', user: m.senderOpenId, chat: m.chatId, allowed });
    await this.card(m, 'whoami', `open_id: \`${m.senderOpenId}\`\nchat_id: \`${m.chatId}\`\nchat_type: ${m.chatType}${m.threadId ? `\nthread_id: \`${m.threadId}\`` : ''}\nallowed: **${allowed}**`, 'grey');
  }

  private async transcribe(m: IncomingMessage): Promise<string | null> {
    if (!this.d.media) { await this.card(m, '🎤 Voice', 'Voice messages are not supported in this mode. Please type instead.', 'orange'); return null; }
    try {
      const audio = await this.d.media.download(m.messageId, m.audioKey!, 'file');
      const text = (await this.d.media.transcribe(audio)).trim();
      if (!text) throw new Error('识别结果为空 (empty transcription)');
      this.audit.write({ event: 'voice', chat: m.chatId, text: text.slice(0, 200) });
      await this.d.transport.replyText(m.messageId, `🎤 ${text}`, this.opts(m));
      return text;
    } catch (e) {
      await this.card(m, '🎤 语音识别失败 Voice not transcribed', `${(e as Error).message}\n\n请改用文字发送。Please type the message instead.`, 'orange');
      return null;
    }
  }

  private async saveImages(m: IncomingMessage, s: ChatState): Promise<string[]> {
    if (!this.d.media) return [];
    const dir = path.join(s.cwd, '.larkctl', 'inbox');
    const out: string[] = [];
    for (const [i, key] of (m.imageKeys ?? []).entries()) {
      try {
        const buf = await this.d.media.download(m.messageId, key, 'image');
        fs.mkdirSync(dir, { recursive: true });
        const ext = buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : buf[0] === 0x47 ? 'gif' : buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : 'png';
        const f = path.join(dir, `${m.messageId.replace(/[^\w-]/g, '')}-${i}.${ext}`);
        fs.writeFileSync(f, buf);
        out.push(f);
      } catch (e) {
        await this.card(m, '🖼 Image download failed', String((e as Error).message), 'red');
      }
    }
    this.audit.write({ event: 'images', chat: m.chatId, files: out });
    return out;
  }

  private async cd(m: IncomingMessage, s: ChatState, arg: string) {
    if (!arg) { await this.card(m, 'cwd', `\`${s.cwd}\``, 'grey'); return; }
    const target = this.d.config.projects[arg] ?? path.resolve(s.cwd, expandHome(arg));
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) { await this.card(m, 'cd', `Not a directory: \`${target}\``, 'red'); return; }
    if (s.cwd !== target) { s.cwd = target; s.sessions = {}; }
    this.save();
    await this.card(m, 'cwd', `\`${target}\`${this.d.config.projects[arg] ? ` (project **${arg}**)` : ''}`, 'green');
  }

  private async sh(m: IncomingMessage, s: ChatState, cmdline: string) {
    if (!cmdline) { await this.card(m, 'Shell', 'Usage: `/sh <command>`', 'grey'); return; }
    if (this.d.config.readOnly && !readOnlyAllows(cmdline)) {
      this.audit.write({ event: 'readonly_block', cmd: cmdline });
      await this.card(m, 'Read-only mode', `Blocked: \`${cmdline}\``, 'red');
      return;
    }
    const danger = isDangerous(cmdline, this.d.config.extraDangerousPatterns);
    if (danger) {
      const code = genCode();
      this.pending.set(Bot.scope(m), { code, cmd: cmdline, user: m.senderOpenId, expires: this.now() + 120_000 });
      this.audit.write({ event: 'dangerous_pending', cmd: cmdline, pattern: danger });
      await this.card(m, '⚠️ Dangerous command', `${codeBlock(cmdline)}\nmatched \`${danger}\`\nReply **confirm ${code}** within 2 minutes to run it.`, 'orange');
      return;
    }
    await this.runSh(m, s, cmdline);
  }

  private busy(m: IncomingMessage) {
    const j = this.jobs.get(Bot.scope(m));
    if (j) { void this.card(m, 'Busy', `A ${j.kind} job is running (\`${j.label.slice(0, 60)}\`). Send /stop first${m.threadId ? '' : ', or start a new thread (话题) to run in parallel'}.`, 'orange', [[{ text: '⏹ 停止 Stop', cmd: '/stop', type: 'danger' }, { text: '📸 截图', cmd: '/screenshot' }]]); return true; }
    return false;
  }

  private async runSh(m: IncomingMessage, s: ChatState, cmdline: string) {
    if (this.busy(m)) return;
    const key = Bot.scope(m);
    const job = runShell(cmdline, s.cwd, this.d.config.commandTimeoutSec * 1000);
    this.jobs.set(key, { job, kind: 'shell', label: cmdline, started: this.now() });
    try {
      const r = await job.done;
      const out = stripAnsi(r.output).trimEnd();
      const status = r.timedOut ? `⏱ timed out after ${this.d.config.commandTimeoutSec}s` : r.killed ? '⏹ stopped' : `exit ${r.code}`;
      this.audit.write({ event: 'shell_done', cmd: cmdline, code: r.code, timedOut: r.timedOut, ms: r.durationMs });
      await this.sendOutput(m, `$ ${cmdline.slice(0, 60)}`, out || '(no output)', status, r.code === 0 ? 'green' : 'red', 'output.txt', true);
    } finally { this.jobs.delete(key); }
  }

  private async sendOutput(m: IncomingMessage, title: string, out: string, status: string, color: Card['color'], fileName: string, asCode: boolean, updateId?: string) {
    const { text, truncated } = truncate(out, this.d.config.maxReplyChars);
    const body = `${asCode ? codeBlock(text) : text}\n\n_${status}${truncated ? ` · ${out.length} chars, full output attached` : ''}_`;
    if (updateId) await this.d.transport.updateCard(updateId, { title, body, color });
    else await this.card(m, title, body, color);
    if (truncated) await this.d.transport.replyFile(m.messageId, fileName, Buffer.from(out, 'utf8'), this.opts(m));
  }

  private async runAgent(m: IncomingMessage, s: ChatState, prompt: string, images: string[] = []) {
    if (!prompt) { await this.card(m, 'Agent', 'Empty prompt.', 'grey'); return; }
    if (this.d.config.readOnly) { await this.card(m, 'Read-only mode', 'Agent mode is disabled in read-only mode.', 'red'); return; }
    const adapter = this.d.agents.get(s.agent);
    if (!adapter) { await this.card(m, 'Agent', `Unknown agent \`${s.agent}\``, 'red'); return; }
    if (this.busy(m)) return;
    const key = Bot.scope(m);
    const attached = [...(s.pendingImages ?? []), ...images].filter((f) => fs.existsSync(f));
    if (s.pendingImages?.length) { delete s.pendingImages; this.save(); }
    const fullPrompt = attached.length ? `${prompt}\n\n[Attached image files from the user: ${attached.join(', ')}]` : prompt;
    const sessionId = s.sessions[adapter.name];
    const inv = adapter.buildInvocation({ prompt: fullPrompt, cwd: s.cwd, sessionId, extraArgs: this.d.config.agentArgs[adapter.name], images: attached, access: this.d.config.readOnly ? 'read-only' : (this.d.config.agentAccess ?? 'workspace-write') });
    const title = `🤖 ${adapter.name} · ${path.basename(s.cwd) || s.cwd}`;
    const cardId = await this.card(m, title, `⏳ working…${sessionId ? ' (continuing session)' : ''}${attached.length ? ` · 🖼 ${attached.length}` : ''}`, 'blue');
    const progress: string[] = [];
    const texts: string[] = [];
    const errors: string[] = [];
    let buf = '';
    let dirty = false;
    const onEvent = (e: AgentEvent) => {
      dirty = true;
      if (e.type === 'session') { s.sessions[adapter.name] = e.id; }
      else if (e.type === 'text') texts.push(e.text);
      else if (e.type === 'progress') progress.push(e.text);
      else errors.push(e.text);
    };
    const parse = adapter.parseLine ?? ((l: string) => (l.trim() ? [{ type: 'text', text: l } as AgentEvent] : []));
    const feed = (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); for (const e of parse(stripAnsi(line))) onEvent(e); }
    };
    const job = runProcess({ command: inv.command, args: inv.args, env: inv.env, stdin: inv.stdin, cwd: s.cwd, timeoutMs: this.d.config.agentTimeoutSec * 1000, onData: feed });
    const started = this.now();
    this.jobs.set(key, { job, kind: `agent:${adapter.name}`, label: prompt, started });
    this.audit.write({ event: 'agent_start', agent: adapter.name, cwd: s.cwd, thread: m.threadId ?? null, session: sessionId ?? null, command: inv.command, args: inv.args.filter((a) => a !== fullPrompt) });
    const render = () => {
      const last = progress.slice(-8).map((p) => `• ${p}`).join('\n');
      const latest = texts.length ? `\n\n${truncate(texts[texts.length - 1], 1200).text}` : '';
      return `⏳ ${Math.round((this.now() - started) / 1000)}s\n${last}${latest}`;
    };
    const timer = cardId ? setInterval(() => { if (dirty) { dirty = false; void this.d.transport.updateCard(cardId, { title, body: render(), color: 'blue' }).catch(() => undefined); } }, this.d.config.progressIntervalSec * 1000) : null;
    try {
      const r = await job.done;
      if (buf) { for (const e of parse(stripAnsi(buf))) onEvent(e); buf = ''; }
      // a failed run that produced nothing shouldn't be resumed next time (e.g. auth failure)
      if (r.code !== 0 && !texts.length && errors.length) { if (sessionId) s.sessions[adapter.name] = sessionId; else delete s.sessions[adapter.name]; }
      this.save();
      let answer = texts.join('\n\n').trim();
      if (!answer && adapter.finalize) answer = adapter.finalize(r.output);
      const uniqErrors = [...new Set(errors)];
      if (!answer && uniqErrors.length) answer = `**Error:**\n${uniqErrors.join('\n')}`;
      else if (uniqErrors.length) answer += `\n\n**Errors:**\n${uniqErrors.join('\n')}`;
      if (!answer) answer = stripAnsi(r.output).trim().slice(-this.d.config.maxReplyChars) || '(no output)';
      const status = r.timedOut ? `⏱ timed out after ${this.d.config.agentTimeoutSec}s` : r.killed ? '⏹ stopped' : `${r.code === 0 ? '✅ done' : `❌ exit ${r.code}`} in ${Math.round(r.durationMs / 1000)}s · ${progress.length} steps`;
      this.audit.write({ event: 'agent_done', agent: adapter.name, code: r.code, timedOut: r.timedOut, ms: r.durationMs, session: s.sessions[adapter.name] ?? null });
      await this.sendOutput(m, title, answer, status, r.code === 0 && !r.killed && !r.timedOut ? 'green' : 'red', 'agent-output.md', false, cardId);
      if (this.d.config.sendAgentImages) await this.sendProducedImages(m, s.cwd, texts.join('\n'), started, attached);
    } finally {
      if (timer) clearInterval(timer);
      this.jobs.delete(key);
    }
  }

  /** Send back (up to 3) image files the agent mentions that were created/modified during the run. */
  private async sendProducedImages(m: IncomingMessage, cwd: string, text: string, started: number, exclude: string[]) {
    let sent = 0;
    for (const p of findImagePaths(text)) {
      if (sent >= 3) break;
      const f = path.resolve(cwd, expandHome(p));
      if (exclude.includes(f) || !IMG_RE.test(f)) continue;
      try {
        const st = fs.statSync(f);
        if (!st.isFile() || st.size > 10_000_000 || st.mtimeMs < started - 2000) continue;
        await this.d.transport.replyImage(m.messageId, fs.readFileSync(f), this.opts(m));
        sent++;
      } catch { /* missing or upload failed */ }
    }
  }
}
