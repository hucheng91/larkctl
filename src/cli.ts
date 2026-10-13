#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { configDir, configPath, defaultConfig, loadConfig, redact, type Config } from './config.js';
import { Bot } from './bot.js';
import { AgentRegistry } from './agents/registry.js';
import { AuditLog } from './audit.js';
import { MockTransport } from './mock.js';
import { takeScreenshot } from './screenshot.js';
import { runInit } from './init.js';

export const VERSION = '0.1.0';
const log = (s: string) => console.log(`[larkctl ${new Date().toISOString()}] ${s}`);

function usage() {
  console.log(`larkctl ${VERSION} — control your computer & coding agents from Feishu/Lark

Usage:
  larkctl init                 interactive config (${configPath()})
  larkctl start                connect to Feishu/Lark (long connection) and serve
  larkctl start --daemon       same, detached in background (logs in config dir)
  larkctl start --mock [--as <open_id>]  local fake chat: stdin lines are messages
  larkctl stop                 stop the background daemon
  larkctl config               print config (secret redacted)
  larkctl --version`);
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flag = (f: string) => rest.includes(f);
  const opt = (f: string) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
  const dir = configDir();
  const pidFile = path.join(dir, 'larkctl.pid');
  switch (cmd) {
    case 'init': await runInit(); return;
    case 'config': console.log(JSON.stringify(redact(loadConfig()), null, 2)); return;
    case '-v': case '--version': case 'version': console.log(VERSION); return;
    case 'stop': {
      if (!fs.existsSync(pidFile)) { console.log('no daemon pid file'); return; }
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      try { process.kill(pid); console.log(`stopped ${pid}`); } catch (e) { console.log(`could not stop ${pid}: ${(e as Error).message}`); }
      fs.rmSync(pidFile, { force: true });
      return;
    }
    case 'start': {
      const mock = flag('--mock');
      if (flag('--daemon') && !mock) {
        fs.mkdirSync(dir, { recursive: true });
        const out = fs.openSync(path.join(dir, 'larkctl.log'), 'a');
        const child = spawn(process.execPath, [process.argv[1], 'start'], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
        fs.writeFileSync(pidFile, String(child.pid));
        child.unref();
        console.log(`larkctl daemon started (pid ${child.pid}); log: ${path.join(dir, 'larkctl.log')}`);
        return;
      }
      let cfg: Config;
      if (fs.existsSync(configPath())) cfg = loadConfig();
      else if (mock) cfg = defaultConfig();
      else { console.error(`No config at ${configPath()}. Run: npx larkctl init`); process.exitCode = 1; return; }
      const agents = await AgentRegistry.fromConfig(cfg, dir);
      agents.errors.forEach((e) => log(`plugin load error: ${e}`));
      const audit = new AuditLog(path.join(dir, 'audit.log'));
      if (mock) await runMock(cfg, agents, audit, opt('--as'));
      else await runReal(cfg, agents, audit, dir);
      return;
    }
    default: usage();
  }
}

async function runReal(cfg: Config, agents: AgentRegistry, audit: AuditLog, dir: string) {
  if (!cfg.appId || !cfg.appSecret) throw new Error('appId/appSecret missing; run `larkctl init`');
  if (!cfg.allowUsers.length) log('WARNING: allowlist is empty — every request will be denied. Send /whoami to the bot to get your open_id, then run `larkctl init`.');
  const { startLark } = await import('./lark.js');
  const holder: { bot?: Bot } = {};
  const { transport } = await startLark(cfg, (m) => { void holder.bot?.handle(m).catch((e) => log(`handler error: ${(e as Error).message}`)); }, log);
  holder.bot = new Bot({ config: cfg, transport, agents, audit, statePath: path.join(dir, 'state.json'), screenshot: takeScreenshot });
  log(`serving (${cfg.domain}, app ${cfg.appId}, ${cfg.allowUsers.length} allowed users, read-only=${cfg.readOnly}, agents: ${agents.list().map((a) => a.name).join(',')})`);
}

async function runMock(cfg: Config, agents: AgentRegistry, audit: AuditLog, as?: string) {
  const me = as ?? cfg.allowUsers[0] ?? 'ou_mock_user';
  if (!as && !cfg.allowUsers.length) cfg.allowUsers = [me];
  const t = new MockTransport();
  const bot = new Bot({ config: cfg, transport: t, agents, audit, statePath: null, screenshot: takeScreenshot });
  log(`MOCK mode: you are ${me} in p2p chat oc_mock. Type messages (/help). Ctrl-D to quit.`);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let n = 0;
  const inflight: Promise<void>[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    console.log(`\n» ${line}`);
    inflight.push(bot.handle({ messageId: `om_in_${++n}`, chatId: 'oc_mock', chatType: 'p2p', senderOpenId: me, text: line }).catch((e) => log(String(e))));
    await new Promise((r) => setTimeout(r, 50));
  }
  await Promise.all(inflight);
}

main(process.argv.slice(2)).catch((e) => { console.error(`larkctl: ${(e as Error).message}`); process.exit(1); });
