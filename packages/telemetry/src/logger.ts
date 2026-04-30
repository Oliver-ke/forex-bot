export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  ts: number;
  msg: string;
  fields?: Record<string, unknown>;
}

export interface LoggerOptions {
  /** Defaults to `console`. Override in tests to capture output. */
  out?: (entry: LogEntry) => void;
  /** Static fields merged into every entry (e.g. service name). */
  base?: Record<string, unknown>;
  /** Defaults to `Date.now`. Override for deterministic tests. */
  now?: () => number;
}

function defaultOut(entry: LogEntry): void {
  const stream =
    entry.level === "error" || entry.level === "warn" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(entry)}\n`);
}

export class Logger {
  private readonly out: (entry: LogEntry) => void;
  private readonly base: Record<string, unknown>;
  private readonly now: () => number;

  constructor(opts: LoggerOptions = {}) {
    this.out = opts.out ?? defaultOut;
    this.base = opts.base ?? {};
    this.now = opts.now ?? Date.now;
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit("info", msg, fields);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit("warn", msg, fields);
  }

  error(msg: string, fields?: Record<string, unknown>): void {
    this.emit("error", msg, fields);
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    const merged =
      Object.keys(this.base).length === 0 && !fields
        ? undefined
        : { ...this.base, ...(fields ?? {}) };
    const entry: LogEntry = merged
      ? { level, ts: this.now(), msg, fields: merged }
      : { level, ts: this.now(), msg };
    this.out(entry);
  }
}
