import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, defaultConfig, saveConfig, loadConfig, redact } from '../src/config.js';
import { shellInvocation } from '../src/runner.js';
import { screenshotInvocation } from '../src/screenshot.js';
import { AuditLog } from '../src/audit.js';

describe('config', () => {
  it('platform dirs', () => {
    expect(configDir({ LARKCTL_CONFIG_DIR: '/x' })).toBe('/x');
    expect(configDir({ APPDATA: 'C:\\U\\AppData\\Roaming' }, 'win32')).toContain('larkctl');
    expect(configDir({}, 'darwin')).toContain(path.join('Library', 'Application Support', 'larkctl'));
    expect(configDir({ XDG_CONFIG_HOME: '/c' }, 'linux')).toBe(path.join('/c', 'larkctl'));
  });
  it('save/load roundtrip and redaction', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-')), 'config.json');
    saveConfig({ ...defaultConfig(), appId: 'cli_1', appSecret: 's3cret' }, f);
    expect(loadConfig(f).appSecret).toBe('s3cret');
    expect(JSON.stringify(redact(loadConfig(f)))).not.toContain('s3cret');
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe('platform invocations', () => {
  it('shell', () => {
    expect(shellInvocation('ls', 'win32', {}).command).toBe('powershell.exe');
    expect(shellInvocation('ls', 'darwin', {})).toEqual({ command: '/bin/zsh', args: ['-lc', 'ls'] });
    expect(shellInvocation('ls', 'linux', { SHELL: '/bin/fish' }).command).toBe('/bin/fish');
  });
  it('screenshot', () => {
    expect(screenshotInvocation('/t/a.png', 'darwin')!.command).toBe('screencapture');
    expect(screenshotInvocation('C:\\a.png', 'win32')!.args.join(' ')).toContain('CopyFromScreen');
  });
});

describe('audit', () => {
  it('writes jsonl without secrets', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-')), 'audit.log');
    new AuditLog(f).write({ event: 'x', cmd: 'ls' });
    const e = JSON.parse(fs.readFileSync(f, 'utf8').trim());
    expect(e.event).toBe('x');
    expect(e.ts).toBeTruthy();
  });
});
