import type { ZodSchema } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface StructuredRequest<T> {
  /** Model id, e.g. "claude-opus-4-7" or "claude-sonnet-4-6". */
  model: string;
  /** System prompt — long stable content; cached when supported. */
  system: string;
  /** Per-tick user message — short, varying. Goes after the cache breakpoint. */
  user: string;
  /** Zod schema the response is validated against. Errors trigger one retry. */
  schema: ZodSchema<T>;
  /** Default "adaptive". Use "disabled" for pure-throughput nodes. */
  thinking?: "adaptive" | "disabled";
  /** Default "high". Set "xhigh"/"max" for Opus-tier tasks. */
  effort?: Effort;
  /** Default 16_000. Streamed transparently when above 16k. */
  maxTokens?: number;
  /** Default true; turn off for tiny/non-stable system prompts (< 1024 tokens). */
  cacheSystem?: boolean;
  /** Telemetry hook: surfaces token usage + cache hit/miss. */
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export class LlmValidationError extends Error {
  readonly code = "validation" as const;
  constructor(
    message: string,
    public readonly attemptCount: number,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = "LlmValidationError";
  }
}

export class LlmTransportError extends Error {
  readonly code = "transport" as const;
  constructor(message: string) {
    super(message);
    this.name = "LlmTransportError";
  }
}

export class LlmRefusalError extends Error {
  readonly code = "refusal" as const;
  constructor(message: string) {
    super(message);
    this.name = "LlmRefusalError";
  }
}
