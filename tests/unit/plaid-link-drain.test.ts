import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: "u1" } })),
}));
vi.mock("@/lib/plaid/jobs", () => ({ drainItemSoon: vi.fn() }));
vi.mock("@/lib/plaid/link", async (orig) => ({
  ...(await orig<typeof import("@/lib/plaid/link")>()),
  exchangePublicToken: vi.fn(async () => ({
    plaidItemId: "row-1",
    itemId: "item-1",
    institutionName: "Test Bank",
    accounts: 1,
  })),
  completeItemUpdate: vi.fn(async () => ({ added: 0, closed: 0, open: 1 })),
}));

import { drainItemSoon } from "@/lib/plaid/jobs";
import { POST as exchange } from "@/app/api/plaid/exchange-token/route";
import { POST as updateComplete } from "@/app/api/plaid/update-complete/route";

const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.mocked(drainItemSoon).mockClear());

describe("link routes start the sync worker", () => {
  it("exchange-token drains the new item after storing it", async () => {
    const res = await exchange(
      json({
        publicToken: "public-sandbox-x",
        metadata: { institution: { name: "Test Bank", institutionId: "ins_1" }, accounts: [] },
      }),
    );
    expect(res.status).toBe(200);
    expect(drainItemSoon).toHaveBeenCalledWith("row-1");
  });

  it("update-complete drains the repaired item", async () => {
    const res = await updateComplete(json({ plaidItemId: "row-9" }));
    expect(res.status).toBe(200);
    expect(drainItemSoon).toHaveBeenCalledWith("row-9");
  });
});
