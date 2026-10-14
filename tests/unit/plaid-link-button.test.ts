// @vitest-environment jsdom
/**
 * Client flow of <PlaidLinkButton>: a duplicate (409) relaunches Link in
 * update mode with account selection on the existing connection, and update
 * mode completes through /api/plaid/update-complete (never exchange-token).
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  linkConfigs: [] as Array<{
    token: string;
    onSuccess: (publicToken: string | null, metadata: unknown) => void;
    onExit: (error: unknown, metadata: unknown) => void;
  }>,
  open: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: (config: (typeof h.linkConfigs)[number]) => {
    if (h.linkConfigs.at(-1)?.token !== config.token) h.linkConfigs.push(config);
    return { open: h.open, ready: true };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: h.toast }));

import { PlaidLinkButton } from "@/components/features/accounts/plaid-link-button";

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let responses: Array<{ status: number; json: unknown }>;

beforeEach(() => {
  calls = [];
  responses = [];
  h.linkConfigs.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return new Response(JSON.stringify(next.json), { status: next.status });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessionStorage.clear();
});

const successMetadata = {
  institution: { name: "Test Bank", institution_id: "ins_1" },
  accounts: [{ id: "acc-1", name: "Checking", mask: "0000", type: "depository", subtype: "checking", verification_status: null, class_type: null }],
  link_session_id: "ls-1",
};

describe("PlaidLinkButton", () => {
  it("on a duplicate, reopens Link in update mode on the existing connection and completes via update-complete", async () => {
    responses.push(
      { status: 200, json: { success: true, data: { linkToken: "link-new", expiration: "x" } } },
      { status: 409, json: { success: false, code: "DUPLICATE_ITEM", existingPlaidItemId: "item-row-1", error: "Test Bank is already connected." } },
      { status: 200, json: { success: true, data: { linkToken: "link-update", expiration: "x" } } },
      { status: 200, json: { success: true, data: { plaidItemId: "item-row-1", status: "active", accountsAdded: 1, accountsClosed: 0, accounts: 2 } } },
    );

    render(createElement(PlaidLinkButton));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /link account/i })));
    expect(h.linkConfigs.map((c) => c.token)).toEqual(["link-new"]);
    expect(JSON.parse(sessionStorage.getItem("plaid_link_session")!)).toMatchObject({ token: "link-new", mode: "new" });

    await act(async () => h.linkConfigs[0].onSuccess("public-new", successMetadata));

    expect(calls.map((c) => c.url)).toEqual([
      "/api/plaid/create-link-token",
      "/api/plaid/exchange-token",
      "/api/plaid/create-link-token",
    ]);
    expect(calls[1].body).toMatchObject({
      publicToken: "public-new",
      metadata: { institution: { institutionId: "ins_1" }, accounts: [{ name: "Checking", mask: "0000" }] },
    });
    expect(calls[2].body).toEqual({ plaidItemId: "item-row-1", accountSelection: true });
    expect(h.toast.info).toHaveBeenCalledWith("Test Bank is already connected.");
    expect(h.linkConfigs.map((c) => c.token)).toEqual(["link-new", "link-update"]);
    expect(JSON.parse(sessionStorage.getItem("plaid_link_session")!)).toMatchObject({
      token: "link-update", mode: "update", plaidItemId: "item-row-1", accountSelection: true,
    });

    // Update mode succeeds: no exchange, update-complete instead.
    await act(async () => h.linkConfigs[1].onSuccess("public-update", successMetadata));
    expect(calls[3]).toEqual({ url: "/api/plaid/update-complete", body: { plaidItemId: "item-row-1", accountSelection: true } });
    expect(calls.filter((c) => c.url === "/api/plaid/exchange-token")).toHaveLength(1);
    expect(h.toast.success).toHaveBeenCalledWith("Connection updated: 1 account added.");
    expect(h.refresh).toHaveBeenCalled();
    expect(sessionStorage.getItem("plaid_link_session")).toBeNull();
  });

  it("Reconnect on an existing item uses update mode and update-complete", async () => {
    responses.push(
      { status: 200, json: { success: true, data: { linkToken: "link-update", expiration: "x" } } },
      { status: 200, json: { success: true, data: { plaidItemId: "item-row-1", status: "active", accountsAdded: 0, accountsClosed: 0, accounts: 1 } } },
    );
    render(createElement(PlaidLinkButton, { plaidItemId: "item-row-1" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /reconnect/i })));
    expect(calls[0].body).toEqual({ plaidItemId: "item-row-1" });

    await act(async () => h.linkConfigs[0].onSuccess("public-update", successMetadata));
    expect(calls[1]).toEqual({ url: "/api/plaid/update-complete", body: { plaidItemId: "item-row-1" } });
    expect(h.toast.success).toHaveBeenCalledWith("Connection updated.");
  });

  it("shows the server's friendly error, never a raw Plaid error", async () => {
    responses.push(
      { status: 200, json: { success: true, data: { linkToken: "link-new", expiration: "x" } } },
      { status: 500, json: { success: false, error: "Your bank is not responding. Please try again later." } },
    );
    render(createElement(PlaidLinkButton));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /link account/i })));
    await act(async () => h.linkConfigs[0].onSuccess("public-new", successMetadata));
    expect(h.toast.error).toHaveBeenCalledWith("Your bank is not responding. Please try again later.");

    await act(async () => h.linkConfigs[0].onExit({ error_code: "X", error_message: "raw", error_type: "Y", display_message: null }, {}));
    expect(h.toast.error).toHaveBeenLastCalledWith("The bank connection was interrupted. Please try again.");
  });
});
