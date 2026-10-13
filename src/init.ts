import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import { defaultConfig, loadConfig, saveConfig, configPath, type Config } from './config.js';

export async function runInit(file = configPath()): Promise<Config> {
  const cfg = fs.existsSync(file) ? loadConfig(file) : defaultConfig();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, def: string) => ((await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim() || def);
  const askSecret = async (q: string, has: boolean) => {
    // mute echo for the secret
    const out = stdout as unknown as { write: (s: string) => boolean };
    const orig = out.write.bind(out);
    const p = rl.question(`${q}${has ? ' [keep existing]' : ''}: `);
    out.write = (s: string) => (s.includes(q) ? orig(s) : true);
    const v = (await p).trim();
    out.write = orig; orig('\n');
    return v;
  };
  console.log('larkctl setup — see README for creating the Feishu/Lark app.\n');
  cfg.domain = (await ask('Domain: feishu (feishu.cn) or lark (larksuite.com)', cfg.domain)) === 'lark' ? 'lark' : 'feishu';
  cfg.appId = await ask('App ID (cli_...)', cfg.appId);
  const sec = await askSecret('App Secret', !!cfg.appSecret);
  if (sec) cfg.appSecret = sec;
  console.log('\nTip: leave the allowlist empty now, run `larkctl start`, send /whoami to the bot, then re-run init.');
  const users = await ask('Allowed user open_ids (comma separated, ou_...)', cfg.allowUsers.join(','));
  cfg.allowUsers = users.split(',').map((s) => s.trim()).filter(Boolean);
  const chats = await ask('Allowed group chat_ids (comma separated, oc_..., optional)', cfg.allowChats.join(','));
  cfg.allowChats = chats.split(',').map((s) => s.trim()).filter(Boolean);
  cfg.defaultAgent = await ask('Default coding agent (codex/claude/opencode)', cfg.defaultAgent);
  cfg.defaultCwd = await ask('Default working directory', cfg.defaultCwd);
  cfg.readOnly = /^y/i.test(await ask('Read-only mode? (y/N)', cfg.readOnly ? 'y' : 'n'));
  rl.close();
  saveConfig(cfg, file);
  console.log(`\nSaved ${file} (mode 600). Next: npx larkctl start`);
  return cfg;
}
