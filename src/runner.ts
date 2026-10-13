import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface RunResult { code: number | null; output: string; timedOut: boolean; killed: boolean; durationMs: number }

export interface Job {
  child: ChildProcess;
  done: Promise<RunResult>;
  stop(): void;
}

export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
  }
}

export interface SpawnSpec { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; stdin?: string; timeoutMs: number; onData?: (chunk: string) => void }

export function runProcess(spec: SpawnSpec): Job {
  const start = Date.now();
  const opts: SpawnOptions = {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  const child = spawn(spec.command, spec.args, opts);
  let output = '';
  let timedOut = false;
  let killed = false;
  const MAX = 5_000_000;
  const onData = (b: Buffer) => {
    const s = b.toString('utf8');
    if (output.length < MAX) output += s;
    spec.onData?.(s);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  if (spec.stdin !== undefined) child.stdin?.end(spec.stdin); else child.stdin?.end();
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, spec.timeoutMs);
  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (e) => { output += `\n[spawn error] ${e.message}`; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut, killed, durationMs: Date.now() - start });
    });
  });
  return { child, done, stop: () => { killed = true; killTree(child); } };
}

/** Platform shell invocation for a command line. */
export function shellInvocation(cmd: string, platform = process.platform, env = process.env): { command: string; args: string[] } {
  if (platform === 'win32') {
    return { command: env.LARKCTL_SHELL || 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', cmd] };
  }
  const sh = env.LARKCTL_SHELL || env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { command: sh, args: ['-lc', cmd] };
}

export function runShell(cmd: string, cwd: string, timeoutMs: number, onData?: (s: string) => void): Job {
  const inv = shellInvocation(cmd);
  return runProcess({ ...inv, cwd, timeoutMs, onData });
}
