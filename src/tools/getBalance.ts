import { PublicKey } from "@solana/web3.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lamportsToSol, safeHandler, toBigInt, type ToolContext } from "../solana.js";
import { publicKeySchema } from "../validation.js";

export interface BalanceResult {
  readonly address: string;
  readonly lamports: string;
  readonly sol: string;
  readonly cluster: string;
}

export async function getBalance(ctx: ToolContext, address: string): Promise<BalanceResult> {
  const lamports = toBigInt(await ctx.connection.getBalance(new PublicKey(address)));
  return {
    address,
    lamports: lamports.toString(),
    sol: lamportsToSol(lamports),
    cluster: ctx.config.cluster,
  };
}

export function registerGetBalance(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_balance",
    {
      title: "Get SOL balance",
      description: "Returns the native SOL balance of a Solana address (in lamports and SOL).",
      inputSchema: { address: publicKeySchema.describe("Base58 Solana wallet address") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safeHandler("get_balance", ({ address }) => getBalance(ctx, address)),
  );
}
