/**
 * Dashboard widgets. Each is an async server component that loads its own
 * data through the cached loaders in ../data.ts and renders a degraded card
 * (not an error page) when its query fails.
 */

import { count, eq } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { financialAccounts } from "@/lib/db/schema";
import { getBudgetProgress } from "@/lib/db/queries/overview";
import { buildInsights } from "@/lib/analytics/insights";
import {
  computeDrift,
  detectAnomalies,
  monthKeys,
  projectPace,
  seriesByBucket,
} from "@/lib/analytics/trends";
import { utcAddDays, utcStartOfMonth } from "@/lib/analytics/periods";
import { periodToRange, toDateParam, transactionsHref } from "@/lib/utils/date-ranges";
import { CashFlowCard } from "@/components/features/overview/cash-flow-card";
import { BalanceCard } from "@/components/features/overview/balance-card";
import { WhereItWent } from "@/components/features/overview/where-it-went";
import { InsightList } from "@/components/features/overview/insight-list";
import { FixedVsVariable } from "@/components/features/overview/fixed-vs-variable";
import { SpendingPace } from "@/components/features/overview/spending-pace";
import { RecentTransactions } from "@/components/features/overview/recent-transactions";
import { BudgetOverview } from "@/components/features/overview/budget-overview";
import { WidgetError } from "@/components/features/overview/widget-states";
import { DigestCard } from "@/components/features/insights/digest-card";
import { isAiActiveForUser } from "@/lib/ai/consent";
import { getLatestDigest } from "@/lib/insights/candidates";
import { SpendingOverTime } from "@/components/charts/spending-over-time";
import { ExplainButton } from "@/components/features/insights/explain-button";
import { CardAction } from "@/components/ui/card";
import {
  loadAiActive,
  loadBalances,
  loadBuckets,
  loadCashFlow,
  loadDaily,
  loadFixedVsVariable,
  loadIncomeCadence,
  loadMerchants,
  loadMonthlyHistory,
  loadPace,
  loadPrevious,
  loadRecent,
  periodTitle,
  resolveContext,
  settle,
  type DashboardContext,
} from "../data";

type Props = { ctx: DashboardContext };

function bounds(ctx: DashboardContext) {
  const r = resolveContext(ctx);
  return {
    ...r,
    start: toDateParam(r.period.start),
    end: toDateParam(r.period.end),
    title: periodTitle(ctx.key, r.period),
  };
}

export async function CashFlowWidget({ ctx }: Props) {
  const b = bounds(ctx);
  const res = await settle("cash-flow", ctx.userId, async () => {
    const [flow, previous, ai] = await Promise.all([
      loadCashFlow(ctx.userId, b.start, b.end),
      loadPrevious(ctx.userId, ctx.key, ctx.today),
      loadAiActive(ctx.userId),
    ]);
    return { flow, previous, ai };
  });
  if (!res.ok) return <WidgetError title="Cash flow" />;
  const { flow, previous, ai } = res.value;
  return (
    <CashFlowCard
      explain={ai ? <ExplainButton chart="cash_flow" period={ctx.key} /> : undefined}
      flow={flow}
      title={b.title}
      range={b.range}
      previous={previous ? { label: previous.period.label, flow: previous.flow } : null}
    />
  );
}

export async function BalanceWidget({ ctx }: Props) {
  const res = await settle("balances", ctx.userId, async () => {
    const [summary, [row]] = await Promise.all([
      loadBalances(ctx.userId),
      db.select({ n: count() }).from(financialAccounts).where(eq(financialAccounts.userId, ctx.userId)),
    ]);
    return { summary, accountCount: row?.n ?? 0 };
  });
  if (!res.ok) return <WidgetError title="Net worth" />;
  return <BalanceCard summary={res.value.summary} accountCount={res.value.accountCount} />;
}

export async function WhereItWentWidget({ ctx }: Props) {
  const b = bounds(ctx);
  const res = await settle("where-it-went", ctx.userId, async () => {
    const [buckets, merchants, ai] = await Promise.all([
      loadBuckets(ctx.userId, b.start, b.end),
      loadMerchants(ctx.userId, b.start, b.end),
      loadAiActive(ctx.userId),
    ]);
    return { buckets, merchants, ai };
  });
  if (!res.ok) return <WidgetError title="Where it went" />;
  const { buckets, merchants, ai } = res.value;
  return (
    <WhereItWent
      buckets={buckets}
      merchants={merchants}
      range={b.range}
      title={b.title}
      explain={ai ? <ExplainButton chart="where_it_went" period={ctx.key} /> : undefined}
    />
  );
}

export async function FixedVariableWidget({ ctx }: Props) {
  const b = bounds(ctx);
  const res = await settle("fixed-variable", ctx.userId, () =>
    loadFixedVsVariable(ctx.userId, b.start, b.end),
  );
  if (!res.ok) return <WidgetError title="Fixed vs variable" />;
  return <FixedVsVariable data={res.value} range={b.range} title={b.title} />;
}

/** Always the current calendar month, whatever period is selected. */
export async function PaceWidget({ ctx }: Props) {
  const res = await settle("pace", ctx.userId, () => loadPace(ctx.userId, ctx.today));
  if (!res.ok) return <WidgetError title="Pace" />;
  const pace = res.value;
  const projection = projectPace(pace);
  return (
    <SpendingPace
      monthLabel={pace.period.label}
      comparisonLabel={pace.comparisonPeriod.label}
      elapsedDays={projection.elapsedDays}
      totalDays={projection.totalDays}
      series={pace.series}
      toDate={pace.toDate}
      comparisonToDate={pace.comparisonToDate}
      comparisonTotal={pace.comparisonTotal}
      projected={projection.projected}
      variableRatioAhead={projection.variableRatioAhead}
      href={transactionsHref({
        from: toDateParam(pace.period.start),
        to: ctx.today,
        cost: "variable",
      })}
    />
  );
}

export async function InsightsWidget({ ctx }: Props) {
  const b = bounds(ctx);
  const isMonth = ctx.key === "month" || ctx.key === "last-month";
  const res = await settle("insights", ctx.userId, async () => {
    const [flow, buckets, history, pace, income] = await Promise.all([
      loadCashFlow(ctx.userId, b.start, b.end),
      loadBuckets(ctx.userId, b.start, b.end),
      loadMonthlyHistory(ctx.userId, ctx.today),
      ctx.key === "month" ? loadPace(ctx.userId, ctx.today) : Promise.resolve(null),
      isMonth ? loadIncomeCadence(ctx.userId, ctx.today, b.start, b.end) : Promise.resolve(null),
    ]);

    // Seven complete months before this one: drift reads the last six, and
    // anomalies compare the selected month with the six before it.
    const monthStart = utcStartOfMonth(b.today);
    const historyStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 7, 1));
    const months = monthKeys(historyStart, monthStart);
    const series = seriesByBucket(history, months);
    const lastSix = new Map([...series].map(([k, v]) => [k, v.slice(-6)]));
    const drifts = computeDrift(lastSix);

    let anomalies: ReturnType<typeof detectAnomalies> = [];
    if (isMonth) {
      const baseline = new Map(
        [...series].map(([k, v]) => [k, ctx.key === "month" ? v.slice(-6) : v.slice(0, 6)]),
      );
      anomalies = detectAnomalies(new Map(buckets.buckets.map((x) => [x.bucket, x.net])), baseline);
    }

    const driftRange = periodToRange({
      start: new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 6, 1)),
      end: monthStart,
    });
    return buildInsights({
      when: b.when,
      periodLabel: b.period.label,
      isPartial: b.period.isPartial,
      range: b.range,
      flow,
      pace: pace
        ? {
            projection: projectPace(pace),
            range: { from: toDateParam(pace.period.start), to: ctx.today },
          }
        : null,
      income,
      anomalies,
      drifts,
      driftRange,
    });
  });
  if (!res.ok) return <WidgetError title="What changed" />;
  return <InsightList insights={res.value} />;
}

export async function SpendingOverTimeWidget({ ctx }: Props) {
  const b = bounds(ctx);
  const res = await settle("spending-over-time", ctx.userId, async () => {
    const [days, ai] = await Promise.all([
      loadDaily(ctx.userId, b.start, b.end, toDateParam(utcAddDays(b.today, 1))),
      loadAiActive(ctx.userId),
    ]);
    return { days, ai };
  });
  if (!res.ok) return <WidgetError title="Daily spending" />;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Daily spending</CardTitle>
        <CardDescription>{b.title} · net of refunds</CardDescription>
        {res.value.ai && (
          <CardAction>
            <ExplainButton chart="daily_spending" period={ctx.key} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <SpendingOverTime data={res.value.days} />
      </CardContent>
    </Card>
  );
}

export async function RecentWidget({ ctx }: Props) {
  const res = await settle("recent", ctx.userId, () => loadRecent(ctx.userId));
  if (!res.ok) return <WidgetError title="Recent transactions" />;
  return <RecentTransactions transactions={res.value} />;
}

export async function BudgetWidget({ ctx }: Props) {
  const res = await settle("budgets", ctx.userId, () => getBudgetProgress(ctx.userId));
  if (!res.ok) return <WidgetError title="Budget progress" />;
  return <BudgetOverview budgets={res.value} />;
}

/** The weekly AI digest; renders nothing unless the user opted in and AI is on. */
export async function DigestWidget({ ctx }: Props) {
  const res = await settle("digest", ctx.userId, async () =>
    (await isAiActiveForUser(ctx.userId)) ? getLatestDigest(ctx.userId) : [],
  );
  if (!res.ok || res.value.length === 0) return null;
  const items = res.value;
  const weekOf = items[0].digestAt!.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <DigestCard
      weekOf={`Week of ${weekOf}`}
      items={items.map((i) => ({
        id: i.id,
        title: i.title ?? "",
        body: i.body ?? "",
        href: i.payload.href,
        helpful: i.helpful,
      }))}
    />
  );
}
