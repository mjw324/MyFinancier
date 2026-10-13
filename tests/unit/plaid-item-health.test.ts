import { describe, expect, it } from "vitest";
import { formatInstantDate, getItemHealth } from "@/lib/plaid/item-health";
import { accountsOverlap } from "@/lib/plaid/link";

const NOW = new Date("2026-10-13T12:00:00Z");
const base = { status: "active", attention: null, consentExpiresAt: null, lastSyncErrorCode: null };

describe("getItemHealth", () => {
  it("healthy item: nothing to do, can sync", () => {
    expect(getItemHealth(base, NOW)).toEqual({ level: "ok", issues: [], primaryAction: null, canSync: true });
  });

  it("login required (status or attention) → Reconnect needed, no sync", () => {
    for (const item of [{ ...base, status: "login_required" }, { ...base, attention: "login_required" }]) {
      const h = getItemHealth(item, NOW);
      expect(h.level).toBe("error");
      expect(h.issues.map((i) => i.label)).toEqual(["Reconnect needed"]);
      expect(h.primaryAction).toBe("reconnect");
      expect(h.canSync).toBe(false);
    }
  });

  it("unknown status is treated as needing a reconnect", () => {
    expect(getItemHealth({ ...base, status: "weird" }, NOW).primaryAction).toBe("reconnect");
  });

  it("revoked → Access revoked + reconnect", () => {
    const h = getItemHealth({ ...base, status: "revoked" }, NOW);
    expect(h.issues.map((i) => i.kind)).toEqual(["revoked"]);
    expect(h.primaryAction).toBe("reconnect");
  });

  it("pending disconnect / consent within 14 days → Renew, still syncs", () => {
    const viaWebhook = getItemHealth({ ...base, attention: "pending_disconnect" }, NOW);
    expect(viaWebhook).toMatchObject({ level: "warning", primaryAction: "renew", canSync: true });

    const soon = new Date("2026-10-20T00:00:00Z");
    const viaDate = getItemHealth({ ...base, consentExpiresAt: soon }, NOW);
    expect(viaDate.primaryAction).toBe("renew");
    expect(viaDate.issues[0]).toMatchObject({ kind: "expiring", expiresAt: soon });

    const far = getItemHealth({ ...base, consentExpiresAt: new Date("2027-04-20T00:00:00Z") }, NOW);
    expect(far.primaryAction).toBeNull();
  });

  it("new accounts available → Add accounts", () => {
    const h = getItemHealth({ ...base, attention: "new_accounts_available" }, NOW);
    expect(h).toMatchObject({ level: "warning", primaryAction: "add_accounts", canSync: true });
    expect(h.issues.map((i) => i.label)).toEqual(["New accounts available"]);
  });

  it("a failed last sync is a warning without an update-mode action", () => {
    const h = getItemHealth({ ...base, lastSyncErrorCode: "INSTITUTION_DOWN" }, NOW);
    expect(h).toMatchObject({ level: "warning", primaryAction: null, canSync: true });
  });

  it("reconnect outranks renew and add accounts", () => {
    const h = getItemHealth({ ...base, status: "login_required", attention: "new_accounts_available", consentExpiresAt: NOW }, NOW);
    expect(h.primaryAction).toBe("reconnect");
    expect(h.issues.map((i) => i.kind)).toEqual(["reconnect"]);
  });
});

describe("formatInstantDate", () => {
  it("formats in the viewer's time zone", () => {
    const d = new Date("2027-04-21T02:00:00Z");
    expect(formatInstantDate(d, "UTC")).toBe("Apr 21, 2027");
    expect(formatInstantDate(d, "America/Los_Angeles")).toBe("Apr 20, 2027");
  });
});

describe("accountsOverlap (Plaid duplicate signal)", () => {
  const existing = [{ name: "Checking", mask: "0000" }, { name: "Savings", mask: "1111" }];

  it("matches on name + mask", () => {
    expect(accountsOverlap([{ name: "checking ", mask: "0000" }], existing)).toBe(true);
  });
  it("same name, different mask is a different login", () => {
    expect(accountsOverlap([{ name: "Checking", mask: "9999" }], existing)).toBe(false);
  });
  it("one shared account is enough", () => {
    expect(accountsOverlap([{ name: "Brokerage", mask: "2222" }, { name: "Savings", mask: "1111" }], existing)).toBe(true);
  });
  it("falls back to the name when a mask is unknown", () => {
    expect(accountsOverlap([{ name: "Checking", mask: "9999" }], [{ name: "Checking", mask: null }])).toBe(true);
    expect(accountsOverlap([{ name: "Checking", mask: null }], existing)).toBe(true);
  });
  it("no accounts, no match", () => {
    expect(accountsOverlap([], existing)).toBe(false);
  });
});
