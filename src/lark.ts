import * as lark from '@larksuiteoapi/node-sdk';
import type { Config } from './config.js';
import type { Transport, Card, ReplyOpts } from './transport.js';
import { buildCard } from './transport.js';
import { extractText, extractImageKeys, extractAudioKey } from './text.js';
import type { IncomingMessage, CardAction, Media } from './bot.js';
import { transcribeAudio } from './asr.js';

/** Shape of im.message.receive_v1 event data (subset). */
export interface ReceiveEvent {
  sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  message?: { message_id: string; chat_id: string; chat_type: string; message_type: string; content: string; thread_id?: string; root_id?: string };
}

/** Shape of card.action.trigger callback data (flattened by the SDK). */
export interface CardActionEvent {
  operator?: { open_id?: string };
  action?: { value?: Record<string, unknown> | string; tag?: string };
  context?: { open_message_id?: string; open_chat_id?: string };
  open_message_id?: string;
  open_chat_id?: string;
}

export function toIncoming(ev: ReceiveEvent): IncomingMessage | null {
  const msg = ev.message;
  if (!msg || ev.sender?.sender_type === 'app') return null;
  const m: IncomingMessage = {
    messageId: msg.message_id,
    chatId: msg.chat_id,
    chatType: msg.chat_type,
    senderOpenId: ev.sender?.sender_id?.open_id ?? '',
    text: extractText(msg.message_type, msg.content),
  };
  if (msg.thread_id) m.threadId = msg.thread_id;
  const imgs = extractImageKeys(msg.message_type, msg.content);
  if (imgs.length) m.imageKeys = imgs;
  const audio = extractAudioKey(msg.message_type, msg.content);
  if (audio) m.audioKey = audio;
  return m;
}

export function toCardAction(ev: CardActionEvent): CardAction | null {
  const messageId = ev.context?.open_message_id ?? ev.open_message_id;
  let value = ev.action?.value;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = {}; } }
  if (!messageId || !value || typeof value !== 'object') return null;
  return { operatorOpenId: ev.operator?.open_id ?? '', chatId: ev.context?.open_chat_id ?? ev.open_chat_id, messageId, value };
}

/** Event dispatcher wired to handlers; exported so tests can invoke it with fake events. */
export function createDispatcher(onMessage: (m: IncomingMessage) => void, onAction?: (a: CardAction) => Promise<Record<string, unknown>>): lark.EventDispatcher {
  const seen = new Set<string>();
  const handlers: Record<string, (data: never) => Promise<unknown>> = {
    'im.message.receive_v1': async (data: ReceiveEvent) => {
      const m = toIncoming(data);
      if (!m || seen.has(m.messageId)) return; // dedupe redeliveries
      seen.add(m.messageId);
      if (seen.size > 5000) seen.clear();
      onMessage(m); // do not await: event must be acked quickly
    },
  };
  if (onAction) {
    handlers['card.action.trigger'] = async (data: CardActionEvent) => {
      const a = toCardAction(data);
      if (!a) return {};
      return onAction(a); // response (toast) goes back over the long connection
    };
  }
  return new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.warn }).register(handlers as never);
}

export const sdkDomain = (d: Config['domain']) => (d === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu);

/** Minimal subset of lark.Client we use (so tests can pass a fake). */
export type ImClient = Pick<lark.Client, 'im'>;

/** Inbound media via im.messageResource.get + speech_to_text ASR. */
export class LarkMedia implements Media {
  constructor(private client: lark.Client, private cfg: Config) {}
  async download(messageId: string, key: string, type: 'image' | 'file'): Promise<Buffer> {
    const r = await this.client.im.v1.messageResource.get({ path: { message_id: messageId, file_key: key }, params: { type } });
    const chunks: Buffer[] = [];
    for await (const c of r.getReadableStream()) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }
  transcribe(audio: Buffer) {
    return transcribeAudio(audio, {
      mode: this.cfg.asr,
      whisperCommand: this.cfg.whisperCommand,
      feishu: async (pcm) => {
        const r = await this.client.speech_to_text.v1.speech.fileRecognize({
          data: { speech: { speech: pcm.toString('base64') }, config: { file_id: Math.random().toString(36).slice(2, 10).padEnd(16, '0').slice(0, 16), format: 'pcm', engine_type: '16k_auto' } },
        });
        if (r.code) throw new Error(`Feishu ASR error ${r.code}: ${r.msg}`);
        return r.data?.recognition_text ?? '';
      },
    });
  }
}

/** Feishu returns {code,msg}; a non-zero code means the message was rejected (e.g. invalid card JSON). */
export function checkResp(what: string, r: unknown) {
  const x = r as { code?: number; msg?: string } | undefined;
  if (x && typeof x.code === 'number' && x.code !== 0) throw new Error(`${what} failed: ${x.code} ${x.msg ?? ''}`.trim());
}

export class LarkTransport implements Transport {
  constructor(private client: ImClient) {}
  async replyCard(messageId: string, card: Card, o?: ReplyOpts) {
    const r = await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'interactive', content: JSON.stringify(buildCard(card)), reply_in_thread: !!o?.thread } });
    checkResp('reply card', r);
    return r.data?.message_id;
  }
  async updateCard(messageId: string, card: Card) {
    const r = await this.client.im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(buildCard(card)) } });
    checkResp('update card', r);
  }
  async replyText(messageId: string, text: string, o?: ReplyOpts) {
    const r = await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'text', content: JSON.stringify({ text }), reply_in_thread: !!o?.thread } });
    return r.data?.message_id;
  }
  async replyFile(messageId: string, fileName: string, data: Buffer, o?: ReplyOpts) {
    const up = await this.client.im.v1.file.create({ data: { file_type: 'stream', file_name: fileName, file: data } });
    const key = up?.file_key;
    if (!key) throw new Error('file upload failed');
    await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'file', content: JSON.stringify({ file_key: key }), reply_in_thread: !!o?.thread } });
  }
  async replyImage(messageId: string, data: Buffer, o?: ReplyOpts) {
    const up = await this.client.im.v1.image.create({ data: { image_type: 'message', image: data } });
    const key = up?.image_key;
    if (!key) throw new Error('image upload failed');
    await this.client.im.v1.message.reply({ path: { message_id: messageId }, data: { msg_type: 'image', content: JSON.stringify({ image_key: key }), reply_in_thread: !!o?.thread } });
  }
}

type WsFrame = { headers: { key: string; value: string }[]; payload?: Uint8Array } & Record<string, unknown>;
const hdr = (f: WsFrame, k: string) => f.headers?.find((h) => h.key === k)?.value;

/**
 * node-sdk 1.75.0 WSClient.handleEventData drops every frame whose header type !== 'event'.
 * Long-connection card callbacks (card.action.trigger) arrive with type 'card', so they were
 * silently ignored (button stays "pressed"). Rewrite card frames to 'event' so they reach the
 * EventDispatcher, and restore type 'card' on the ack/response frame. Also logs inbound frame types.
 */
export function patchWsClient(ws: lark.WSClient, log: (s: string) => void) {
  const w = ws as unknown as {
    handleEventData: (d: WsFrame) => Promise<void>; handleControlData: (d: WsFrame) => Promise<void>; sendMessage: (d: WsFrame) => void;
    communicate: () => void; wsConfig: { getWSInstance: () => { on: (e: string, f: (b: Buffer) => void) => void } | undefined };
  };
  // Lowest level: raw socket 'message' before SDK decode (attached before the SDK's own listener).
  const origComm = w.communicate.bind(ws);
  w.communicate = () => {
    w.wsConfig.getWSInstance()?.on('message', (b: Buffer) => {
      const ascii = Buffer.from(b).toString('latin1').match(/[ -~]{3,}/g)?.slice(0, 12).join('|') ?? '';
      if (!/\bping\b|\bpong\b/.test(ascii)) log(`ws raw ${b.length}B ${ascii.slice(0, 300)}`);
    });
    origComm();
  };
  const origCtl = w.handleControlData.bind(ws);
  w.handleControlData = (d: WsFrame) => {
    const t = hdr(d, 'type');
    if (t !== 'ping' && t !== 'pong') log(`ws control frame type=${t} headers=${d.headers.map((h) => h.key).join(',')}`);
    return origCtl(d);
  };
  const origHandle = w.handleEventData.bind(ws);
  const origSend = w.sendMessage.bind(ws);
  const cardIds = new Set<string>();
  w.handleEventData = (d: WsFrame) => {
    const type = hdr(d, 'type');
    const id = hdr(d, 'message_id') ?? '';
    log(`ws frame type=${type} message_id=${id} method=${String(d.method)} headers=${d.headers.map((h) => h.key).join(',')}`);
    if (type === 'card') {
      cardIds.add(id);
      d = { ...d, headers: d.headers.map((h) => (h.key === 'type' ? { ...h, value: 'event' } : h)) };
    }
    return origHandle(d);
  };
  w.sendMessage = (d: WsFrame) => {
    const id = hdr(d, 'message_id') ?? '';
    if (cardIds.delete(id)) d = { ...d, headers: d.headers.map((h) => (h.key === 'type' ? { ...h, value: 'card' } : h)) };
    origSend(d);
  };
  return ws;
}

export async function startLark(cfg: Config, onMessage: (m: IncomingMessage) => void, log: (s: string) => void, onAction?: (a: CardAction) => Promise<Record<string, unknown>>) {
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
  patchWsClient(ws, log);
  await ws.start({ eventDispatcher: createDispatcher(onMessage, onAction) });
  return { client, ws, transport: new LarkTransport(client), media: new LarkMedia(client, cfg) };
}
