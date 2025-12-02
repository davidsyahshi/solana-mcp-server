import { clusterApiUrl, Connection, PublicKey, type Commitment } from "@solana/web3.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const DEFAULT_RPC_URL = clusterApiUrl("devnet");

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export type ClusterName = "devnet" | "testnet" | "mainnet-beta" | "localnet" | "custom";

/** Empty strings (e.g. `SOLANA_RPC_URL=` in a .env file) mean "use the default". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envSchema = z.object({
  SOLANA_RPC_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .refine(isHttpUrl, { message: "must be a valid http:// or https:// URL" })
      .optional(),
  ),
  SOLANA_COMMITMENT: z.preprocess(
    emptyToUndefined,
    z.enum(["processed", "confirmed", "finalized"]).default("confirmed"),
  ),
  SOLANA_REQUEST_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  ),
});

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export interface SolanaConfig {
  readonly rpcUrl: string;
  readonly cluster: ClusterName;
  readonly commitment: Commitment;
  readonly requestTimeoutMs: number;
}

export interface ToolContext {
  readonly connection: Connection;
  readonly config: SolanaConfig;
}

/** Reads and validates environment variables. Defaults to Solana devnet. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SolanaConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }

  const rpcUrl = parsed.data.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  return {
    rpcUrl,
    cluster: detectCluster(rpcUrl),
    commitment: parsed.data.SOLANA_COMMITMENT,
    requestTimeoutMs: parsed.data.SOLANA_REQUEST_TIMEOUT_MS,
  };
}

export function detectCluster(rpcUrl: string): ClusterName {
  let host: string;
  try {
    host = new URL(rpcUrl).hostname.toLowerCase();
  } catch {
    return "custom";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return "localnet";
  }
  if (host.includes("devnet")) {
    return "devnet";
  }
  if (host.includes("testnet")) {
    return "testnet";
  }
  if (host.includes("mainnet")) {
    return "mainnet-beta";
  }
  return "custom";
}

export function createConnection(config: SolanaConfig): Connection {
  return new Connection(config.rpcUrl, {
    commitment: config.commitment,
    fetch: (input, init) =>
      globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(config.requestTimeoutMs) }),
  });
}

/** Commitment levels accepted by finality-only RPC methods (getTransaction etc.). */
export function toFinality(commitment: Commitment): "confirmed" | "finalized" {
  return commitment === "finalized" ? "finalized" : "confirmed";
}

/** Converts a lamport amount to an exact decimal SOL string, e.g. 1500000000n -> "1.5". */
export function lamportsToSol(lamports: bigint | number): string {
  const value = typeof lamports === "bigint" ? lamports : BigInt(lamports);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000_000n;
  const fraction = (absolute % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function toBigInt(value: bigint | number | null | undefined): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  return typeof value === "bigint" ? value : BigInt(value);
}

export function blockTimeToIso(blockTime: bigint | number | null | undefined): string | null {
  if (blockTime === null || blockTime === undefined) {
    return null;
  }
  return new Date(Number(blockTime) * 1000).toISOString();
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error, bigintReplacer);
  } catch {
    return "Unknown error";
  }
}

/** JSON replacer: small bigints become numbers, large ones become strings (no precision loss). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "bigint") {
    return value;
  }
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return value <= max && value >= -max ? Number(value) : value.toString();
}

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, bigintReplacer, 2) }],
  };
}

export function errorResult(toolName: string, error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${toolName} failed: ${toErrorMessage(error)}` }],
  };
}

/** Wraps a tool handler so that every thrown error becomes a readable MCP error result. */
export function safeHandler<Args>(
  toolName: string,
  handler: (args: Args) => Promise<unknown>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return jsonResult(await handler(args));
    } catch (error) {
      return errorResult(toolName, error);
    }
  };
}
