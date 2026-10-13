import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { AgentAdapter } from './types.js';
import { BUILTIN_ADAPTERS, customAdapter } from './builtin.js';
import type { Config } from '../config.js';
import { expandHome } from '../config.js';

export function validateAdapter(a: unknown): a is AgentAdapter {
  const x = a as AgentAdapter;
  return !!x && typeof x.name === 'string' && /^[\w-]+$/.test(x.name) && typeof x.buildInvocation === 'function';
}

export async function loadPlugin(spec: string, config: unknown, baseDir = process.cwd()): Promise<AgentAdapter[]> {
  const isPath = /^[.~/]|^[a-zA-Z]:[\\/]|\.(c|m)?js$/.test(spec);
  let url: string;
  if (isPath) url = pathToFileURL(path.resolve(baseDir, expandHome(spec))).href;
  else url = pathToFileURL(createRequire(path.join(baseDir, 'noop.js')).resolve(spec)).href;
  const mod = await import(url);
  let exp: any = mod.adapters ?? mod.default ?? mod;
  if (exp && exp.default && !validateAdapter(exp) && !Array.isArray(exp)) exp = exp.default; // CJS interop
  if (typeof exp === 'function') exp = exp({ config });
  const list = Array.isArray(exp) ? exp : [exp];
  for (const a of list) if (!validateAdapter(a)) throw new Error(`plugin ${spec}: export is not a valid AgentAdapter (needs name + buildInvocation)`);
  return list;
}

export class AgentRegistry {
  private map = new Map<string, AgentAdapter>();
  errors: string[] = [];
  register(a: AgentAdapter) { this.map.set(a.name, a); }
  get(name: string) { return this.map.get(name); }
  list() { return [...this.map.values()]; }

  static async fromConfig(cfg: Config, baseDir?: string): Promise<AgentRegistry> {
    const r = new AgentRegistry();
    BUILTIN_ADAPTERS.forEach((a) => r.register(a));
    for (const [n, c] of Object.entries(cfg.customAgents ?? {})) r.register(customAdapter(n, c));
    for (const p of cfg.plugins ?? []) {
      try { (await loadPlugin(p, cfg, baseDir)).forEach((a) => r.register(a)); }
      catch (e) { r.errors.push(`${p}: ${(e as Error).message}`); }
    }
    return r;
  }
}
