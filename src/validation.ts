import { z } from "zod";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP: ReadonlyMap<string, number> = new Map(
  [...BASE58_ALPHABET].map((char, index) => [char, index]),
);

/** Number of decimal places in one SOL (1 SOL = 10^9 lamports). */
export const SOL_DECIMALS = 9;
const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

/** Hard upper bound for simulated transfers: total SOL supply is far below this. */
export const MAX_SIMULATED_SOL = 1_000_000_000n;

/**
 * Decodes a base58 string into bytes.
 * Returns `null` when the input contains characters outside the Bitcoin base58 alphabet.
 */
export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) {
    return new Uint8Array(0);
  }

  let value = 0n;
  for (const char of input) {
    const digit = BASE58_MAP.get(char);
    if (digit === undefined) {
      return null;
    }
    value = value * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value % 256n));
    value /= 256n;
  }

  let leadingZeros = 0;
  for (const char of input) {
    if (char !== "1") {
      break;
    }
    leadingZeros += 1;
  }

  const result = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[bytes.length - 1 - i];
    if (byte === undefined) {
      return null;
    }
    result[leadingZeros + i] = byte;
  }
  return result;
}

/** A Solana address is the base58 encoding of exactly 32 bytes. */
export function isValidPublicKey(value: string): boolean {
  if (value.length < 32 || value.length > 44) {
    return false;
  }
  const bytes = decodeBase58(value);
  return bytes !== null && bytes.length === 32;
}

/** A transaction signature is the base58 encoding of exactly 64 bytes. */
export function isValidSignature(value: string): boolean {
  if (value.length < 64 || value.length > 88) {
    return false;
  }
  const bytes = decodeBase58(value);
  return bytes !== null && bytes.length === 64;
}

/**
 * Converts a decimal SOL amount (e.g. "0.25") into lamports without floating point error.
 * Throws a descriptive error for malformed, negative, zero or overly precise values.
 */
export function parseSolToLamports(input: string): bigint {
  const value = input.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) {
    throw new Error(`Invalid SOL amount "${input}": use a positive decimal number such as 0.5`);
  }

  const wholePart = match[1] ?? "0";
  const fractionPart = match[2] ?? "";
  if (fractionPart.length > SOL_DECIMALS) {
    throw new Error(
      `Invalid SOL amount "${input}": at most ${SOL_DECIMALS} decimal places are supported`,
    );
  }

  const whole = BigInt(wholePart);
  if (whole > MAX_SIMULATED_SOL) {
    throw new Error(`Invalid SOL amount "${input}": value is unrealistically large`);
  }

  const fraction = BigInt(fractionPart.padEnd(SOL_DECIMALS, "0"));
  const lamports = whole * LAMPORTS_PER_SOL_BIGINT + fraction;
  if (lamports <= 0n) {
    throw new Error(`Invalid SOL amount "${input}": amount must be greater than zero`);
  }
  return lamports;
}

export const publicKeySchema = z
  .string()
  .trim()
  .refine(isValidPublicKey, {
    message: "Expected a base58-encoded Solana address (32 bytes)",
  });

export const signatureSchema = z
  .string()
  .trim()
  .refine(isValidSignature, {
    message: "Expected a base58-encoded transaction signature (64 bytes)",
  });

export const solAmountSchema = z
  .union([z.string(), z.number()])
  .transform((raw, ctx) => {
    const text = typeof raw === "number" ? numberToPlainString(raw) : raw;
    try {
      return parseSolToLamports(text);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid SOL amount",
      });
      return z.NEVER;
    }
  });

export const limitSchema = z.number().int().min(1).max(100);

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) {
    return "invalid";
  }
  // toFixed avoids exponential notation for small values such as 1e-7.
  return value.toFixed(SOL_DECIMALS).replace(/\.?0+$/, "");
}
