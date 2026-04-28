import { credentials } from "@grpc/grpc-js";
import { MT5Client } from "./generated/mt5.js";

export interface CreateClientOptions {
  host: string;
  port: number;
}

export function createMT5Client(opts: CreateClientOptions): MT5Client {
  return new MT5Client(`${opts.host}:${opts.port}`, credentials.createInsecure());
}
