import { MT5Broker, createMT5Client } from "@forex-bot/broker-mt5";
import { RedisHotCache } from "@forex-bot/cache";
import { type Symbol, defaultRiskConfig } from "@forex-bot/contracts";
import { AnthropicLlm } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { Logger } from "@forex-bot/telemetry";
import { tick } from "./tick.js";
import { detectTriggers } from "./triggers.js";

interface RuntimeConfig {
  mt5Host: string;
  mt5Port: number;
  redisUrl: string;
  redisNamespace: string;
  anthropicApiKey: string;
  watchedSymbols: readonly Symbol[];
  pollMs: number;
}

function readConfig(): RuntimeConfig {
  const required = ["MT5_HOST", "MT5_PORT", "REDIS_URL", "ANTHROPIC_API_KEY", "WATCHED_SYMBOLS"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`missing env var: ${key}`);
  }
  const symbols = (process.env.WATCHED_SYMBOLS as string)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as Symbol[];
  return {
    mt5Host: process.env.MT5_HOST as string,
    mt5Port: Number(process.env.MT5_PORT),
    redisUrl: process.env.REDIS_URL as string,
    redisNamespace: process.env.REDIS_NAMESPACE ?? "forex-bot",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY as string,
    watchedSymbols: symbols,
    pollMs: Number(process.env.POLL_MS ?? 60_000),
  };
}

function buildGateContext(now: number, account: GateContext["account"]): GateContext {
  return {
    now,
    order: {
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      entry: 1.08,
      sl: 1.075,
      tp: 1.0875,
      expiresAt: now + 5 * 60_000,
    },
    account,
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: 30,
    session: "london",
    upcomingEvents: [],
    correlation: new CorrelationMatrix({}),
    killSwitch: new KillSwitch(),
    consecutiveLosses: 0,
    dailyPnlPct: 0,
    totalDdPct: 0,
    feedAgeSec: 1,
    currencyExposurePct: {},
    affectedCurrencies: (s) => [s.slice(0, 3), s.slice(3)],
    pipValuePerLot: () => 10,
  };
}

export async function main(): Promise<void> {
  const cfg = readConfig();
  const log = new Logger({ base: { service: "agent-runner" } });

  const isDemo = process.env.MT5_DEMO === "1";
  const broker = new MT5Broker(createMT5Client({ host: cfg.mt5Host, port: cfg.mt5Port }), isDemo);
  const cache = new RedisHotCache({ url: cfg.redisUrl, namespace: cfg.redisNamespace });
  await cache.connect();
  const llm = new AnthropicLlm({ apiKey: cfg.anthropicApiKey });

  log.info("agent-runner started", {
    symbols: cfg.watchedSymbols,
    pollMs: cfg.pollMs,
  });

  let lastTickedMs = Date.now();
  let lastRebalanceMs = Date.now();

  while (true) {
    const now = Date.now();
    for (const symbol of cfg.watchedSymbols) {
      try {
        const candlesH1 = await broker.getCandles(symbol, "H1", 200);
        const calendar = await cache.getCalendarWindow();
        const triggers = detectTriggers({
          nowMs: now,
          lastTickedMs,
          candlesByTf: { H1: candlesH1 },
          upcomingEvents: calendar,
          lastRebalanceMs,
        });
        if (triggers.length === 0) continue;

        const account = await broker.getAccount();
        const trigger = triggers[0];
        if (!trigger) continue;
        const result = await tick({
          broker,
          cache,
          llm,
          symbol,
          ts: now,
          trigger,
          consensusThreshold: defaultRiskConfig.agent.consensusThreshold,
          buildGateContext: () => buildGateContext(now, account),
        });
        log.info("tick complete", {
          symbol,
          trigger: trigger.reason,
          approved: result.decision.approve,
        });
        if (triggers.some((t) => t.reason === "rebalance")) lastRebalanceMs = now;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error("tick failed", { symbol, err: msg });
      }
    }
    lastTickedMs = now;
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
