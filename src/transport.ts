/** Abstraction over Feishu IM so the bot core is testable without the SDK. */
export interface CardButton {
  text: string;
  /** Command text executed when clicked, e.g. "/agent codex". */
  cmd: string;
  type?: 'default' | 'primary' | 'danger';
}

export interface Card {
  title: string;
  body: string;
  color?: 'blue' | 'green' | 'red' | 'orange' | 'grey';
  /** Rows of buttons (quick-select). */
  buttons?: CardButton[][];
  /** Extra data merged into every button's callback value (scope info). */
  actionContext?: Record<string, string>;
}

/** Reply options: `thread` = reply inside the Feishu thread (话题) of the message. */
export interface ReplyOpts { thread?: boolean }

export interface Transport {
  /** Reply to messageId with markdown text (as a card). Returns new message id. */
  replyCard(messageId: string, card: Card, opts?: ReplyOpts): Promise<string | undefined>;
  /** Update a previously sent card. */
  updateCard(messageId: string, card: Card): Promise<void>;
  replyText(messageId: string, text: string, opts?: ReplyOpts): Promise<string | undefined>;
  replyFile(messageId: string, fileName: string, data: Buffer, opts?: ReplyOpts): Promise<void>;
  replyImage(messageId: string, data: Buffer, opts?: ReplyOpts): Promise<void>;
}

/** Card JSON 1.0 (markdown + action buttons; button clicks arrive as card.action.trigger). */
export function buildCard(c: Card): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [{ tag: 'markdown', content: c.body || ' ' }];
  for (const row of c.buttons ?? []) {
    if (!row.length) continue;
    elements.push({
      tag: 'action',
      layout: row.length > 3 ? 'flow' : 'bisected',
      actions: row.map((b) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: b.text },
        type: b.type ?? 'default',
        value: { ...(c.actionContext ?? {}), cmd: b.cmd },
      })),
    });
  }
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: c.color ?? 'blue', title: { tag: 'plain_text', content: c.title } },
    elements,
  };
}

export const codeBlock = (s: string) => '```\n' + s.replace(/```/g, '``\u200b`') + '\n```';
