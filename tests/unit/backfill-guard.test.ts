import { describe, expect, it } from "vitest";
import { assertTargetAllowed, databaseHost, isLocalHost } from "../../scripts/backfill-guard";

const base = { confirmProduction: false, confirmHost: null, ask: null, action: "WRITE" };

describe("backfill target guard", () => {
  it("parses the host without exposing credentials", () => {
    expect(databaseHost("postgres://user:secret@db.example.test:5432/app")).toBe("db.example.test");
    expect(() => databaseHost("not a url")).toThrow("not a valid URL");
  });

  it("treats only loopback / .localhost as local", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "db.localhost"]) expect(isLocalHost(h)).toBe(true);
    for (const h of ["db.example.test", "10.0.0.5", "localhost.example.com"]) expect(isLocalHost(h)).toBe(false);
  });

  it("allows local hosts without confirmation", async () => {
    await expect(assertTargetAllowed("127.0.0.1", base)).resolves.toBeUndefined();
  });

  it("refuses a remote host without --confirm-production", async () => {
    await expect(assertTargetAllowed("db.example.test", base)).rejects.toThrow("Refusing");
  });

  it("requires the exact host to be typed back or passed", async () => {
    const opts = { ...base, confirmProduction: true };
    await expect(assertTargetAllowed("db.example.test", opts)).rejects.toThrow("--confirm-host");
    await expect(assertTargetAllowed("db.example.test", { ...opts, confirmHost: "other.test" })).rejects.toThrow("did not match");
    await expect(assertTargetAllowed("db.example.test", { ...opts, confirmHost: "db.example.test" })).resolves.toBeUndefined();
    await expect(assertTargetAllowed("db.example.test", { ...opts, ask: async () => "db.example.test\n" })).resolves.toBeUndefined();
    await expect(assertTargetAllowed("db.example.test", { ...opts, ask: async () => "nope" })).rejects.toThrow("did not match");
  });
});
