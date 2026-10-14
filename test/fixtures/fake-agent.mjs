// Emits codex-style JSONL; echoes the prompt read from stdin or argv.
const input = process.argv.slice(2).join(' ');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const prompt = (Buffer.concat(chunks).toString() || input).trim();
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'thread.started', thread_id: 'thread-123' });
  out({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } });
  out({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', exit_code: 0 } });
  if (prompt.startsWith('mkimg')) {
    import('node:fs').then((fs) => { fs.writeFileSync('chart.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])); out({ type: 'item.completed', item: { type: 'agent_message', text: 'saved to `chart.png`' } }); });
    return;
  }
  if (prompt === 'sleep') { setTimeout(() => out({ type: 'item.completed', item: { type: 'agent_message', text: 'late' } }), 30000); return; }
  out({ type: 'item.completed', item: { type: 'agent_message', text: `echo: ${prompt} | resumed=${process.argv.includes('resume')}` } });
});
