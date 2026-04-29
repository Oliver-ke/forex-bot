import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlm } from "../src/anthropic-llm.js";

describe("AnthropicLlm", () => {
  it("constructs without contacting the API", () => {
    const llm = new AnthropicLlm({ apiKey: "sk-fake" });
    expect(llm).toBeInstanceOf(AnthropicLlm);
  });

  it("structured() returns a Promise<T> typed by the schema", () => {
    const llm = new AnthropicLlm({ apiKey: "sk-fake" });
    const Out = z.object({ x: z.number() });
    // Compile-time check only: the next line must type-check; no .then() so we don't fire.
    const _: () => Promise<{ x: number }> = () =>
      llm.structured({
        model: "claude-sonnet-4-6",
        system: "s",
        user: "u",
        schema: Out,
      });
    expect(_).toBeTypeOf("function");
  });
});
