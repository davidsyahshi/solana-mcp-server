import { PublicKey } from "@solana/web3.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeHandler, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, type ToolContext } from "../solana.js";
import { publicKeySchema } from "../validation.js";

/** Shape of `account.data.parsed` for SPL token accounts returned by `jsonParsed` encoding. */
const parsedTokenAccountSchema = z.object({
  type: z.literal("account"),
  info: z.object({
    mint: z.string(),
    owner: z.string(),
    state: z.string(),
    isNative: z.boolean().optional(),
    tokenAmount: z.object({
      amount: z.string(),
      decimals: z.number().int(),
      uiAmountString: z.string().optional(),
    }),
  }),
});

export interface TokenAccountSummary {
  readonly tokenAccount: string;
  readonly mint: string;
  readonly program: "spl-token" | "spl-token-2022";
  readonly amount: string;
  readonly decimals: number;
  readonly uiAmount: string;
  readonly state: string;
}

export interface TokenAccountsResult {
  readonly owner: string;
  readonly cluster: string;
  readonly count: number;
  readonly accounts: readonly TokenAccountSummary[];
  readonly skipped: number;
}

export async function getTokenAccounts(
  ctx: ToolContext,
  owner: string,
  includeEmpty: boolean,
): Promise<TokenAccountsResult> {
  const ownerKey = new PublicKey(owner);
  const programs = [
    { id: TOKEN_PROGRAM_ID, label: "spl-token" as const },
    { id: TOKEN_2022_PROGRAM_ID, label: "spl-token-2022" as const },
  ];

  const responses = await Promise.all(
    programs.map(async (program) => ({
      label: program.label,
      response: await ctx.connection.getParsedTokenAccountsByOwner(ownerKey, {
        programId: program.id,
      }),
    })),
  );

  const accounts: TokenAccountSummary[] = [];
  let skipped = 0;
  for (const { label, response } of responses) {
    for (const entry of response.value) {
      const parsed = parsedTokenAccountSchema.safeParse(entry.account.data.parsed);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const { info } = parsed.data;
      if (!includeEmpty && info.tokenAmount.amount === "0") {
        continue;
      }
      accounts.push({
        tokenAccount: entry.pubkey.toBase58(),
        mint: info.mint,
        program: label,
        amount: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        uiAmount: info.tokenAmount.uiAmountString ?? info.tokenAmount.amount,
        state: info.state,
      });
    }
  }

  accounts.sort((a, b) => a.mint.localeCompare(b.mint));
  return { owner, cluster: ctx.config.cluster, count: accounts.length, accounts, skipped };
}

export function registerGetTokenAccounts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_token_accounts",
    {
      title: "Get SPL token accounts",
      description:
        "Lists SPL Token and Token-2022 accounts owned by an address, with mint, raw amount and decimals.",
      inputSchema: {
        owner: publicKeySchema.describe("Base58 wallet address that owns the token accounts"),
        includeEmpty: z
          .boolean()
          .default(false)
          .describe("Include token accounts with a zero balance"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safeHandler("get_token_accounts", ({ owner, includeEmpty }) =>
      getTokenAccounts(ctx, owner, includeEmpty),
    ),
  );
}
