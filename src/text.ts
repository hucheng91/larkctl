/** Extract plain text from a Feishu message content JSON. */
export function extractText(msgType: string, content: string): string {
  let obj: unknown;
  try { obj = JSON.parse(content); } catch { return ''; }
  const o = obj as Record<string, unknown>;
  let text = '';
  if (msgType === 'text') text = String(o.text ?? '');
  else if (msgType === 'post') {
    const body = (o.content ? o : (Object.values(o)[0] as Record<string, unknown>)) ?? {};
    const rows = (body.content as Array<Array<Record<string, unknown>>>) ?? [];
    text = [body.title ? String(body.title) : '', ...rows.map((r) => r.map((e) => (e.tag === 'text' || e.tag === 'a' ? String(e.text ?? '') : e.tag === 'code_block' ? String(e.text ?? '') : '')).join(''))].filter(Boolean).join('\n');
  }
  return text.replace(/@_user_\d+/g, '').replace(/@_all/g, '').trim();
}

export interface ParsedCommand { cmd: string | null; arg: string }

/** `/sh ls -la` -> {cmd:'sh', arg:'ls -la'}; `!ls` -> sh; plain text -> {cmd:null}. */
export function parseCommand(text: string): ParsedCommand {
  const t = text.trim();
  if (t.startsWith('!')) return { cmd: 'sh', arg: t.slice(1).trim() };
  const m = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(t);
  if (m && !/^\/[\w-]+\//.test(t)) return { cmd: m[1].toLowerCase(), arg: (m[2] ?? '').trim() };
  const c = /^confirm\s+([A-Za-z0-9]{4})$/i.exec(t);
  if (c) return { cmd: 'confirm', arg: c[1].toUpperCase() };
  return { cmd: null, arg: t };
}

export function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  const head = Math.floor(max * 0.3);
  const tail = max - head - 40;
  return { text: `${s.slice(0, head)}\n…[${s.length - head - tail} chars omitted]…\n${s.slice(s.length - tail)}`, truncated: true };
}

export function chunk(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [''];
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
