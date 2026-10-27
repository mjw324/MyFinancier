// @vitest-environment jsdom
/**
 * <ProposalCard>: the card lists what the server's preview returns (not the
 * model's input), Apply runs the Server Action before answering the
 * approval, a failed apply answers nothing, and Decline only answers.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChatUIMessage } from "@/lib/chat/types";

const h = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/app/(routes)/(dashboard)/assistant/proposal-actions", () => ({
  previewProposalAction: h.preview,
  applyProposalAction: h.apply,
}));

import { ProposalCard, ProposalContext, type ProposalContextValue } from "@/components/features/assistant/proposal-card";

const message = (state: string, approval: Record<string, unknown>): ChatUIMessage =>
  ({
    id: "a1",
    role: "assistant",
    parts: [
      {
        type: "tool-proposeBudget",
        toolCallId: "call_1",
        state,
        input: { categoryKey: "FOOD_AND_DRINK", amount: 999999, period: "monthly" },
        approval,
      },
    ],
  }) as unknown as ChatUIMessage;

function renderCard(messages: ChatUIMessage[], respond = vi.fn()) {
  const value: ProposalContextValue = { chatId: "chat_card_01", messages, ready: true, respond };
  render(createElement(ProposalContext.Provider, { value }, createElement(ProposalCard, { toolName: "proposeBudget", toolCallId: "call_1" })));
  return respond;
}

beforeEach(() => {
  h.preview.mockResolvedValue({
    success: true,
    data: { kind: "proposeBudget", categoryKey: "FOOD_AND_DRINK", categoryLabel: "Food & drink", amount: { cents: 30000, display: "$300.00" }, period: "monthly", startDate: "2026-10-27" },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProposalCard", () => {
  it("shows the server preview and applies before approving", async () => {
    h.apply.mockResolvedValue({ success: true, data: { approvalId: "ap_1" } });
    const respond = renderCard([message("approval-requested", { id: "ap_1" })]);
    expect(await screen.findByText("$300.00")).toBeTruthy();
    expect(screen.queryByText(/999,?999/)).toBeNull();
    expect(h.preview).toHaveBeenCalledWith({ chatId: "chat_card_01", toolCallId: "call_1" });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /apply/i })));
    expect(h.apply).toHaveBeenCalledWith({ chatId: "chat_card_01", toolCallId: "call_1" });
    expect(respond).toHaveBeenCalledWith("ap_1", true);
  });

  it("does not approve when the Server Action refuses", async () => {
    h.apply.mockResolvedValue({ success: false, error: "You already have a monthly budget for this category in those dates" });
    const respond = renderCard([message("approval-requested", { id: "ap_1" })]);
    await screen.findByText("$300.00");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /apply/i })));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(respond).not.toHaveBeenCalled();
  });

  it("declines without calling the Server Action", async () => {
    const respond = renderCard([message("approval-requested", { id: "ap_1" })]);
    await screen.findByText("$300.00");
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(respond).toHaveBeenCalledWith("ap_1", false);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("shows no buttons for an automatic denial", () => {
    renderCard([message("output-denied", { id: "ap_1", approved: false, isAutomatic: true, reason: "Not one of this person's categories." })]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/can.t offer/)).toBeTruthy();
    expect(h.preview).not.toHaveBeenCalled();
  });
});
