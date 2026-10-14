import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { makeBot } from './helpers.js';
import { Bot, type Media } from '../src/bot.js';
import { buildCard } from '../src/transport.js';
import { createDispatcher, toIncoming, toCardAction, LarkTransport } from '../src/lark.js';
import { extractImageKeys, extractAudioKey, naturalIntent, findImagePaths } from '../src/text.js';
import { transcribeAudio } from '../src/asr.js';
import { codexAdapter } from '../src/agents/builtin.js';

const fakeAgent = { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-agent.mjs')], promptViaStdin: true, resumeArgs: ['resume'], parser: 'codex' as const };
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-')));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

describe('cards & quick-select', () => {
  it('buildCard renders button rows with callback value incl. scope', () => {
    const c = buildCard({ title: 'T', body: 'B', buttons: [[{ text: 'codex', cmd: '/agent codex' }]], actionContext: { chat: 'oc_1', thread: 'omt_1' } }) as any;
    expect(c.schema).toBe('2.0');
    expect(c.elements).toBeUndefined();
    const els = c.body.elements as Array<Record<string, any>>;
    expect(JSON.stringify(c)).not.toContain('"tag":"action"');
    expect(els[1].tag).toBe('column_set');
    const btn = els[1].columns[0].elements[0];
    expect(btn.tag).toBe('button');
    expect(btn.behaviors[0]).toEqual({ type: 'callback', value: { chat: 'oc_1', thread: 'omt_1', cmd: '/agent codex' } });
    expect(c.config.summary.content).toBe('T: B');
  });
  it('/menu, help and unknown commands reply with buttons for agents, projects and controls', async () => {
    const dir = tmp();
    const { send, last } = await makeBot({ projects: { web: dir } });
    for (const t of ['/menu', 'help', '菜单', '/bogus']) {
      await send(t);
      const cmds = last().card!.buttons!.flat().map((b) => b.cmd);
      expect(cmds).toEqual(expect.arrayContaining(['/agent codex', '/agent claude', '/agent opencode', '/cwd web', '/new', '/stop', '/screenshot', '/status']));
    }
  });
  it('menu lists numbered options and a bare digit selects one (button fallback)', async () => {
    const { send, last } = await makeBot();
    await send('/menu');
    const c = last().card!;
    const flat = c.buttons!.flat();
    expect(c.body).toContain(`1. ${flat[0].text}`);
    const i = flat.findIndex((b) => b.cmd === '/status');
    await send(String(i + 1));
    expect(last().card!.title).toBe('Status');
  });
  it('group @mention natural-language menu request shows the menu card', async () => {
    const { send, last } = await makeBot();
    await send('@larkctl 有哪些功能？给我一下菜单？');
    expect(last().card!.buttons!.flat().map((b) => b.cmd)).toEqual(expect.arrayContaining(['/agent codex', '/status']));
    await send('@_user_1 /status');
    expect(last().card!.title).toBe('Status');
  });
  it('card button click runs the command via handleAction and returns a toast', async () => {
    const { bot, transport } = await makeBot();
    const r = await bot.handleAction({ operatorOpenId: 'ou_me', messageId: 'om_card', value: { cmd: '/agent claude', chat: 'oc_1', ct: 'p2p' } });
    expect(r).toMatchObject({ toast: { type: 'info' } });
    expect(transport.sent.at(-1)!.card!.body).toContain('Switched to **claude**');
    expect(transport.sent.at(-1)!.to).toBe('om_card');
  });
  it('card clicks from strangers are refused', async () => {
    const { bot, transport } = await makeBot();
    const r = await bot.handleAction({ operatorOpenId: 'ou_evil', messageId: 'om_card', value: { cmd: '/sh id', chat: 'oc_1' } });
    expect(r).toMatchObject({ toast: { type: 'error' } });
    expect(transport.sent).toHaveLength(0);
  });
  it('dispatcher routes card.action.trigger and returns the response', async () => {
    const onAction = vi.fn().mockResolvedValue({ toast: { type: 'info', content: 'ok' } });
    const d = createDispatcher(() => undefined, onAction);
    const res = await d.invoke({ schema: '2.0', header: { event_type: 'card.action.trigger', event_id: 'e', token: '', create_time: '0', app_id: 'a', tenant_key: 't' }, event: { operator: { open_id: 'ou_me' }, action: { tag: 'button', value: { cmd: '/stop', thread: 'omt_9' } }, context: { open_message_id: 'om_c', open_chat_id: 'oc_1' } } } as never);
    expect(onAction).toHaveBeenCalledWith({ operatorOpenId: 'ou_me', chatId: 'oc_1', messageId: 'om_c', value: { cmd: '/stop', thread: 'omt_9' } });
    expect(res).toEqual({ toast: { type: 'info', content: 'ok' } });
  });
  it('toCardAction accepts string values and rejects junk', () => {
    expect(toCardAction({ action: { value: '{"cmd":"/new"}' }, context: { open_message_id: 'om' } })!.value).toEqual({ cmd: '/new' });
    expect(toCardAction({ action: {} })).toBeNull();
  });
});

describe('natural shortcuts & screenshot', () => {
  it('naturalIntent', () => {
    expect(naturalIntent('截图')).toBe('screenshot');
    expect(naturalIntent('发个截图！')).toBe('screenshot');
    expect(naturalIntent('做得怎么样了？')).toBe('progress');
    expect(naturalIntent('help')).toBe('menu');
    expect(naturalIntent('请帮我把登录页面截图功能重构一下并写测试')).toBeNull();
    expect(naturalIntent('有哪些功能？给我一下菜单？')).toBe('menu');
    expect(naturalIntent('当前工具支持哪些命令？')).toBe('menu');
    expect(naturalIntent('有哪些命令')).toBe('menu');
    expect(naturalIntent('what commands')).toBe('menu');
    expect(naturalIntent('给登录页加一个记住密码的功能并跑测试，然后提交代码')).toBeNull();
  });
  it('截图 sends an image; 做得怎么样 sends status + image', async () => {
    const { send, transport } = await makeBot({}, { screenshot: async () => PNG });
    await send('截图');
    expect(transport.sent.at(-1)!.kind).toBe('image');
    await send('做得怎么样');
    expect(transport.sent.at(-2)!.card!.title).toBe('Status');
    expect(transport.sent.at(-1)!.kind).toBe('image');
  });
});

describe('threads (话题)', () => {
  it('each thread has its own session/cwd/agent and replies go into the thread', async () => {
    const d1 = tmp();
    const { send, transport, last } = await makeBot({ defaultAgent: 'fake', customAgents: { fake: fakeAgent }, projects: { a: d1 } });
    await send('hi chat');
    await send('/cwd a', { threadId: 'omt_1' });
    expect(last().thread).toBe(true);
    await send('hi thread', { threadId: 'omt_1' });
    expect(last().card!.body).toContain('resumed=false');
    expect(last().card!.title).toContain(path.basename(d1));
    await send('/status');
    expect(last().card!.body).not.toContain(d1);
    expect(last().thread).toBe(false);
    await send('/status', { threadId: 'omt_1' });
    expect(last().card!.body).toContain(d1);
    expect(transport.sent.filter((s) => s.thread).length).toBeGreaterThan(2);
  });
  it('threads run concurrently and /stop only stops that thread', async () => {
    const { send, transport } = await makeBot({ defaultAgent: 'fake', customAgents: { fake: fakeAgent } });
    const p1 = send('sleep', { threadId: 'omt_a' });
    const p2 = send('sleep', { threadId: 'omt_b' });
    await new Promise((r) => setTimeout(r, 800));
    await send('/stop', { threadId: 'omt_a' });
    await p1;
    await send('/status', { threadId: 'omt_b' });
    expect(transport.sent.at(-1)!.card!.body).toContain('running: agent:fake');
    await send('/stop', { threadId: 'omt_b' });
    await p2;
  }, 20000);
  it('thread bindings persist to disk', async () => {
    const statePath = path.join(tmp(), 'state.json');
    const { send } = await makeBot({}, { statePath });
    await send('/agent claude', { threadId: 'omt_p' });
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))['oc_1#omt_p'].agent).toBe('claude');
  });
  it('toIncoming extracts thread, images and audio', () => {
    const base = { message_id: 'om', chat_id: 'oc', chat_type: 'group' };
    expect(toIncoming({ message: { ...base, message_type: 'text', content: '{"text":"x"}', thread_id: 'omt_1' } })!.threadId).toBe('omt_1');
    expect(toIncoming({ message: { ...base, message_type: 'image', content: '{"image_key":"img_1"}' } })!.imageKeys).toEqual(['img_1']);
    expect(toIncoming({ message: { ...base, message_type: 'audio', content: '{"file_key":"fk","duration":2000}' } })!.audioKey).toBe('fk');
  });
  it('LarkTransport sets reply_in_thread', async () => {
    const reply = vi.fn().mockResolvedValue({ data: { message_id: 'x' } });
    const t = new LarkTransport({ im: { v1: { message: { reply } } } } as never);
    await t.replyCard('om', { title: 'a', body: 'b' }, { thread: true });
    await t.replyText('om', 'hi');
    expect(reply.mock.calls.map((c) => c[0].data.reply_in_thread)).toEqual([true, false]);
  });
  it('scope key', () => { expect(Bot.scope({ chatId: 'c' })).toBe('c'); expect(Bot.scope({ chatId: 'c', threadId: 't' })).toBe('c#t'); });
});

describe('images inbound / outbound', () => {
  it('extractImageKeys from image and post', () => {
    expect(extractImageKeys('image', '{"image_key":"k1"}')).toEqual(['k1']);
    expect(extractImageKeys('post', JSON.stringify({ title: '', content: [[{ tag: 'text', text: 'fix' }, { tag: 'img', image_key: 'k2' }]] }))).toEqual(['k2']);
    expect(extractAudioKey('audio', '{"file_key":"f"}')).toBe('f');
    expect(extractAudioKey('text', '{}')).toBeUndefined();
  });
  it('image-only message is saved and attached to the next prompt; post with text runs at once', async () => {
    const dir = tmp();
    const media: Media = { download: vi.fn().mockResolvedValue(PNG), transcribe: vi.fn() };
    const { send, last } = await makeBot({ defaultAgent: 'fake', customAgents: { fake: fakeAgent }, defaultCwd: dir }, { media });
    await send('', { imageKeys: ['k1'] });
    expect(last().card!.title).toContain('Image received');
    const saved = path.join(dir, '.larkctl', 'inbox');
    expect(fs.readdirSync(saved)).toHaveLength(1);
    await send('what is this');
    expect(last().card!.body).toContain('Attached image files');
    expect(last().card!.body).toContain(saved);
    await send('fix layout', { imageKeys: ['k2'] });
    expect(last().card!.body).toContain('echo: fix layout');
    expect(last().card!.body).toContain('Attached image files');
  });
  it('codex adapter passes images with --image=', () => {
    const inv = codexAdapter.buildInvocation({ prompt: 'p', cwd: '/x', images: ['/a.png'] });
    expect(inv.args).toContain('--image=/a.png');
    expect(inv.args.at(-1)).toBe('-');
  });
  it('findImagePaths', () => {
    expect(findImagePaths('saved to `out/chart.png` and /tmp/a.jpg.')).toEqual(['out/chart.png', '/tmp/a.jpg']);
  });
  it('images produced by the agent are sent back', async () => {
    const dir = tmp();
    const { send, transport } = await makeBot({ defaultAgent: 'fake', customAgents: { fake: fakeAgent }, defaultCwd: dir });
    await send('mkimg');
    expect(transport.sent.at(-1)!.kind).toBe('image');
  });
});

describe('voice', () => {
  it('voice is transcribed, echoed and executed', async () => {
    const media: Media = { download: vi.fn().mockResolvedValue(Buffer.from('ogg')), transcribe: vi.fn().mockResolvedValue('/agent claude') };
    const { send, transport } = await makeBot({}, { media });
    await send('', { audioKey: 'fk' });
    expect(media.download).toHaveBeenCalledWith('om_1', 'fk', 'file');
    expect(transport.sent[0].text).toBe('🎤 /agent claude');
    expect(transport.sent[1].card!.body).toContain('Switched to **claude**');
  });
  it('transcription failure gives a clear reply', async () => {
    const media: Media = { download: vi.fn().mockResolvedValue(Buffer.from('ogg')), transcribe: vi.fn().mockRejectedValue(new Error('Feishu ASR: 99991672 no scope')) };
    const { send, last } = await makeBot({}, { media });
    await send('', { audioKey: 'fk' });
    expect(last().card!.title).toContain('语音识别失败');
    expect(last().card!.body).toContain('99991672');
  });
  it('no media backend -> clear message', async () => {
    const { send, last } = await makeBot();
    await send('', { audioKey: 'fk' });
    expect(last().card!.body).toContain('not supported');
  });
  it('transcribeAudio: feishu first, whisper fallback, error aggregation', async () => {
    const convert = async (b: Buffer) => b;
    expect(await transcribeAudio(Buffer.from('a'), { mode: 'auto', convert, feishu: async () => ' hi ' })).toBe('hi');
    expect(await transcribeAudio(Buffer.from('a'), { mode: 'auto', convert, feishu: async () => { throw new Error('99991672 permission'); }, runWhisper: async () => 'local' })).toBe('local');
    await expect(transcribeAudio(Buffer.from('a'), { mode: 'auto', convert, feishu: async () => { throw new Error('99991672'); }, runWhisper: async () => { throw new Error('none'); } })).rejects.toThrow(/speech_to_text:speech[\s\S]*whisper: none/);
    await expect(transcribeAudio(Buffer.from('a'), { mode: 'off' })).rejects.toThrow(/off/);
  });
});
