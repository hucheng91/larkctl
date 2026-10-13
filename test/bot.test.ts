import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { makeBot } from './helpers.js';

const fakeAgent = { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-agent.mjs')], promptViaStdin: true, resumeArgs: ['resume'], parser: 'codex' as const };

describe('bot: access control', () => {
  it('strangers get silence by default', async () => {
    const { send, transport } = await makeBot();
    await send('/sh echo hi', { senderOpenId: 'ou_evil' });
    expect(transport.sent).toHaveLength(0);
  });
  it('strangers get refusal when configured', async () => {
    const { send, last } = await makeBot({ replyToStrangers: true });
    await send('hello', { senderOpenId: 'ou_evil' });
    expect(last().text).toContain('Not authorized');
  });
  it('/whoami works for anyone and shows ids', async () => {
    const { send, last } = await makeBot();
    await send('/whoami', { senderOpenId: 'ou_new', chatId: 'oc_g', chatType: 'group' });
    expect(last().card!.body).toContain('ou_new');
    expect(last().card!.body).toContain('oc_g');
    expect(last().card!.body).toContain('allowed: **false**');
  });
});

describe('bot: shell', () => {
  it('runs a command and replies output', async () => {
    const { send, last } = await makeBot();
    await send('/sh echo hello-larkctl');
    expect(last().card!.body).toContain('hello-larkctl');
    expect(last().card!.body).toContain('exit 0');
  });
  it('dangerous command requires confirm with code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
    fs.mkdirSync(path.join(dir, 'victim'));
    const { send, last } = await makeBot({ defaultCwd: dir });
    const cmd = process.platform === 'win32' ? 'Remove-Item -Recurse -Force victim' : 'rm -rf victim';
    await send(`/sh ${cmd}`);
    const body = last().card!.body;
    expect(body).toContain('confirm');
    expect(fs.existsSync(path.join(dir, 'victim'))).toBe(true);
    await send('confirm ZZZZ');
    expect(last().card!.body).toContain('No matching');
    const code = /confirm (\w{4})/.exec(body)![1];
    await send(`confirm ${code}`, { senderOpenId: 'ou_me' });
    expect(fs.existsSync(path.join(dir, 'victim'))).toBe(false);
  });
  it('read-only mode blocks writes and agents', async () => {
    const { send, last } = await makeBot({ readOnly: true });
    await send('/sh touch x');
    expect(last().card!.title).toBe('Read-only mode');
    await send('write code');
    expect(last().card!.title).toBe('Read-only mode');
  });
  it('timeout kills command', async () => {
    const { send, last } = await makeBot({ commandTimeoutSec: 1 });
    await send(`/sh ${process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20'}`);
    expect(last().card!.body).toContain('timed out');
  }, 15000);
  it('long output is truncated and attached as file', async () => {
    const { send, transport } = await makeBot({ maxReplyChars: 300 });
    await send(`/sh node -e "console.log('x'.repeat(5000))"`);
    const file = transport.sent.find((s) => s.kind === 'file');
    expect(file).toBeTruthy();
    expect(fs.readFileSync(file!.file!, 'utf8').trim().length).toBe(5000);
  });
  it('/cd and /pwd and projects', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-')));
    const { send, last } = await makeBot({ projects: { web: dir } });
    await send('/cwd web');
    expect(last().card!.body).toContain('project **web**');
    await send('/pwd');
    expect(last().card!.body).toContain(dir);
    await send('/cd /definitely/not/here');
    expect(last().card!.body).toContain('Not a directory');
  });
  it('/stop kills a running job', async () => {
    const { send, transport } = await makeBot();
    const p = send(`/sh ${process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30'}`);
    await new Promise((r) => setTimeout(r, 800));
    await send('/status');
    expect(transport.sent[transport.sent.length - 1].card!.body).toContain('running: shell');
    await send('/stop');
    await p;
    expect(transport.sent[transport.sent.length - 1].card!.body).toContain('stopped');
  }, 20000);
});

describe('bot: agent mode', () => {
  it('plain text goes to agent, session continues, /new resets', async () => {
    const { send, transport, last } = await makeBot({ defaultAgent: 'fake', customAgents: { fake: fakeAgent } });
    await send('hello agent');
    // first card is the progress card, then updated with the result
    const upd = last();
    expect(upd.kind).toBe('update');
    expect(upd.card!.body).toContain('echo: hello agent | resumed=false');
    await send('/status');
    expect(last().card!.body).toContain('session: thread-123');
    await send('again');
    expect(last().card!.body).toContain('resumed=true');
    await send('/new');
    await send('fresh');
    expect(last().card!.body).toContain('resumed=false');
    expect(transport.sent.filter((s) => s.kind === 'card' && s.card!.title.startsWith('🤖')).length).toBe(3);
  });
  it('/agent switches and unknown is rejected', async () => {
    const { send, last } = await makeBot();
    await send('/agent claude');
    expect(last().card!.body).toContain('Switched to **claude**');
    await send('/agent nope');
    expect(last().card!.body).toContain('Unknown agent');
  });
  it('missing agent binary reports error instead of crashing', async () => {
    const { send, last } = await makeBot({ defaultAgent: 'ghost', customAgents: { ghost: { command: 'larkctl-no-such-binary', args: [] } } });
    await send('hi');
    expect(last().card!.color).toBe('red');
  });
  it('screenshot uploads image', async () => {
    const { send, transport } = await makeBot({}, { screenshot: async () => Buffer.from('PNG') });
    await send('/screenshot');
    expect(transport.sent.find((s) => s.kind === 'image')).toBeTruthy();
  });
});
