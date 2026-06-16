import Anthropic from "@anthropic-ai/sdk";
import {
  type JSONSchema,
  transformJSONSchema,
} from "@anthropic-ai/sdk/lib/transform-json-schema.js";
import type { ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmProvider } from "./provider.js";
import {
  LlmRefusalError,
  LlmTransportError,
  LlmValidationError,
  type StructuredRequest,
} from "./types.js";

export interface AnthropicLlmOptions {
  /** Pass-through to the SDK. Defaults to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Defaults to 1 — one retry on Zod failure, then throw. */
  maxValidationRetries?: number;
}

interface MessageUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface ParsedMessageResponse {
  stop_reason: string | null;
  usage: MessageUsage;
  parsed_output: unknown;
  content: unknown;
}

/**
 * Build an Anthropic `json_schema` output format from a Zod v3 schema.
 *
 * Mirrors the SDK's `zodOutputFormat`, but that helper imports `zod/v4` and
 * calls `z.toJSONSchema`, which throws `Cannot read properties of undefined
 * (reading 'def')` on our zod v3 schemas (v3 keeps its internals under `._def`,
 * v4 under `.def`). We build the JSON schema with `zod-to-json-schema` (v3),
 * run it through the SDK's own `transformJSONSchema` for Anthropic
 * compatibility, and validate the response with the v3 schema. `messages.parse`
 * calls `format.parse(content)` to populate `parsed_output`.
 */
function zodV3OutputFormat<T>(schema: ZodSchema<T>) {
  const jsonSchema = transformJSONSchema(zodToJsonSchema(schema) as JSONSchema);
  return {
    type: "json_schema" as const,
    schema: jsonSchema,
    parse: (content: string): T => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse structured output as JSON: ${msg}`);
      }
      const out = schema.safeParse(parsed);
      if (!out.success) {
        throw new Error(`structured output failed schema validation: ${out.error.message}`);
      }
      return out.data;
    },
  };
}

export class AnthropicLlm implements LlmProvider {
  private readonly client: Anthropic;
  private readonly maxValidationRetries: number;

  constructor(opts: AnthropicLlmOptions = {}) {
    this.client = new Anthropic({ ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) });
    this.maxValidationRetries = opts.maxValidationRetries ?? 1;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const cacheSystem = req.cacheSystem ?? true;
    const thinking = req.thinking ?? "adaptive";
    const effort = req.effort ?? "high";
    const maxTokens = req.maxTokens ?? 16_000;

    let lastRaw: unknown = undefined;
    for (let attempt = 0; attempt <= this.maxValidationRetries; attempt++) {
      let response: ParsedMessageResponse;
      try {
        response = (await this.client.messages.parse({
          model: req.model,
          max_tokens: maxTokens,
          system: cacheSystem
            ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }]
            : req.system,
          messages: [{ role: "user", content: req.user }],
          ...(thinking === "adaptive"
            ? { thinking: { type: "adaptive" } }
            : { thinking: { type: "disabled" } }),
          output_config: {
            effort,
            format: zodV3OutputFormat(req.schema),
            // biome-ignore lint/suspicious/noExplicitAny: SDK types lag public API for output_config
          } as any,
          // biome-ignore lint/suspicious/noExplicitAny: see above
        } as any)) as unknown as ParsedMessageResponse;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new LlmTransportError(msg);
      }

      if (response.stop_reason === "refusal") {
        throw new LlmRefusalError("model refused to respond");
      }

      req.onUsage?.({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      });

      const parsed = response.parsed_output as T | null;
      if (parsed !== null && parsed !== undefined) return parsed;

      lastRaw = response.content;
    }
    throw new LlmValidationError(
      "Anthropic structured output failed validation after retries",
      this.maxValidationRetries + 1,
      lastRaw,
    );
  }
}
