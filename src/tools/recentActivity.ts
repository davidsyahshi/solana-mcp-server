import { PublicKey } from "@solana/web3.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { blockTimeToIso, safeHandler, toFinality, type ToolContext } from "../solana.js";
import { limitSchema, publicKeySchema, signatureSchema } from "../validation.js";

export interface ActivityEntry {
  readonly signature: string;
  readonly slot: string;
  readonly time: string | null;
  readonly status: "success" | "failed";
  readonly error: unknown;
  readonly memo: string | null;
  readonly confirmationStatus: string | null;
}

export interface ActivityResult {
  readonly address: string;
  readonly cluster: string;
  readonly count: number;
  readonly entries: readonly ActivityEntry[];
  /** Pass as `before` to fetch the next (older) page. */
  readonly nextCursor: string | null;
}

export async function recentActivity(
  ctx: ToolContext,
  address: string,
  limit: number,
  before?: string,
): Promise<ActivityResult> {
  const signatures = await ctx.connection.getSignaturesForAddress(
    new PublicKey(address),
    before === undefined ? { limit } : { limit, before },
    toFinality(ctx.config.commitment),
  );

  const entries: ActivityEntry[] = signatures.map((info) => ({
    signature: info.signature,
    slot: info.slot.toString(),
    time: blockTimeToIso(info.blockTime),
    status: info.err === null ? "success" : "failed",
    error: info.err,
    memo: info.memo ?? null,
    confirmationStatus: info.confirmationStatus ?? null,
  }));

  const last = entries.at(-1);
  return {
    address,
    cluster: ctx.config.cluster,
    count: entries.length,
    entries,
    nextCursor: entries.length === limit && last !== undefined ? last.signature : null,
  };
}

export function registerRecentActivity(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "recent_activity",
    {
      title: "Recent activity",
      description:
        "Returns the most recent transaction signatures that touched an address, newest first.",
      inputSchema: {
        address: publicKeySchema.describe("Base58 address (wallet, token account or program)"),
        limit: limitSchema.default(10).describe("Number of signatures to return (1-100)"),
        before: signatureSchema
          .optional()
          .describe("Pagination cursor: only return signatures older than this one"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safeHandler("recent_activity", ({ address, limit, before }) =>
      recentActivity(ctx, address, limit, before),
    ),
  );
}

