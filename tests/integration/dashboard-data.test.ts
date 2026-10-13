import { describe, expect, it, vi } from "vitest";
import { periodTitle, resolveContext, settle } from "@/app/(routes)/(dashboard)/dashboard/data";

describe("dashboard data helpers", () => {
  it("settle turns a failing widget query into a value, not a thrown error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await settle("test-widget", "u_1", async () => {
      throw new Error("relation does not exist");
    });
    expect(res).toEqual({ ok: false });
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain("dashboard.widget_failed");
    spy.mockRestore();
    await expect(settle("ok", "u_1", async () => 42)).resolves.toEqual({ ok: true, value: 42 });
  });

  it("labels a partial month with N of M days and resolves drill-down ranges", () => {
    const r = resolveContext({ userId: "u", key: "month", today: "2026-10-13" });
    expect(periodTitle("month", r.period)).toBe("October 2026 · day 13 of 31");
    expect(r.range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(r.when).toBe("so far this month");
    const last = resolveContext({ userId: "u", key: "last-month", today: "2026-10-13" });
    expect(periodTitle("last-month", last.period)).toBe("September 2026");
    expect(last.when).toBe("in September 2026");
  });
});
