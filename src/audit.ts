import fs from 'node:fs';
import path from 'node:path';

export class AuditLog {
  constructor(private file: string | null) {
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  write(entry: Record<string, unknown>): void {
    if (!this.file) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    try { fs.appendFileSync(this.file, line, { mode: 0o600 }); } catch { /* ignore */ }
  }
}
