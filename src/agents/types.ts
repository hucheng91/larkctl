/**
 * Agent adapter plugin interface.
 *
 * A coding agent adapter turns "send this prompt in this working dir (optionally
 * continuing session X)" into a child process, and turns that process's stdout
 * lines into events. larkctl takes care of spawning, timeouts, /stop, progress
 * updates and replying to Feishu.
 */
export type AgentEvent =
  | { type: 'session'; id: string } // session/thread id to resume later
  | { type: 'text'; text: string } // assistant text (accumulated as the final answer)
  | { type: 'progress'; text: string } // tool call / status line (shown in the progress card)
  | { type: 'error'; text: string };

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  /** Session id from a previous run in this chat (if any) -> continue that conversation. */
  sessionId?: string;
  /** Extra user-configured args (config.agentArgs[name]). */
  extraArgs?: string[];
  /** Local image files attached by the user (paths are also listed in the prompt). */
  images?: string[];
  /** Write-permission level: 'read-only' (larkctl readOnly), 'workspace-write' (edit files in cwd, default) or 'full' (no sandbox). */
  access?: AgentAccess;
}

export type AgentAccess = 'read-only' | 'workspace-write' | 'full';

export interface AgentInvocation {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** If set, written to the child's stdin. */
  stdin?: string;
}

export interface AgentAdapter {
  /** Short name used in `/agent <name>`. */
  name: string;
  description?: string;
  /** Build the process invocation. Must be pure (unit-testable). */
  buildInvocation(opts: AgentRunOptions): AgentInvocation;
  /** Parse one stdout line into zero or more events. Default: each line is text. */
  parseLine?(line: string): AgentEvent[];
  /** Optional: compute the final answer from all output if no text events were produced. */
  finalize?(rawOutput: string): string;
}

/** What a plugin module must export: `default` or `adapters`, an adapter, an array, or a factory. */
export type AdapterModule =
  | AgentAdapter
  | AgentAdapter[]
  | ((ctx: { config: unknown }) => AgentAdapter | AgentAdapter[]);
