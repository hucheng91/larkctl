export const adapters = ({ config }) => [
  { name: 'aider', buildInvocation: ({ prompt }) => ({ command: 'aider', args: ['--message', prompt, '--yes'] }) },
  { name: 'gemini', buildInvocation: ({ prompt }) => ({ command: 'gemini', args: ['-p', prompt], env: { X: String(!!config) } }) },
];
