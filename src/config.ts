import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Domain = 'feishu' | 'lark';

export interface CustomAgentConfig {
  /** Executable to run. */
  command: string;
  /** Args; `{prompt}`, `{cwd}`, `{session}` placeholders are substituted. */
  args: string[];
  /** Extra args appended when continuing a session (placeholders allowed). */
  resumeArgs?: string[];
  /** Pass the prompt on stdin instead of as an argument. */
  promptViaStdin?: boolean;
  /** How to parse stdout lines: reuse a built-in parser, or plain text (default). */
  parser?: 'text' | 'codex' | 'claude' | 'opencode';
}

export interface Config {
  appId: string;
  appSecret: string;
  domain: Domain;
  /** Allowed user open_ids (ou_...). */
  allowUsers: string[];
  /** Allowed group chat_ids (oc_...). Messages in these groups are still only accepted from allowUsers unless allowAnyUserInAllowedChats. */
  allowChats: string[];
  allowAnyUserInAllowedChats: boolean;
  /** Reply a refusal to unauthorized senders (otherwise stay silent). */
  replyToStrangers: boolean;
  readOnly: boolean;
  commandTimeoutSec: number;
  agentTimeoutSec: number;
  maxReplyChars: number;
  defaultAgent: string;
  defaultCwd: string;
  projects: Record<string, string>;
  customAgents: Record<string, CustomAgentConfig>;
  /** Third-party adapters: npm package names or paths to local .js/.mjs files. */
  plugins: string[];
  /** Extra CLI args per built-in agent, e.g. { codex: ["--full-auto"] }. */
  agentArgs: Record<string, string[]>;
  /** Extra regexes (strings) treated as dangerous. */
  extraDangerousPatterns: string[];
  progressIntervalSec: number;
}

export function defaultConfig(): Config {
  return {
    appId: '',
    appSecret: '',
    domain: 'feishu',
    allowUsers: [],
    allowChats: [],
    allowAnyUserInAllowedChats: false,
    replyToStrangers: false,
    readOnly: false,
    commandTimeoutSec: 120,
    agentTimeoutSec: 1800,
    maxReplyChars: 3500,
    defaultAgent: 'codex',
    defaultCwd: os.homedir(),
    projects: {},
    customAgents: {},
    plugins: [],
    agentArgs: {},
    extraDangerousPatterns: [],
    progressIntervalSec: 5,
  };
}

export function configDir(env = process.env, platform = process.platform): string {
  if (env.LARKCTL_CONFIG_DIR) return env.LARKCTL_CONFIG_DIR;
  const home = os.homedir();
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'larkctl');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'larkctl');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'larkctl');
}

export const configPath = (dir = configDir()) => path.join(dir, 'config.json');

export function loadConfig(file = configPath()): Config {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Config>;
  const cfg = { ...defaultConfig(), ...raw };
  if (process.env.LARKCTL_APP_SECRET) cfg.appSecret = process.env.LARKCTL_APP_SECRET;
  return cfg;
}

export function saveConfig(cfg: Config, file = configPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
}

/** Copy of config safe to print/log. */
export function redact(cfg: Config): Config {
  return { ...cfg, appSecret: cfg.appSecret ? '***' : '' };
}

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p;
}
