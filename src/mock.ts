import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Transport, Card, ReplyOpts } from './transport.js';

/** Fake transport printing replies to a stream (used by `start --mock` and tests). */
export class MockTransport implements Transport {
  sent: Array<{ kind: string; to: string; id: string; card?: Card; text?: string; file?: string; thread?: boolean }> = [];
  private n = 0;
  constructor(private out: NodeJS.WritableStream | null = process.stdout) {}
  private print(s: string) { this.out?.write(s + '\n'); }
  async replyCard(to: string, card: Card, o?: ReplyOpts) {
    const id = `om_mock_${++this.n}`;
    this.sent.push({ kind: 'card', to, id, card, thread: !!o?.thread });
    const btns = (card.buttons ?? []).map((r) => '│ ' + r.map((b) => `[${b.text}]`).join(' ')).join('\n');
    this.print(`\n┌─ [${card.color ?? 'blue'}] ${card.title}  (${id})\n${card.body.split('\n').map((l) => '│ ' + l).join('\n')}${btns ? '\n' + btns : ''}\n└─`);
    return id;
  }
  async updateCard(id: string, card: Card) {
    this.sent.push({ kind: 'update', to: id, id, card });
    this.print(`\n┌─ (update ${id}) [${card.color ?? 'blue'}] ${card.title}\n${card.body.split('\n').map((l) => '│ ' + l).join('\n')}\n└─`);
  }
  async replyText(to: string, text: string, o?: ReplyOpts) {
    const id = `om_mock_${++this.n}`;
    this.sent.push({ kind: 'text', to, id, text, thread: !!o?.thread });
    this.print(`\n> ${text}`);
    return id;
  }
  async replyFile(to: string, name: string, data: Buffer, o?: ReplyOpts) {
    const f = path.join(os.tmpdir(), `larkctl-mock-${Date.now()}-${name}`);
    fs.writeFileSync(f, data);
    this.sent.push({ kind: 'file', to, id: f, file: f, thread: !!o?.thread });
    this.print(`\n📎 file ${name} (${data.length} bytes) -> ${f}`);
  }
  async replyImage(to: string, data: Buffer, o?: ReplyOpts) {
    const f = path.join(os.tmpdir(), `larkctl-mock-${Date.now()}-${++this.n}.png`);
    fs.writeFileSync(f, data);
    this.sent.push({ kind: 'image', to, id: f, file: f, thread: !!o?.thread });
    this.print(`\n🖼 image (${data.length} bytes) -> ${f}`);
  }
}
