import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './runner.js';

export function screenshotInvocation(file: string, platform = process.platform): { command: string; args: string[] } | null {
  if (platform === 'darwin') return { command: 'screencapture', args: ['-x', '-t', 'png', file] };
  if (platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save('${file.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`;
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', ps] };
  }
  if (platform === 'linux') return { command: 'sh', args: ['-c', `(command -v gnome-screenshot >/dev/null && gnome-screenshot -f "$0") || (command -v scrot >/dev/null && scrot -o "$0") || import -window root "$0"`, file] };
  return null;
}

export async function takeScreenshot(): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `larkctl-shot-${Date.now()}.png`);
  const inv = screenshotInvocation(file);
  if (!inv) throw new Error('screenshot not supported on this platform');
  const r = await runProcess({ ...inv, cwd: os.tmpdir(), timeoutMs: 20000 }).done;
  if (!fs.existsSync(file)) throw new Error(`screenshot failed (exit ${r.code}): ${r.output.slice(0, 300)}`);
  const buf = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return buf;
}
