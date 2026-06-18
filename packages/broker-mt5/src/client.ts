import { lookup } from "node:dns/promises";
import { credentials } from "@grpc/grpc-js";
import { MT5Client } from "./generated/mt5.js";

export interface CreateClientOptions {
  host: string;
  port: number;
}

/**
 * Build the gRPC client, targeting an explicit IPv4 address for `host`.
 *
 * ECS Service Connect publishes BOTH an IPv4 (127.255.x.x loopback proxy) and
 * an IPv6 (2600:f0f0::/96) endpoint for each service name. Fargate tasks here
 * have no IPv6 route, so connecting to the IPv6 endpoint fails with
 * ENETUNREACH. grpc-js resolves names via c-ares resolve4/resolve6 and ignores
 * `--dns-result-order`, so `NODE_OPTIONS=--dns-result-order=ipv4first` does NOT
 * fix it. Resolving to IPv4 ourselves and handing grpc a literal address
 * sidesteps grpc-js's dual-stack resolution. `lookup` reads /etc/hosts (where
 * Service Connect injects the records) and returns IP literals unchanged, so
 * `127.0.0.1` in tests passes through untouched.
 */
export async function createMT5Client(opts: CreateClientOptions): Promise<MT5Client> {
  let target = `${opts.host}:${opts.port}`;
  try {
    const { address } = await lookup(opts.host, { family: 4 });
    target = `${address}:${opts.port}`;
  } catch {
    // No IPv4 record — fall back to the hostname and let grpc resolve it.
  }
  return new MT5Client(target, credentials.createInsecure());
}
