import type { StructuredRequest } from "./types.js";

export interface LlmProvider {
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}
