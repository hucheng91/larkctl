import * as lark from '@larksuiteoapi/node-sdk';
import type { Config } from './config.js';
import type { Transport, Card } from './transport.js';
import { buildCard } from './transport.js';
import { extractText } from './text.js';
import type { IncomingMessage } from './bot.js';

/** Shape of im.message.receive_v1 event data (subset). */
export interface ReceiveEvent {
  sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  message?: { message_id: string; chat_id: string; chat_type: string; message_type: string; content: string };
}

export function toIncoming(ev: ReceiveEvent): IncomingMessage | null {
  const msg = ev.message;
  if (!msg || ev.sender?.sender_type === 'app') return null;
  return {
    messageId: msg.message_id,
    chatId: msg.chat_id,
    chatType: msg.chat_type,
    senderOpenId: ev.sender?.sender_id?.open_id ?? '',
    text: extractText(msg.message_type, msg.content),
  };
}

/** Event dispatcher wired to a handler; exported so tests can invoke it with fake events. */
export function createDispatcher(onMessage: (m: IncomingMessage) => void): lark.EventDispatcher {
  const seen = new Set<string>();
  return new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.warn }).register({
    'im.message.receive_v1': async (data: ReceiveEvent) => {
      const m = toIncoming(data);
      if (!m || seen.has(m.messageId)) return; // dedupe redeliveries
      seen.add(m.messageId);
      if (seen.size > 5000) seen.clear();
      onMessage(m); // do not await: event must be acked quickly
    },
  });
}

export const sdkDomain = (d: Config['domain']) => (d === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu);

/** Minimal subset of lark.Client we use (so tests can pass a fake). */
export type ImClient = Pick<lark.Client, 'im'>;

export class LarkTransport implements Transport {
  constructor(private client: ImClient) {}
  async replyCard(messageId: string, card: Card) {
    const r = await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'interactive', content: JSON.stringify(buildCard(card)), reply_in_thread: false } });
    return r.data?.message_id;
  }
  async updateCard(messageId: string, card: Card) {
    await this.client.im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(buildCard(card)) } });
  }
  async replyText(messageId: string, text: string) {
    const r = await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'text', content: JSON.stringify({ text }) } });
    return r.data?.message_id;
  }
  async replyFile(messageId: string, fileName: string, data: Buffer) {
    const up = await this.client.im.v1.file.create({ data: { file_type: 'stream', file_name: fileName, file: data } });
    const key = up?.file_key;
    if (!key) throw new Error('file upload failed');
    await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'file', content: JSON.stringify({ file_key: key }) } });
  }
  async replyImage(messageId: string, data: Buffer) {
    const up = await this.client.im.v1.image.create({ data: { image_type: 'message', image: data } });
    const key = up?.image_key;
    if (!key) throw new Error('image upload failed');
    await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'image', content: JSON.stringify({ image_key: key }) } });
  }
}

export async function startLark(cfg: Config, onMessage: (m: IncomingMessage) => void, log: (s: string) => void) {
  const base = { appId: cfg.appId, appSecret: cfg.appSecret, domain: sdkDomain(cfg.domain), loggerLevel: lark.LoggerLevel.warn };
  const client = new lark.Client(base);
  const ws = new lark.WSClient({
    ...base,
    autoReconnect: true,
    source: 'larkctl',
    onReady: () => log('connected to Feishu/Lark long connection'),
    onReconnecting: () => log('reconnecting…'),
    onReconnected: () => log('reconnected'),
    onError: (e) => log(`connection error: ${e.message}`),
  });
  await ws.start({ eventDispatcher: createDispatcher(onMessage) });
  return { client, ws, transport: new LarkTransport(client) };
}
