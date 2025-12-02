import { describe, expect, it } from "vitest";
import {
  decodeBase58,
  isValidPublicKey,
  isValidSignature,
  parseSolToLamports,
  publicKeySchema,
  signatureSchema,
  solAmountSchema,
} from "../src/validation.js";
import { detectCluster, lamportsToSol, loadConfig, DEFAULT_RPC_URL } from "../src/solana.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// A syntactically valid signature: base58 encoding of 64 bytes.
const SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

describe("decodeBase58", () => {
  it("decodes leading ones as zero bytes", () => {
    expect(decodeBase58(SYSTEM_PROGRAM)).toEqual(new Uint8Array(32));
  });

  it("rejects characters outside the alphabet", () => {
    expect(decodeBase58("0OIl")).toBeNull();
  });
});

describe("public keys", () => {
  it("accepts well-known program addresses", () => {
    expect(isValidPublicKey(SYSTEM_PROGRAM)).toBe(true);
    expect(isValidPublicKey(TOKEN_PROGRAM)).toBe(true);
  });

  it("rejects wrong length and invalid characters", () => {
    expect(isValidPublicKey("abc")).toBe(false);
    expect(isValidPublicKey(`${TOKEN_PROGRAM}x`)).toBe(false);
    expect(isValidPublicKey("0".repeat(44))).toBe(false);
  });

  it("schema trims whitespace and reports a readable error", () => {
    expect(publicKeySchema.parse(`  ${TOKEN_PROGRAM} `)).toBe(TOKEN_PROGRAM);
    const result = publicKeySchema.safeParse("not-a-key");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Solana address");
  });
});

describe("signatures", () => {
  it("accepts a 64-byte base58 signature", () => {
    expect(isValidSignature(SIGNATURE)).toBe(true);
    expect(signatureSchema.parse(SIGNATURE)).toBe(SIGNATURE);
  });

  it("rejects public keys and garbage", () => {
    expect(isValidSignature(TOKEN_PROGRAM)).toBe(false);
    expect(isValidSignature("x".repeat(88))).toBe(false);
  });
});

describe("SOL amounts", () => {
  it("converts decimal strings to lamports exactly", () => {
    expect(parseSolToLamports("1")).toBe(1_000_000_000n);
    expect(parseSolToLamports("0.000000001")).toBe(1n);
    expect(parseSolToLamports("0.1")).toBe(100_000_000n);
    expect(parseSolToLamports("12.345678912")).toBe(12_345_678_912n);
  });

  it("rejects zero, negatives, too many decimals and junk", () => {
    expect(() => parseSolToLamports("0")).toThrow(/greater than zero/);
    expect(() => parseSolToLamports("-1")).toThrow(/positive decimal/);
    expect(() => parseSolToLamports("0.0000000001")).toThrow(/decimal places/);
    expect(() => parseSolToLamports("1e3")).toThrow(/positive decimal/);
  });

  it("schema accepts numbers without floating point drift", () => {
    expect(solAmountSchema.parse(0.1)).toBe(100_000_000n);
    expect(solAmountSchema.parse("2.5")).toBe(2_500_000_000n);
    expect(solAmountSchema.safeParse("abc").success).toBe(false);
  });

  it("formats lamports back to SOL", () => {
    expect(lamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(lamportsToSol(1n)).toBe("0.000000001");
    expect(lamportsToSol(-5000n)).toBe("-0.000005");
    expect(lamportsToSol(0)).toBe("0");
  });
});

describe("configuration", () => {
  it("defaults to devnet", () => {
    const config = loadConfig({});
    expect(config.rpcUrl).toBe(DEFAULT_RPC_URL);
    expect(config.cluster).toBe("devnet");
    expect(config.commitment).toBe("confirmed");
  });

  it("detects clusters from RPC URLs", () => {
    expect(detectCluster("https://api.mainnet-beta.solana.com")).toBe("mainnet-beta");
    expect(detectCluster("http://127.0.0.1:8899")).toBe("localnet");
    expect(detectCluster("https://rpc.example.com")).toBe("custom");
  });

  it("treats empty values from a .env file as defaults", () => {
    const config = loadConfig({
      SOLANA_RPC_URL: "",
      SOLANA_COMMITMENT: " ",
      SOLANA_REQUEST_TIMEOUT_MS: "",
    });
    expect(config.rpcUrl).toBe(DEFAULT_RPC_URL);
    expect(config.commitment).toBe("confirmed");
    expect(config.requestTimeoutMs).toBe(30_000);
  });

  it("rejects invalid values with the variable name in the message", () => {
    expect(() => loadConfig({ SOLANA_RPC_URL: "not a url" })).toThrow(/SOLANA_RPC_URL/);
    expect(() => loadConfig({ SOLANA_RPC_URL: "ftp://example.com" })).toThrow(/SOLANA_RPC_URL/);
    expect(() => loadConfig({ SOLANA_COMMITMENT: "fast" })).toThrow(/SOLANA_COMMITMENT/);
    expect(() => loadConfig({ SOLANA_REQUEST_TIMEOUT_MS: "10" })).toThrow(/SOLANA_REQUEST_TIMEOUT_MS/);
  });
});
