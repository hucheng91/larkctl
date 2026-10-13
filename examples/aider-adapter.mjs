// Example third-party adapter for larkctl. Add to config.json:
//   "plugins": ["/path/to/aider-adapter.mjs"]   (or an npm package name)
// then in chat: /agent aider
/** @type {import('larkctl').AgentAdapter} */
export default {
  name: 'aider',
  description: 'Aider (aider --message)',
  buildInvocation({ prompt, extraArgs = [] }) {
    return { command: 'aider', args: ['--message', prompt, '--yes-always', '--no-pretty', ...extraArgs] };
  },
  // parseLine is optional; without it every stdout line is treated as answer text.
  parseLine(line) {
    if (!line.trim()) return [];
    if (/^(Applied edit|Commit) /.test(line)) return [{ type: 'progress', text: line }];
    return [{ type: 'text', text: line }];
  },
};
