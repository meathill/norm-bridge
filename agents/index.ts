import { MockAgentRunner } from './mock-agent-runner';
import { OpenAiAgentRunner } from './openai-agent-runner';
import type { AgentRunner } from './agent-runner';

export type AgentRunnerKind = 'mock' | 'openai';

export function resolveAgentRunner(kindHint?: AgentRunnerKind): AgentRunner {
  const requested =
    kindHint ?? (process.env['NORMBRIDGE_AGENT_RUNNER'] as AgentRunnerKind | undefined) ?? null;
  // Default: use OpenAI when we have a key, fall back to mock otherwise.
  const auto: AgentRunnerKind = process.env['OPENAI_API_KEY'] ? 'openai' : 'mock';
  const kind = requested ?? auto;
  switch (kind) {
    case 'openai':
      return new OpenAiAgentRunner();
    case 'mock':
      return new MockAgentRunner();
    default:
      throw new Error(`Unknown agent runner kind: ${kind}`);
  }
}

export { MockAgentRunner, OpenAiAgentRunner };
export type { AgentRunner };
export type {
  AgentCompileCallbacks,
  AgentCompileContext,
  AgentCompileResult,
  AgentLogLevel,
} from './agent-runner';
