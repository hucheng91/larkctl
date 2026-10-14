import { describe, it, expect } from 'vitest';
import { extractText, parseCommand, truncate, chunk, stripAnsi } from '../src/text.js';

describe('extractText', () => {
  it('strips literal leading @name', () => expect(extractText('text', JSON.stringify({ text: '@larkctl /menu' }))).toBe('/menu'));
  it('text message strips mentions', () => expect(extractText('text', JSON.stringify({ text: '@_user_1 /sh ls' }))).toBe('/sh ls'));
  it('post message', () => {
    const c = { zh_cn: { title: 'T', content: [[{ tag: 'text', text: 'hello ' }, { tag: 'at', user_id: 'x' }, { tag: 'a', text: 'link', href: 'h' }], [{ tag: 'text', text: 'line2' }]] } };
    expect(extractText('post', JSON.stringify(c))).toBe('T\nhello link\nline2');
  });
  it('post without locale wrapper', () => expect(extractText('post', JSON.stringify({ title: '', content: [[{ tag: 'text', text: 'x' }]] }))).toBe('x'));
  it('bad json', () => expect(extractText('text', '{')).toBe(''));
  it('image -> empty', () => expect(extractText('image', '{"image_key":"k"}')).toBe(''));
});

describe('parseCommand', () => {
  it('slash', () => expect(parseCommand('/sh ls -la')).toEqual({ cmd: 'sh', arg: 'ls -la' }));
  it('multiline arg', () => expect(parseCommand('/sh echo a\necho b')).toEqual({ cmd: 'sh', arg: 'echo a\necho b' }));
  it('bang', () => expect(parseCommand('!pwd')).toEqual({ cmd: 'sh', arg: 'pwd' }));
  it('case-insensitive', () => expect(parseCommand('/STATUS')).toEqual({ cmd: 'status', arg: '' }));
  it('confirm', () => expect(parseCommand('confirm ab12')).toEqual({ cmd: 'confirm', arg: 'AB12' }));
  it('plain text is agent prompt', () => expect(parseCommand(' fix the bug ')).toEqual({ cmd: null, arg: 'fix the bug' }));
  it('path is not a command', () => expect(parseCommand('/usr/bin is weird').cmd).toBe(null));
});

describe('truncate/chunk', () => {
  it('short untouched', () => expect(truncate('abc', 10)).toEqual({ text: 'abc', truncated: false }));
  it('long truncated with head and tail', () => {
    const s = 'A'.repeat(500) + 'B'.repeat(500);
    const r = truncate(s, 200);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(260);
    expect(r.text.startsWith('A')).toBe(true);
    expect(r.text.endsWith('B')).toBe(true);
    expect(r.text).toContain('omitted');
  });
  it('chunk', () => expect(chunk('abcdefg', 3)).toEqual(['abc', 'def', 'g']));
  it('stripAnsi', () => expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red'));
});
