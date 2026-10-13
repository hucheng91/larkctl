import type { Config } from './config.js';

export interface Sender { openId: string; chatId: string; chatType: string }

export function isAllowed(cfg: Pick<Config, 'allowUsers' | 'allowChats' | 'allowAnyUserInAllowedChats'>, s: Sender): boolean {
  const userOk = !!s.openId && cfg.allowUsers.includes(s.openId);
  if (s.chatType === 'p2p') return userOk;
  // group: chat must be allowlisted, and the user too (unless explicitly relaxed)
  if (!cfg.allowChats.includes(s.chatId)) return false;
  return userOk || cfg.allowAnyUserInAllowedChats;
}

export const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive|-r\b|-R\b)/i,
  /\brm\s+.*--no-preserve-root/i,
  /\bsudo\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+.*\bof=/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\binit\s+[06]\b/,
  /\bformat(\.com)?\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bdel\s+.*\/[sq]\b/i,
  /\b(rd|rmdir)\s+.*\/s\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\b(Stop-Computer|Restart-Computer|Format-Volume|Clear-Disk)\b/i,
  /\bchmod\s+(-R\s+)?[0-7]*777\s+\//,
  /\bchown\s+-R\b/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  />\s*\/dev\/(sd[a-z]|disk\d|nvme)/,
  /\bgit\s+(push\s+.*(--force|-f)\b|reset\s+--hard|clean\s+-[a-z]*f)/i,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(sh|bash|zsh|iex|Invoke-Expression)\b/i,
  /\bkillall\b|\bpkill\b|\btaskkill\b/i,
  /\breg\s+delete\b/i,
  /\blaunchctl\s+(unload|remove|bootout)\b/i,
];

export function isDangerous(cmd: string, extra: string[] = []): string | null {
  for (const re of [...DANGEROUS_PATTERNS, ...extra.map((s) => new RegExp(s, 'i'))]) {
    if (re.test(cmd)) return re.source;
  }
  return null;
}

/** Commands considered safe in read-only mode (best effort, first word). */
const READONLY_OK = new Set(['ls', 'dir', 'pwd', 'cat', 'type', 'head', 'tail', 'git', 'whoami', 'uname', 'df', 'du', 'ps', 'top', 'uptime', 'echo', 'date', 'Get-ChildItem', 'Get-Content', 'Get-Process', 'Get-Location', 'wc', 'grep', 'rg', 'find', 'which', 'where', 'tree', 'hostname', 'free', 'node', 'npm']);
const READONLY_GIT = /^git\s+(status|log|diff|show|branch|remote|rev-parse)\b/;

export function readOnlyAllows(cmd: string): boolean {
  const c = cmd.trim();
  if (/[;&|>`]|\$\(/.test(c)) return false; // no chaining / redirection
  const first = c.split(/\s+/)[0] ?? '';
  if (first === 'git') return READONLY_GIT.test(c);
  if (first === 'node' || first === 'npm') return /^(node|npm)\s+(-v|--version)$/.test(c);
  return READONLY_OK.has(first);
}

export function genCode(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
}
