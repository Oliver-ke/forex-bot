export interface Tracer {
  traceRun<T>(name: string, fn: () => Promise<T>): Promise<T>;
  enabled: boolean;
}

const noopTracer: Tracer = {
  enabled: false,
  async traceRun<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};

export interface LangSmithOptions {
  /** Defaults to `process.env.LANGCHAIN_API_KEY`. */
  apiKey?: string;
  /** Project tag attached to traces. */
  project?: string;
}

/**
 * Returns a tracer that no-ops unless `LANGCHAIN_API_KEY` is set.
 * Real client wiring lands when the runtime needs it (Plan 6 telemetry rollout).
 */
export function makeTracer(opts: LangSmithOptions = {}): Tracer {
  const apiKey = opts.apiKey ?? process.env.LANGCHAIN_API_KEY;
  if (!apiKey) return noopTracer;
  return {
    enabled: true,
    async traceRun<T>(_name: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}
