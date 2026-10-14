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

/** Plain-text preview used as the card summary (chat list / thread list / notifications show this instead of just the title). */
export function cardSummary(c: Card): string {
  const t = (c.body || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  return (t ? `${c.title}: ${t}` : c.title).slice(0, 100);
}

/**
 * Card JSON 2.0: header + body.elements. Buttons live directly in body.elements inside a column_set
 * (the 1.0 `action` container is not allowed in 2.0); clicks use behaviors[{type:'callback'}] and arrive
 * as card.action.trigger with action.value = the callback value.
 */
export function buildCard(c: Card): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [{ tag: 'markdown', content: c.body || ' ' }];
  for (const row of c.buttons ?? []) {
    if (!row.length) continue;
    elements.push({
      tag: 'column_set',
      flex_mode: row.length > 2 ? 'flow' : 'bisect',
      horizontal_spacing: '8px',
      columns: row.map((b) => ({
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: b.text },
          type: b.type ?? 'default',
          width: 'fill',
          size: 'medium',
          behaviors: [{ type: 'callback', value: { ...(c.actionContext ?? {}), cmd: b.cmd } }],
        }],
      })),
    });
  }
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'fill', summary: { content: cardSummary(c) } },
    header: { template: c.color ?? 'blue', title: { tag: 'plain_text', content: c.title } },
    body: { elements },
  };
}

export const codeBlock = (s: string) => '```\n' + s.replace(/```/g, '``\u200b`') + '\n```';
