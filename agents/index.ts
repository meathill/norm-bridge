import { MockAgentRunner } from './mock-agent-runner';
import { OpenAiAgentRunner } from './openai-agent-runner';
import type { AgentRunner } from './agent-runner';

/**
 * Production resolver. Always returns the OpenAI-backed runner; missing config
 * is surfaced at compile time as MissingOpenAiConfigError. Tests inject
 * MockAgentRunner directly into SchemaCompileService.
 */
export function resolveAgentRunner(): AgentRunner {
  return new OpenAiAgentRunner();
}

export { MockAgentRunner, OpenAiAgentRunner };
export type { AgentRunner };
export type {
  AgentCompileCallbacks,
  AgentCompileContext,
  AgentCompileResult,
  AgentLogLevel,
} from './agent-runner';
