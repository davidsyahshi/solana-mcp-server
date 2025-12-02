import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  TokenBalance,
} from "@solana/web3.js";
import { z } from "zod";
import {
  blockTimeToIso,
  lamportsToSol,
  safeHandler,
  toBigInt,
  toFinality,
  type ToolContext,
} from "../solana.js";
import { signatureSchema } from "../validation.js";

const MAX_LOG_LINES = 50;

export interface SolChange {
  readonly account: string;
  readonly deltaLamports: string;
  readonly deltaSol: string;
}

export interface TokenChange {
  readonly owner: string | null;
  readonly mint: string;
  readonly delta: string;
  readonly decimals: number;
}

export interface InstructionSummary {
  readonly program: string;
  readonly programId: string;
  readonly type: string | null;
}

export interface TransactionSummary {
  readonly signature: string;
  readonly slot: string;
  readonly time: string | null;
  readonly status: "success" | "failed";
  readonly error: unknown;
  readonly feeLamports: string;
  readonly feeSol: string;
  readonly signers: readonly string[];
  readonly instructions: readonly InstructionSummary[];
  readonly solChanges: readonly SolChange[];
  readonly tokenChanges: readonly TokenChange[];
  readonly logs?: readonly string[];
}

function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

function instructionType(ix: ParsedInstruction): string | null {
  const parsed: unknown = ix.parsed;
  if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
    const type = (parsed as { type: unknown }).type;
    return typeof type === "string" ? type : null;
  }
  return null;
}

function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  if (decimals === 0) {
    return `${negative ? "-" : ""}${absolute.toString()}`;
  }
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

function tokenBalanceKey(balance: TokenBalance): string {
  return `${balance.accountIndex}:${balance.mint}`;
}

/** Computes per-owner token deltas from pre/post token balances. */
export function computeTokenChanges(
  pre: readonly TokenBalance[],
  post: readonly TokenBalance[],
): TokenChange[] {
  const entries = new Map<string, { owner: string | null; mint: string; decimals: number; pre: bigint; post: bigint }>();

  for (const balance of pre) {
    entries.set(tokenBalanceKey(balance), {
      owner: balance.owner ?? null,
      mint: balance.mint,
      decimals: balance.uiTokenAmount.decimals,
      pre: BigInt(balance.uiTokenAmount.amount),
      post: 0n,
    });
  }
  for (const balance of post) {
    const key = tokenBalanceKey(balance);
    const existing = entries.get(key);
    const amount = BigInt(balance.uiTokenAmount.amount);
    if (existing === undefined) {
      entries.set(key, {
        owner: balance.owner ?? null,
        mint: balance.mint,
        decimals: balance.uiTokenAmount.decimals,
        pre: 0n,
        post: amount,
      });
    } else {
      existing.post = amount;
      existing.owner = existing.owner ?? balance.owner ?? null;
    }
  }

  const changes: TokenChange[] = [];
  for (const entry of entries.values()) {
    const delta = entry.post - entry.pre;
    if (delta !== 0n) {
      changes.push({
        owner: entry.owner,
        mint: entry.mint,
        delta: formatUnits(delta, entry.decimals),
        decimals: entry.decimals,
      });
    }
  }
  return changes;
}

/** Turns a full parsed transaction into a compact, LLM-friendly summary. */
export function summarizeTransaction(
  signature: string,
  tx: ParsedTransactionWithMeta,
  includeLogs: boolean,
): TransactionSummary {
  const { message } = tx.transaction;
  const meta = tx.meta;
  const accountKeys = message.accountKeys;

  const solChanges: SolChange[] = [];
  if (meta !== null) {
    accountKeys.forEach((account, index) => {
      const pre = toBigInt(meta.preBalances[index]);
      const post = toBigInt(meta.postBalances[index]);
      const delta = post - pre;
      if (delta !== 0n) {
        solChanges.push({
          account: account.pubkey.toBase58(),
          deltaLamports: delta.toString(),
          deltaSol: lamportsToSol(delta),
        });
      }
    });
  }

  const instructions: InstructionSummary[] = message.instructions.map((ix) =>
    isParsedInstruction(ix)
      ? { program: ix.program, programId: ix.programId.toBase58(), type: instructionType(ix) }
      : { program: "unparsed", programId: ix.programId.toBase58(), type: null },
  );

  const fee = toBigInt(meta?.fee);
  const summary: TransactionSummary = {
    signature,
    slot: tx.slot.toString(),
    time: blockTimeToIso(tx.blockTime),
    status: meta === null || meta.err === null ? "success" : "failed",
    error: meta?.err ?? null,
    feeLamports: fee.toString(),
    feeSol: lamportsToSol(fee),
    signers: accountKeys.filter((key) => key.signer).map((key) => key.pubkey.toBase58()),
    instructions,
    solChanges,
    tokenChanges: computeTokenChanges(meta?.preTokenBalances ?? [], meta?.postTokenBalances ?? []),
  };

  if (includeLogs) {
    const logs = meta?.logMessages ?? [];
    return {
      ...summary,
      logs:
        logs.length > MAX_LOG_LINES
          ? [...logs.slice(0, MAX_LOG_LINES), `... ${logs.length - MAX_LOG_LINES} more lines`]
          : logs,
    };
  }
  return summary;
}

export async function getTransaction(
  ctx: ToolContext,
  signature: string,
  includeLogs: boolean,
): Promise<TransactionSummary> {
  const tx = await ctx.connection.getParsedTransaction(signature, {
    commitment: toFinality(ctx.config.commitment),
    maxSupportedTransactionVersion: 0,
  });
  if (tx === null) {
    throw new Error(
      `Transaction ${signature} was not found on ${ctx.config.cluster}. ` +
        "Check the signature and the cluster (SOLANA_RPC_URL).",
    );
  }
  return summarizeTransaction(signature, tx, includeLogs);
}

export function registerGetTransaction(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_transaction",
    {
      title: "Get transaction",
      description:
        "Fetches a transaction by signature and returns a compact summary: status, fee, signers, " +
        "programs called, SOL and token balance changes.",
      inputSchema: {
        signature: signatureSchema.describe("Base58 transaction signature"),
        includeLogs: z
          .boolean()
          .default(false)
          .describe(`Include program logs (truncated to ${MAX_LOG_LINES} lines)`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safeHandler("get_transaction", ({ signature, includeLogs }) =>
      getTransaction(ctx, signature, includeLogs),
    ),
  );
}
