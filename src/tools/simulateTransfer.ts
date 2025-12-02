import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { lamportsToSol, safeHandler, toBigInt, type ToolContext } from "../solana.js";
import { publicKeySchema, solAmountSchema } from "../validation.js";

export interface SimulationResult {
  readonly cluster: string;
  readonly from: string;
  readonly to: string;
  readonly lamports: string;
  readonly sol: string;
  readonly wouldSucceed: boolean;
  readonly error: unknown;
  readonly feeLamports: string | null;
  readonly feeSol: string | null;
  readonly unitsConsumed: string | null;
  readonly logs: readonly string[];
  readonly note: string;
}

/**
 * Builds an UNSIGNED SOL transfer and asks the RPC node to simulate it.
 * Signature verification is disabled, so no private key is needed and nothing is ever broadcast.
 */
export async function simulateTransfer(
  ctx: ToolContext,
  from: string,
  to: string,
  lamports: bigint,
): Promise<SimulationResult> {
  const fromKey = new PublicKey(from);
  const toKey = new PublicKey(to);

  const { blockhash } = await ctx.connection.getLatestBlockhash(ctx.config.commitment);
  const message = new TransactionMessage({
    payerKey: fromKey,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: fromKey, toPubkey: toKey, lamports })],
  }).compileToV0Message();

  // The transaction is created with empty signature slots and is never signed.
  const transaction = new VersionedTransaction(message);

  const [simulation, fee] = await Promise.all([
    ctx.connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: ctx.config.commitment,
    }),
    ctx.connection.getFeeForMessage(message, ctx.config.commitment),
  ]);

  const feeValue = fee.value === null || fee.value === undefined ? null : toBigInt(fee.value);
  const { value } = simulation;

  return {
    cluster: ctx.config.cluster,
    from,
    to,
    lamports: lamports.toString(),
    sol: lamportsToSol(lamports),
    wouldSucceed: value.err === null,
    error: value.err,
    feeLamports: feeValue === null ? null : feeValue.toString(),
    feeSol: feeValue === null ? null : lamportsToSol(feeValue),
    unitsConsumed: value.unitsConsumed === undefined ? null : value.unitsConsumed.toString(),
    logs: value.logs ?? [],
    note: "Simulation only: the transaction was never signed and was not broadcast.",
  };
}

export function registerSimulateTransfer(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "simulate_transfer",
    {
      title: "Simulate SOL transfer",
      description:
        "Simulates a native SOL transfer without signing or sending it. Returns whether it would " +
        "succeed, program logs, compute units and the network fee.",
      inputSchema: {
        from: publicKeySchema.describe("Sender address (fee payer)"),
        to: publicKeySchema.describe("Recipient address"),
        amountSol: solAmountSchema.describe('Amount in SOL, e.g. "0.25" (max 9 decimals)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safeHandler("simulate_transfer", ({ from, to, amountSol }) =>
      simulateTransfer(ctx, from, to, amountSol),
    ),
  );
}
