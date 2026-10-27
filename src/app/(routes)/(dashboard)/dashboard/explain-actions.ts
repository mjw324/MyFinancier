"use server";

import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { getUserToday } from "@/lib/utils/user-time";
import { DASHBOARD_PERIODS, toDateParam } from "@/lib/utils/date-ranges";
import { utcAddDays } from "@/lib/analytics/periods";
import { EXPLAIN_CHARTS, cashFlowSlice, dailySpendingSlice, whereItWentSlice, type ExplainSlice } from "@/lib/explain/slices";
import { explainSlice } from "@/lib/explain/narrate";
import { logError } from "@/lib/logging";
import { loadBuckets, loadCashFlow, loadDaily, loadPrevious, resolveContext, type DashboardContext } from "./data";

const ExplainInput = z.object({
  chart: z.enum(EXPLAIN_CHARTS),
  period: z.enum(DASHBOARD_PERIODS),
});

/** The period as the explanation names it: "October 2026", "the last 30 days". */
function periodName(ctx: DashboardContext, label: string): string {
  if (ctx.key === "30d") return "the last 30 days";
  if (ctx.key === "ytd") return "this year so far";
  return label;
}

/**
 * The slice is recomputed here from the session user's data: the client
 * names a chart and a period, never sends figures.
 */
async function buildSlice(ctx: DashboardContext, chart: ExplainSlice["chart"]): Promise<ExplainSlice> {
  const r = resolveContext(ctx);
  const start = toDateParam(r.period.start);
  const end = toDateParam(r.period.end);
  const period = periodName(ctx, r.period.label);
  switch (chart) {
    case "cash_flow": {
      const [flow, previous] = await Promise.all([
        loadCashFlow(ctx.userId, start, end),
        loadPrevious(ctx.userId, ctx.key, ctx.today),
      ]);
      return cashFlowSlice({
        period,
        flow,
        previous: previous ? { label: previous.period.label, flow: previous.flow } : null,
      });
    }
    case "where_it_went":
      return whereItWentSlice({ period, buckets: await loadBuckets(ctx.userId, start, end) });
    case "daily_spending":
      return dailySpendingSlice({
        period,
        days: await loadDaily(ctx.userId, start, end, toDateParam(utcAddDays(r.today, 1))),
      });
  }
}

export async function explainChartAction(
  input: z.input<typeof ExplainInput>,
): Promise<{ success: true; data: { text: string } } | { success: false; error: string }> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = ExplainInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  try {
    const ctx: DashboardContext = { userId, key: parsed.data.period, today: toDateParam(await getUserToday()) };
    const res = await explainSlice({ userId, slice: await buildSlice(ctx, parsed.data.chart) });
    switch (res.status) {
      case "disabled":
        return { success: false, error: "Turn on AI features in Settings to get explanations." };
      case "over_budget":
        return { success: false, error: "You've reached this month's AI limit. Explanations resume on the 1st." };
      case "rate_limited":
        return { success: false, error: "That's a lot of requests. Please try again in a little while." };
      default:
        return { success: true, data: { text: res.text } };
    }
  } catch (error) {
    logError("explain.failed", error, { userId, chart: parsed.data.chart });
    return { success: false, error: "Could not explain this chart. Please try again." };
  }
}
