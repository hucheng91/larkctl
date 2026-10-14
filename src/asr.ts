import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Run a command feeding `input` on stdin; resolve stdout. */
export function pipeThrough(cmd: string, args: string[], input: Buffer | null, timeoutMs = 120_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    child.on('error', (e) => { clearTimeout(t); reject(new Error(`${cmd}: ${e.message}`)); });
    child.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(Buffer.concat(out)); else reject(new Error(`${cmd} exit ${code}: ${err.trim().split('\n').slice(-2).join(' ')}`)); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? undefined);
  });
}

export const hasCommand = (c: string) => spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [c] : ['-c', `command -v "${c}"`], { stdio: 'ignore' }).status === 0;

/** Feishu voice (ogg/opus) -> 16 kHz mono 16-bit PCM via ffmpeg. */
export function toPcm16k(audio: Buffer): Promise<Buffer> {
  return pipeThrough('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', 'pipe:1'], audio);
}

export interface AsrOptions {
  mode: 'auto' | 'feishu' | 'whisper' | 'off';
  /** `{file}` is replaced with a 16k wav path; stdout is the text. */
  whisperCommand?: string;
  /** Feishu speech_to_text call: pcm -> text. */
  feishu?: (pcm: Buffer) => Promise<string>;
  /** Injection points for tests. */
  convert?: (audio: Buffer) => Promise<Buffer>;
  runWhisper?: (wavFile: string) => Promise<string>;
}

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function defaultWhisper(file: string, template?: string): Promise<string> {
  if (template) {
    const parts = template.split(/\s+/).filter(Boolean).map((p) => p.replace('{file}', file));
    return (await pipeThrough(parts[0], parts.slice(1), null, 300_000)).toString('utf8');
  }
  if (hasCommand('whisper-cli')) return (await pipeThrough('whisper-cli', ['-nt', '-l', 'auto', '-f', file], null, 300_000)).toString('utf8');
  if (hasCommand('whisper')) {
    const dir = path.dirname(file);
    await pipeThrough('whisper', [file, '--model', 'base', '--output_format', 'txt', '--output_dir', dir], null, 300_000);
    return fs.readFileSync(file.replace(/\.wav$/, '.txt'), 'utf8');
  }
  throw new Error('no local whisper found (install whisper.cpp `whisper-cli` or openai-whisper, or set whisperCommand)');
}

/** Transcribe a Feishu voice message. Throws one Error explaining every attempt that failed. */
export async function transcribeAudio(audio: Buffer, o: AsrOptions): Promise<string> {
  if (o.mode === 'off') throw new Error('语音识别已关闭 (asr: "off" in config)');
  const errors: string[] = [];
  let pcm: Buffer;
  try { pcm = await (o.convert ?? toPcm16k)(audio); }
  catch (e) { throw new Error(`audio conversion failed (is ffmpeg installed?): ${(e as Error).message}`); }
  if (o.mode !== 'whisper' && o.feishu) {
    try { return (await o.feishu(pcm)).trim(); }
    catch (e) {
      const ax = e as { response?: { data?: { code?: number; msg?: string } }; message: string };
      const d = ax.response?.data;
      const msg = d ? `${d.code} ${d.msg}` : ax.message;
      errors.push(`Feishu ASR: ${msg}${/99991672|99991679|permission|scope/i.test(msg) ? ' — enable scope speech_to_text:speech in the Feishu console' : ''}`);
    }
  }
  if (o.mode !== 'feishu') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'larkctl-asr-'));
    const file = path.join(dir, 'voice.wav');
    try {
      fs.writeFileSync(file, wav(pcm));
      return (await (o.runWhisper ?? ((f) => defaultWhisper(f, o.whisperCommand)))(file)).replace(/\[[\d:.\s\->]+\]/g, '').trim();
    } catch (e) { errors.push(`whisper: ${(e as Error).message}`); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  throw new Error(errors.join('\n') || 'no transcription backend');
}
