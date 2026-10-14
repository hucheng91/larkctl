import { describe, it, expect, vi } from 'vitest';
import { createDispatcher, toIncoming, LarkTransport, sdkDomain } from '../src/lark.js';
import * as lark from '@larksuiteoapi/node-sdk';

const event = (over: Record<string, unknown> = {}) => ({
  schema: '2.0',
  header: { event_id: 'e1', event_type: 'im.message.receive_v1', create_time: '0', token: '', app_id: 'cli_x', tenant_key: 't' },
  event: {
    sender: { sender_id: { open_id: 'ou_me' }, sender_type: 'user' },
    message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '/status' }), ...over },
  },
});

describe('dispatcher (SDK EventDispatcher)', () => {
  it('routes im.message.receive_v1 to handler and dedupes', async () => {
    const got: unknown[] = [];
    const d = createDispatcher((m) => got.push(m));
    await d.invoke(event());
    await d.invoke(event());
    expect(got).toEqual([{ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', senderOpenId: 'ou_me', text: '/status' }]);
  });
  it('ignores messages from apps', () => {
    expect(toIncoming({ sender: { sender_type: 'app' }, message: { message_id: 'm', chat_id: 'c', chat_type: 'p2p', message_type: 'text', content: '{}' } })).toBeNull();
  });
  it('domain mapping', () => { expect(sdkDomain('lark')).toBe(lark.Domain.Lark); expect(sdkDomain('feishu')).toBe(lark.Domain.Feishu); });
});

describe('LarkTransport (mock SDK client)', () => {
  it('replies with interactive card and patches it', async () => {
    const reply = vi.fn().mockResolvedValue({ data: { message_id: 'om_r' } });
    const patch = vi.fn().mockResolvedValue({});
    const t = new LarkTransport({ im: { v1: { message: { reply, patch } } } } as never);
    const id = await t.replyCard('om_1', { title: 'T', body: 'B' });
    expect(id).toBe('om_r');
    expect(reply.mock.calls[0][0].path.message_id).toBe('om_1');
    expect(reply.mock.calls[0][0].data.msg_type).toBe('interactive');
    expect(JSON.parse(reply.mock.calls[0][0].data.content).body.elements[0].content).toBe('B');
    await t.updateCard('om_r', { title: 'T', body: 'C' });
    expect(patch.mock.calls[0][0].path.message_id).toBe('om_r');
  });
  it('uploads files and images then replies', async () => {
    const reply = vi.fn().mockResolvedValue({ data: {} });
    const t = new LarkTransport({ im: { v1: { message: { reply }, file: { create: vi.fn().mockResolvedValue({ file_key: 'fk' }) }, image: { create: vi.fn().mockResolvedValue({ image_key: 'ik' }) } } } } as never);
    await t.replyFile('om_1', 'a.txt', Buffer.from('x'));
    await t.replyImage('om_1', Buffer.from('x'));
    expect(reply.mock.calls.map((c) => c[0].data.msg_type)).toEqual(['file', 'image']);
    expect(JSON.parse(reply.mock.calls[0][0].data.content)).toEqual({ file_key: 'fk' });
  });
});

import { checkResp } from '../src/lark.js';
describe('checkResp', () => {
  it('throws on non-zero Feishu code (rejected card)', () => {
    expect(() => checkResp('reply card', { code: 230099, msg: 'invalid card' })).toThrow(/230099/);
    expect(() => checkResp('x', { code: 0 })).not.toThrow();
  });
});
