import type { LlmProvider } from "./provider.js";
import { LlmValidationError, type StructuredRequest } from "./types.js";

export interface FakeLlmOptions {
  /** Maps each request to an unvalidated response object. */
  route: (req: StructuredRequest<unknown>) => unknown;
}

export interface FakeLlmCall {
  model: string;
  system: string;
  user: string;
}

export class FakeLlm implements LlmProvider {
  readonly calls: FakeLlmCall[] = [];
  private readonly opts: FakeLlmOptions;

  constructor(opts: FakeLlmOptions) {
    this.opts = opts;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.calls.push({ model: req.model, system: req.system, user: req.user });
    const raw = this.opts.route(req as StructuredRequest<unknown>);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmValidationError(
        `FakeLlm response failed schema: ${parsed.error.message}`,
        1,
        raw,
      );
    }
    return parsed.data;
  }
}
