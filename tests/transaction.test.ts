import { describe, expect, it } from "vitest";
import type { TokenBalance } from "@solana/web3.js";
import { computeTokenChanges } from "../src/tools/getTransaction.js";

const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const OWNER_A = "11111111111111111111111111111111";
const OWNER_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function balance(accountIndex: number, owner: string, amount: string): TokenBalance {
  return {
    accountIndex,
    mint: USDC_DEVNET,
    owner,
    uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: amount },
  } as TokenBalance;
}

describe("computeTokenChanges", () => {
  it("returns signed deltas per account and skips unchanged balances", () => {
    const pre = [balance(1, OWNER_A, "5000000"), balance(2, OWNER_B, "0"), balance(3, OWNER_B, "7")];
    const post = [balance(1, OWNER_A, "3500000"), balance(2, OWNER_B, "1500000"), balance(3, OWNER_B, "7")];

    expect(computeTokenChanges(pre, post)).toEqual([
      { owner: OWNER_A, mint: USDC_DEVNET, delta: "-1.5", decimals: 6 },
      { owner: OWNER_B, mint: USDC_DEVNET, delta: "1.5", decimals: 6 },
    ]);
  });

  it("treats accounts created during the transaction as starting from zero", () => {
    expect(computeTokenChanges([], [balance(4, OWNER_B, "250000")])).toEqual([
      { owner: OWNER_B, mint: USDC_DEVNET, delta: "0.25", decimals: 6 },
    ]);
  });
});
