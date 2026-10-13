/** Abstraction over Feishu IM so the bot core is testable without the SDK. */
export interface Card { title: string; body: string; color?: 'blue' | 'green' | 'red' | 'orange' | 'grey' }

export interface Transport {
  /** Reply in thread to messageId with markdown text (as a card). Returns new message id. */
  replyCard(messageId: string, card: Card): Promise<string | undefined>;
  /** Update a previously sent card. */
  updateCard(messageId: string, card: Card): Promise<void>;
  replyText(messageId: string, text: string): Promise<string | undefined>;
  replyFile(messageId: string, fileName: string, data: Buffer): Promise<void>;
  replyImage(messageId: string, data: Buffer): Promise<void>;
}

export function buildCard(c: Card): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: c.color ?? 'blue', title: { tag: 'plain_text', content: c.title } },
    elements: [{ tag: 'markdown', content: c.body || ' ' }],
  };
}

export const codeBlock = (s: string) => '```\n' + s.replace(/```/g, '``\u200b`') + '\n```';
