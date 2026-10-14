import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { expandHome } from './config.js';
import { isAllowed, isDangerous, readOnlyAllows, genCode } from './security.js';
import { parseCommand, truncate, stripAnsi } from './text.js';
import { runProcess, runShell, type Job } from './runner.js';
import type { Transport, Card } from './transport.js';
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
}

interface ChatState { cwd: string; agent: string; sessions: Record<string, string> }
interface Pending { code: string; cmd: string; user: string; expires: number }
interface RunningJob { job: Job; kind: string; label: string; started: number }

export interface BotDeps {
  config: Config;
  transport: Transport;
  agents: AgentRegistry;
  audit?: AuditLog;
  statePath?: string | null;
  screenshot?: () => Promise<Buffer>;
  now?: () => number;
}

export const HELP = `**larkctl** — remote coding from Feishu/Lark
**Agent (default)** — any plain message is sent to the current coding agent in the current project; the session is continued automatically.
• \`/agent [name]\` show / switch agent (\`/agents\` to list)
• \`/new\` start a fresh agent session
• \`/cwd <project|path>\` switch project dir (\`/projects\` to list)
**Shell**
• \`/sh <cmd>\` or \`!<cmd>\` run in shell · \`/cd <dir>\` · \`/pwd\`
**Control**
• \`/status\` · \`/stop\` kill running job · \`/screenshot\` · \`/whoami\` · \`/help\`
Dangerous commands require \`confirm <code>\`.`;

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

  private st(chatId: string): ChatState {
    let s = this.state.get(chatId);
    if (!s) { s = { cwd: expandHome(this.d.config.defaultCwd), agent: this.d.config.defaultAgent, sessions: {} }; this.state.set(chatId, s); }
    return s;
  }
  private save() {
    if (!this.d.statePath) return;
    try { fs.mkdirSync(path.dirname(this.d.statePath), { recursive: true }); fs.writeFileSync(this.d.statePath, JSON.stringify(Object.fromEntries(this.state), null, 2)); } catch { /* ignore */ }
  }

  private card(m: IncomingMessage, title: string, body: string, color: Card['color'] = 'blue') {
    return this.d.transport.replyCard(m.messageId, { title, body, color });
  }

  /** Main entry. Resolves when the command has been handled (agent/shell jobs run to completion). */
  async handle(m: IncomingMessage): Promise<void> {
    const { cmd, arg } = parseCommand(m.text);
    const allowed = isAllowed(this.d.config, { openId: m.senderOpenId, chatId: m.chatId, chatType: m.chatType });
    if (cmd === 'whoami') {
      this.audit.write({ event: 'whoami', user: m.senderOpenId, chat: m.chatId, allowed });
      await this.card(m, 'whoami', `open_id: \`${m.senderOpenId}\`\nchat_id: \`${m.chatId}\`\nchat_type: ${m.chatType}\nallowed: **${allowed}**`, 'grey');
      return;
    }
    if (!allowed) {
      this.audit.write({ event: 'denied', user: m.senderOpenId, chat: m.chatId, text: m.text.slice(0, 200) });
      if (this.d.config.replyToStrangers) await this.d.transport.replyText(m.messageId, '⛔ Not authorized. Send /whoami and ask the owner to add your open_id.');
      return;
    }
    this.audit.write({ event: 'command', user: m.senderOpenId, chat: m.chatId, cmd: cmd ?? 'agent', arg: arg.slice(0, 500) });
    const s = this.st(m.chatId);
    switch (cmd) {
      case 'help': case 'start': await this.card(m, 'Help', HELP); return;
      case 'pwd': await this.card(m, 'pwd', `\`${s.cwd}\``, 'grey'); return;
      case 'cd': case 'cwd': case 'project': await this.cd(m, s, arg); return;
      case 'projects': {
        const p = Object.entries(this.d.config.projects);
        await this.card(m, 'Projects', p.length ? p.map(([k, v]) => `• **${k}** → \`${v}\``).join('\n') : 'No projects configured. Add `projects` in config.json.', 'grey');
        return;
      }
      case 'agents': await this.card(m, 'Agents', this.d.agents.list().map((a) => `• **${a.name}**${a.name === s.agent ? ' (current)' : ''} — ${a.description ?? ''}`).join('\n') + (this.d.agents.errors.length ? `\n\nPlugin errors:\n${this.d.agents.errors.join('\n')}` : ''), 'grey'); return;
      case 'agent': {
        if (!arg) { await this.card(m, 'Agent', `current: **${s.agent}**\nsession: ${s.sessions[s.agent] ?? '(new)'}\navailable: ${this.d.agents.list().map((a) => a.name).join(', ')}`, 'grey'); return; }
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
      case 'status': {
        const j = this.jobs.get(m.chatId);
        await this.card(m, 'Status', [
          `agent: **${s.agent}** · session: ${s.sessions[s.agent] ?? '(new)'}`,
          `cwd: \`${s.cwd}\``,
          `read-only: ${this.d.config.readOnly}`,
          j ? `running: ${j.kind} \`${j.label.slice(0, 80)}\` for ${Math.round((this.now() - j.started) / 1000)}s` : 'running: nothing',
        ].join('\n'), 'grey');
        return;
      }
      case 'stop': case 'cancel': {
        const j = this.jobs.get(m.chatId);
        if (!j) { await this.card(m, 'Stop', 'Nothing is running.', 'grey'); return; }
        j.job.stop();
        this.audit.write({ event: 'stop', chat: m.chatId, label: j.label });
        await this.card(m, 'Stop', `Stopping ${j.kind}…`, 'orange');
        return;
      }
      case 'screenshot': case 'ss': {
        if (!this.d.screenshot) { await this.card(m, 'Screenshot', 'Not available.', 'red'); return; }
        try { await this.d.transport.replyImage(m.messageId, await this.d.screenshot()); }
        catch (e) { await this.card(m, 'Screenshot failed', String((e as Error).message), 'red'); }
        return;
      }
      case 'confirm': {
        const p = this.pending.get(m.chatId);
        if (!p || p.code !== arg || p.user !== m.senderOpenId || p.expires < this.now()) { await this.card(m, 'Confirm', 'No matching pending command (expired or wrong code).', 'red'); return; }
        this.pending.delete(m.chatId);
        this.audit.write({ event: 'confirmed', user: m.senderOpenId, cmd: p.cmd });
        await this.runSh(m, s, p.cmd);
        return;
      }
      case 'sh': case 'shell': case 'run': await this.sh(m, s, arg); return;
      case null: await this.runAgent(m, s, arg); return;
      default: await this.card(m, 'Unknown command', `\`/${cmd}\` — send /help`, 'red');
    }
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
      this.pending.set(m.chatId, { code, cmd: cmdline, user: m.senderOpenId, expires: this.now() + 120_000 });
      this.audit.write({ event: 'dangerous_pending', cmd: cmdline, pattern: danger });
      await this.card(m, '⚠️ Dangerous command', `${codeBlock(cmdline)}\nmatched \`${danger}\`\nReply **confirm ${code}** within 2 minutes to run it.`, 'orange');
      return;
    }
    await this.runSh(m, s, cmdline);
  }

  private busy(m: IncomingMessage) {
    const j = this.jobs.get(m.chatId);
    if (j) { void this.card(m, 'Busy', `A ${j.kind} job is running (\`${j.label.slice(0, 60)}\`). Send /stop first.`, 'orange'); return true; }
    return false;
  }

  private async runSh(m: IncomingMessage, s: ChatState, cmdline: string) {
    if (this.busy(m)) return;
    const job = runShell(cmdline, s.cwd, this.d.config.commandTimeoutSec * 1000);
    this.jobs.set(m.chatId, { job, kind: 'shell', label: cmdline, started: this.now() });
    try {
      const r = await job.done;
      const out = stripAnsi(r.output).trimEnd();
      const status = r.timedOut ? `⏱ timed out after ${this.d.config.commandTimeoutSec}s` : r.killed ? '⏹ stopped' : `exit ${r.code}`;
      this.audit.write({ event: 'shell_done', cmd: cmdline, code: r.code, timedOut: r.timedOut, ms: r.durationMs });
      await this.sendOutput(m, `$ ${cmdline.slice(0, 60)}`, out || '(no output)', status, r.code === 0 ? 'green' : 'red', 'output.txt', true);
    } finally { this.jobs.delete(m.chatId); }
  }

  private async sendOutput(m: IncomingMessage, title: string, out: string, status: string, color: Card['color'], fileName: string, asCode: boolean, updateId?: string) {
    const { text, truncated } = truncate(out, this.d.config.maxReplyChars);
    const body = `${asCode ? codeBlock(text) : text}\n\n_${status}${truncated ? ` · ${out.length} chars, full output attached` : ''}_`;
    if (updateId) await this.d.transport.updateCard(updateId, { title, body, color });
    else await this.card(m, title, body, color);
    if (truncated) await this.d.transport.replyFile(m.messageId, fileName, Buffer.from(out, 'utf8'));
  }

  private async runAgent(m: IncomingMessage, s: ChatState, prompt: string) {
    if (!prompt) { await this.card(m, 'Agent', 'Empty prompt.', 'grey'); return; }
    if (this.d.config.readOnly) { await this.card(m, 'Read-only mode', 'Agent mode is disabled in read-only mode.', 'red'); return; }
    const adapter = this.d.agents.get(s.agent);
    if (!adapter) { await this.card(m, 'Agent', `Unknown agent \`${s.agent}\``, 'red'); return; }
    if (this.busy(m)) return;
    const sessionId = s.sessions[adapter.name];
    const inv = adapter.buildInvocation({ prompt, cwd: s.cwd, sessionId, extraArgs: this.d.config.agentArgs[adapter.name] });
    const title = `🤖 ${adapter.name} · ${path.basename(s.cwd) || s.cwd}`;
    const cardId = await this.card(m, title, `⏳ working…${sessionId ? ' (continuing session)' : ''}`, 'blue');
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
    this.jobs.set(m.chatId, { job, kind: `agent:${adapter.name}`, label: prompt, started });
    this.audit.write({ event: 'agent_start', agent: adapter.name, cwd: s.cwd, session: sessionId ?? null, command: inv.command, args: inv.args.filter((a) => a !== prompt) });
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
    } finally {
      if (timer) clearInterval(timer);
      this.jobs.delete(m.chatId);
    }
  }
}
