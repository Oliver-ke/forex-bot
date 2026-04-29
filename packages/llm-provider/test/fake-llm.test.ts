import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLlm, LlmValidationError } from "../src/index.js";

const Out = z.object({ bias: z.enum(["long", "short"]), conviction: z.number() });

describe("FakeLlm", () => {
  it("dispatches by routing function and validates the response", async () => {
    const llm = new FakeLlm({
      route: (req) => {
        if (req.system.includes("technical")) return { bias: "long", conviction: 0.7 };
        return { bias: "short", conviction: 0.3 };
      },
    });
    const out = await llm.structured({
      model: "claude-sonnet-4-6",
      system: "You are a technical analyst.",
      user: "EURUSD H1.",
      schema: Out,
    });
    expect(out.bias).toBe("long");
  });

  it("throws LlmValidationError when the routed value fails schema", async () => {
    const llm = new FakeLlm({ route: () => ({ bias: "sideways", conviction: 0.5 }) });
    await expect(
      llm.structured({
        model: "claude-sonnet-4-6",
        system: "x",
        user: "y",
        schema: Out,
      }),
    ).rejects.toBeInstanceOf(LlmValidationError);
  });

  it("records call history for per-test assertions", async () => {
    const llm = new FakeLlm({ route: () => ({ bias: "long", conviction: 0.9 }) });
    await llm.structured({ model: "claude-opus-4-7", system: "s", user: "u", schema: Out });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.model).toBe("claude-opus-4-7");
  });
});
