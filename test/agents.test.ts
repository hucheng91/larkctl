import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { codexAdapter, claudeAdapter, opencodeAdapter, customAdapter } from '../src/agents/builtin.js';
import { AgentRegistry, loadPlugin } from '../src/agents/registry.js';
import { defaultConfig } from '../src/config.js';

const fx = path.join(__dirname, 'fixtures');

describe('codex adapter', () => {
  it('new session args', () => {
    const inv = codexAdapter.buildInvocation({ prompt: 'fix it', cwd: '/p' });
    expect(inv.command).toBe('codex');
    expect(inv.args).toEqual(['exec', '--json', '--skip-git-repo-check', '--cd', '/p', '-']);
    expect(inv.stdin).toBe('fix it');
  });
  it('resume args + extra', () => {
    const inv = codexAdapter.buildInvocation({ prompt: 'more', cwd: '/p', sessionId: 'T1', extraArgs: ['--full-auto'] });
    expect(inv.args).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check', '--full-auto', 'T1', '-']);
  });
  it('parses events', () => {
    expect(codexAdapter.parseLine!('{"type":"thread.started","thread_id":"T9"}')).toEqual([{ type: 'session', id: 'T9' }]);
    expect(codexAdapter.parseLine!('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}')).toEqual([{ type: 'text', text: 'hi' }]);
    expect(codexAdapter.parseLine!('{"type":"item.started","item":{"type":"command_execution","command":"npm test"}}')[0].type).toBe('progress');
    expect(codexAdapter.parseLine!('{"type":"turn.failed","error":{"message":"boom"}}')).toEqual([{ type: 'error', text: 'boom' }]);
  });
});

describe('claude adapter', () => {
  it('args', () => {
    expect(claudeAdapter.buildInvocation({ prompt: 'p', cwd: '/x' })).toEqual({ command: 'claude', args: ['-p', '--output-format', 'stream-json', '--verbose'], stdin: 'p' });
    expect(claudeAdapter.buildInvocation({ prompt: 'p', cwd: '/x', sessionId: 'S', extraArgs: ['--permission-mode', 'acceptEdits'] }).args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--resume', 'S']);
  });
  it('parses stream-json', () => {
    expect(claudeAdapter.parseLine!('{"type":"system","subtype":"init","session_id":"S1"}')).toEqual([{ type: 'session', id: 'S1' }]);
    const ev = claudeAdapter.parseLine!(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }));
    expect(ev[0]).toEqual({ type: 'text', text: 'ok' });
    expect(ev[1].type).toBe('progress');
  });
});

describe('opencode adapter', () => {
  it('args', () => {
    expect(opencodeAdapter.buildInvocation({ prompt: 'p', cwd: '/x' }).args).toEqual(['run', '--format', 'json', 'p']);
    expect(opencodeAdapter.buildInvocation({ prompt: 'p', cwd: '/x', sessionId: 'ses_1' }).args).toEqual(['run', '--format', 'json', '--session', 'ses_1', 'p']);
  });
  it('parses json events', () => {
    expect(opencodeAdapter.parseLine!('{"type":"text","sessionID":"ses_1","part":{"text":"done"}}')).toEqual([{ type: 'session', id: 'ses_1' }, { type: 'text', text: 'done' }]);
    expect(opencodeAdapter.parseLine!('plain')).toEqual([{ type: 'text', text: 'plain' }]);
  });
});

describe('custom adapter', () => {
  it('substitutes placeholders', () => {
    const a = customAdapter('aider', { command: 'aider', args: ['--message', '{prompt}', '--dir={cwd}'], resumeArgs: ['--restore', '{session}'] });
    expect(a.buildInvocation({ prompt: 'hi', cwd: '/w' })).toMatchObject({ command: 'aider', args: ['--message', 'hi', '--dir=/w'] });
    expect(a.buildInvocation({ prompt: 'hi', cwd: '/w', sessionId: 'z' }).args).toEqual(['--message', 'hi', '--dir=/w', '--restore', 'z']);
  });
  it('stdin mode', () => expect(customAdapter('x', { command: 'x', args: [], promptViaStdin: true }).buildInvocation({ prompt: 'p', cwd: '.' }).stdin).toBe('p'));
});

describe('plugin loading', () => {
  it('loads default-export adapter from local file', async () => {
    const [a] = await loadPlugin(path.join(fx, 'plugin-adapter.mjs'), {});
    expect(a.name).toBe('echo');
  });
  it('loads factory exporting multiple adapters (relative path)', async () => {
    const list = await loadPlugin('./plugin-factory.mjs', { a: 1 }, fx);
    expect(list.map((a) => a.name)).toEqual(['aider', 'gemini']);
  });
  it('rejects invalid plugin', async () => {
    await expect(loadPlugin(path.join(fx, 'plugin-bad.mjs'), {})).rejects.toThrow(/not a valid AgentAdapter/);
  });
  it('npm package name resolution error is reported, not thrown', async () => {
    const cfg = { ...defaultConfig(), plugins: ['larkctl-adapter-does-not-exist', path.join(fx, 'plugin-adapter.mjs')], customAgents: { mine: { command: 'm', args: ['{prompt}'] } } };
    const r = await AgentRegistry.fromConfig(cfg, fx);
    expect(r.list().map((a) => a.name).sort()).toEqual(['claude', 'codex', 'echo', 'mine', 'opencode']);
    expect(r.errors[0]).toContain('larkctl-adapter-does-not-exist');
  });
});

describe('auth failures (real CLI output shapes)', () => {
  it('codex: reconnect notices are progress, 401 gets login hint', () => {
    expect(codexAdapter.parseLine!('{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401)"}')[0].type).toBe('progress');
    const e = codexAdapter.parseLine!('{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer"}}');
    expect(e[0].type).toBe('error');
    expect(e[0].type === 'error' && e[0].text).toContain('codex login');
  });
  it('claude: not-logged-in surfaces once as error', () => {
    const a = claudeAdapter.parseLine!(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }, error: 'authentication_failed', is_api_error_message: true, session_id: 'S' }));
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe('error');
    const r = claudeAdapter.parseLine!(JSON.stringify({ type: 'result', is_error: true, terminal_reason: 'api_error', result: 'Not logged in', session_id: 'S' }));
    expect(r.filter((x) => x.type === 'error')).toHaveLength(0);
  });
});
