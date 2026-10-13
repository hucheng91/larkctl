import { MockTransport } from '../src/mock.js';
import { Bot, type IncomingMessage } from '../src/bot.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { defaultConfig, type Config } from '../src/config.js';
import os from 'node:os';

export async function makeBot(over: Partial<Config> = {}, extra: Partial<ConstructorParameters<typeof Bot>[0]> = {}) {
  const config = { ...defaultConfig(), allowUsers: ['ou_me'], defaultCwd: os.tmpdir(), progressIntervalSec: 1, ...over };
  const transport = new MockTransport(null);
  const agents = await AgentRegistry.fromConfig(config);
  const bot = new Bot({ config, transport, agents, statePath: null, ...extra });
  let n = 0;
  const send = (text: string, m: Partial<IncomingMessage> = {}) => bot.handle({ messageId: `om_${++n}`, chatId: 'oc_1', chatType: 'p2p', senderOpenId: 'ou_me', text, ...m });
  const last = () => transport.sent[transport.sent.length - 1];
  return { bot, transport, send, last, config };
}
