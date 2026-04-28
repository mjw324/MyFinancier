import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "@/lib/utils/encryption";

beforeAll(() => {
  // 32 bytes = 64 hex chars (AES-256 requirement)
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
});

describe("encryption (Plaid access token storage)", () => {
  it("roundtrips a UTF-8 string", () => {
    const original = "access-sandbox-abcd-1234-efgh";
    expect(decrypt(encrypt(original))).toBe(original);
  });

  it("roundtrips an empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("roundtrips multi-byte unicode", () => {
    const original = "🔐 access-绝密-ñ";
    expect(decrypt(encrypt(original))).toBe(original);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encrypt("same-plaintext");
    const b = encrypt("same-plaintext");
    expect(a).not.toBe(b);
    // Both must still decrypt to the same plaintext
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("uses iv:authTag:ciphertext format with hex segments", () => {
    const out = encrypt("hello");
    const [iv, tag, cipher] = out.split(":");
    expect(iv).toMatch(/^[0-9a-f]+$/);
    expect(tag).toMatch(/^[0-9a-f]+$/);
    expect(cipher).toMatch(/^[0-9a-f]+$/);
    expect(iv.length).toBe(24); // 12 bytes = 24 hex chars
    expect(tag.length).toBe(32); // 16 bytes = 32 hex chars
  });

  it("rejects tampered ciphertext (auth tag mismatch)", () => {
    const out = encrypt("sensitive-token");
    const [iv, tag, cipher] = out.split(":");
    // Flip one byte of ciphertext
    const flippedHex = (parseInt(cipher.slice(0, 2), 16) ^ 0xff)
      .toString(16)
      .padStart(2, "0");
    const tampered = `${iv}:${tag}:${flippedHex}${cipher.slice(2)}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const out = encrypt("sensitive-token");
    const [iv, tag, cipher] = out.split(":");
    const flippedTag = (parseInt(tag.slice(0, 2), 16) ^ 0xff)
      .toString(16)
      .padStart(2, "0") + tag.slice(2);
    const tampered = `${iv}:${flippedTag}:${cipher}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects ciphertext encrypted under a different key", () => {
    const out = encrypt("token-under-key-A");
    const originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    expect(() => decrypt(out)).toThrow();
    process.env.ENCRYPTION_KEY = originalKey;
  });

  it("throws if ENCRYPTION_KEY is missing", () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = original;
  });

  it("throws if ENCRYPTION_KEY is the wrong length", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "deadbeef"; // 8 chars, not 64
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = original;
  });
});
