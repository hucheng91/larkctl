import type { AgentAdapter, AgentEvent } from './types.js';
import type { CustomAgentConfig } from '../config.js';

function json(line: string): Record<string, any> | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try { return JSON.parse(t); } catch { return null; }
}

const short = (s: unknown, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

const CODEX_AUTH_HINT = ' — codex is not logged in on this machine; run `codex login --device-auth` (or `codex login --with-api-key`).';
const CLAUDE_AUTH_HINT = ' — run `claude` then /login on this machine, or set ANTHROPIC_API_KEY.';

/**
 * OpenAI Codex CLI: `codex exec --json` (JSONL events), resume with
 * `codex exec resume <SESSION_ID> <prompt>`.
 */
export const codexAdapter: AgentAdapter = {
  name: 'codex',
  description: 'OpenAI Codex CLI (codex exec)',
  buildInvocation({ prompt, cwd, sessionId, extraArgs = [] }) {
    const common = ['--json', '--skip-git-repo-check', ...extraArgs];
    const args = sessionId
      ? ['exec', 'resume', ...common, sessionId, '-']
      : ['exec', ...common, '--cd', cwd, '-'];
    return { command: 'codex', args, stdin: prompt };
  },
  parseLine(line) {
    const o = json(line);
    if (!o) return line.trim() ? [{ type: 'progress', text: short(line) }] : [];
    const ev: AgentEvent[] = [];
    if (o.type === 'thread.started' && o.thread_id) ev.push({ type: 'session', id: o.thread_id });
    const item = o.item;
    if (o.type === 'item.completed' && item) {
      if (item.type === 'agent_message' && item.text) ev.push({ type: 'text', text: item.text });
      else if (item.type === 'command_execution') ev.push({ type: 'progress', text: `$ ${short(item.command)} → ${item.exit_code ?? ''}` });
      else if (item.type === 'file_change') ev.push({ type: 'progress', text: `✎ ${(item.changes ?? []).map((c: { path: string }) => c.path).join(', ')}` });
      else if (item.type === 'reasoning' && item.text) ev.push({ type: 'progress', text: `💭 ${short(item.text)}` });
    } else if (o.type === 'item.started' && item?.type === 'command_execution') {
      ev.push({ type: 'progress', text: `$ ${short(item.command)} …` });
    } else if (o.type === 'error' && /^Reconnecting\.\.\./.test(String(o.message ?? ''))) {
      // transient retry notice, not a final failure
      ev.push({ type: 'progress', text: `↻ ${short(o.message, 100)}` });
    } else if (o.type === 'turn.failed' || o.type === 'error') {
      const msg = String(o.error?.message ?? o.message ?? 'unknown error');
      ev.push({ type: 'error', text: short(msg, 500) + (/401 Unauthorized|Missing bearer|not logged in/i.test(msg) ? CODEX_AUTH_HINT : '') });
    }
    return ev;
  },
};

/**
 * Claude Code: `claude -p --output-format stream-json --verbose`, resume with `--resume <session_id>`.
 */
export const claudeAdapter: AgentAdapter = {
  name: 'claude',
  description: 'Anthropic Claude Code (claude -p)',
  buildInvocation({ prompt, sessionId, extraArgs = [] }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', ...extraArgs];
    if (sessionId) args.push('--resume', sessionId);
    return { command: 'claude', args, stdin: prompt };
  },
  parseLine(line) {
    const o = json(line);
    if (!o) return [];
    const ev: AgentEvent[] = [];
    if (o.session_id && (o.type === 'system' || o.type === 'result')) ev.push({ type: 'session', id: o.session_id });
    if (o.type === 'assistant' && (o.is_api_error_message || o.error)) {
      const t = (o.message?.content ?? []).map((c: { text?: string }) => c.text ?? '').join(' ').trim() || String(o.error);
      ev.push({ type: 'error', text: short(t, 500) + (/login|authentication/i.test(t + o.error) ? CLAUDE_AUTH_HINT : '') });
    } else if (o.type === 'assistant') {
      for (const c of o.message?.content ?? []) {
        if (c.type === 'text' && c.text) ev.push({ type: 'text', text: c.text });
        else if (c.type === 'tool_use') ev.push({ type: 'progress', text: `🔧 ${c.name} ${short(JSON.stringify(c.input ?? {}), 100)}` });
      }
    } else if (o.type === 'result' && o.is_error && o.terminal_reason !== 'api_error') {
      // api_error results repeat the assistant error message already reported above
      ev.push({ type: 'error', text: short(o.result ?? o.subtype, 500) });
    }
    return ev;
  },
};

/**
 * sst/opencode: `opencode run --format json <prompt>`, continue with `--session <id>`.
 */
export const opencodeAdapter: AgentAdapter = {
  name: 'opencode',
  description: 'OpenCode (opencode run)',
  buildInvocation({ prompt, sessionId, extraArgs = [] }) {
    const args = ['run', '--format', 'json', ...extraArgs];
    if (sessionId) args.push('--session', sessionId);
    args.push(prompt);
    return { command: 'opencode', args };
  },
  parseLine(line) {
    const o = json(line);
    if (!o) return line.trim() ? [{ type: 'text', text: line }] : [];
    const ev: AgentEvent[] = [];
    if (o.sessionID) ev.push({ type: 'session', id: o.sessionID });
    const part = o.part ?? {};
    if (o.type === 'text' && part.text) ev.push({ type: 'text', text: part.text });
    else if (o.type === 'tool_use') ev.push({ type: 'progress', text: `🔧 ${part.tool ?? ''} ${short(part.state?.title ?? part.state?.input ? JSON.stringify(part.state?.input) : '', 100)}` });
    else if (o.type === 'error') ev.push({ type: 'error', text: short(o.error?.data?.message ?? o.error?.name ?? JSON.stringify(o.error), 500) });
    return ev;
  },
};

export function substitute(arg: string, vars: Record<string, string>): string {
  return arg.replace(/\{(prompt|cwd|session)\}/g, (_, k: string) => vars[k] ?? '');
}

/** Generic adapter from config.customAgents entries; output is treated as plain text. */
export function customAdapter(name: string, c: CustomAgentConfig): AgentAdapter {
  return {
    name,
    description: `custom: ${c.command}`,
    buildInvocation({ prompt, cwd, sessionId, extraArgs = [] }) {
      const vars = { prompt, cwd, session: sessionId ?? '' };
      const args = c.args.map((a) => substitute(a, vars));
      if (sessionId && c.resumeArgs) args.push(...c.resumeArgs.map((a) => substitute(a, vars)));
      args.push(...extraArgs);
      return { command: c.command, args, stdin: c.promptViaStdin ? prompt : undefined };
    },
    parseLine: c.parser && c.parser !== 'text' ? PARSERS[c.parser] : undefined,
  };
}

const PARSERS = { codex: (l: string) => codexAdapter.parseLine!(l), claude: (l: string) => claudeAdapter.parseLine!(l), opencode: (l: string) => opencodeAdapter.parseLine!(l) };

export const BUILTIN_ADAPTERS = [codexAdapter, claudeAdapter, opencodeAdapter];
