export default {
  name: 'echo',
  description: 'test plugin',
  buildInvocation: ({ prompt }) => ({ command: process.execPath, args: ['-e', 'console.log(process.argv[1])', prompt] }),
};
