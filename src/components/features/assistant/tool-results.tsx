"use client";

/**
 * Charts and tables for the assistant's tool results. Every figure here comes
 * from the tool's `output` (computed by the app, as cents plus a display
 * string), never from text the model typed. Bars use the same Recharts
 * ChartContainer as the dashboard; daily spending reuses SpendingOverTime.
 */

import type { InferUITools } from "ai";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { SpendingOverTime } from "@/components/charts/spending-over-time";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import type { ChatTools } from "@/lib/chat/tools";

type Outputs = { [K in keyof InferUITools<ChatTools>]: InferUITools<ChatTools>[K]["output"] };
type Ok<T> = Exclude<T, { error: string }>;
type Range = { from: string; to: string; label: string; isPartial: boolean };

const compact = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`);
const dollars = (m: { cents: number }) => m.cents / 100;

function Frame({ title, range, children, footer }: { title: string; range?: Range | null; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <figure className="my-2 flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{title}</span>
        {range && (
          <span className="text-xs text-muted-foreground">
            {range.from} – {range.to}
            {range.isPartial ? " · in progress" : ""}
          </span>
        )}
      </figcaption>
      {children}
      {footer && <div className="text-xs text-muted-foreground">{footer}</div>}
    </figure>
  );
}

function HorizontalBars({ rows, label }: { rows: Array<{ name: string; value: number; display: string }>; label: string }) {
  const config = { value: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="w-full" style={{ height: Math.max(80, rows.length * 30) }}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(_, __, item) => item.payload.display} />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={3} />
      </BarChart>
    </ChartContainer>
  );
}

function SpendingSummary({ o }: { o: Ok<Outputs["getSpendingSummary"]> }) {
  return (
    <Frame
      title={`Spending by ${o.groupBy} · ${o.total.display}`}
      range={o.range}
      footer={o.truncated ? `Top ${o.count} shown.` : undefined}
    >
      {o.items.length === 0 ? (
        <p className="text-muted-foreground">No spending in this period.</p>
      ) : (
        <HorizontalBars label="Net spending" rows={o.items.map((i) => ({ name: i.label, value: dollars(i.amount), display: i.amount.display }))} />
      )}
    </Frame>
  );
}

function CompareSpending({ o }: { o: Ok<Outputs["compareSpending"]> }) {
  const config = {
    a: { label: o.rangeA.label, color: "var(--chart-1)" },
    b: { label: o.rangeB.label, color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const rows = o.categories.map((c) => ({ name: c.label, a: dollars(c.a), b: dollars(c.b) }));
  return (
    <Frame
      title={`${o.rangeA.label} vs ${o.rangeB.label}: ${o.totalA.display} vs ${o.totalB.display} (${o.change.pctChangeDisplay ?? o.change.delta.display})`}
      footer={o.note}
    >
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={rows} margin={{ left: 4, right: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={compact} width={44} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="a" fill="var(--color-a)" radius={3} />
          <Bar dataKey="b" fill="var(--color-b)" radius={3} />
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}

function Cashflow({ o }: { o: Ok<Outputs["getCashflow"]> }) {
  const rows = [
    { name: "Money in", value: dollars(o.moneyIn), display: o.moneyIn.display },
    { name: "Net spending", value: dollars(o.netSpending), display: o.netSpending.display },
    { name: "Saved / moved", value: Math.abs(dollars(o.savedNet)), display: o.savedNet.display },
  ];
  return (
    <Frame title={`Cash flow · net change ${o.netChange.display}`} range={o.range} footer={o.savingsRate ? `Savings rate ${o.savingsRate.display}` : undefined}>
      <HorizontalBars label="Amount" rows={rows} />
    </Frame>
  );
}

function Daily({ o }: { o: Ok<Outputs["getDailySpending"]> }) {
  return (
    <Frame
      title={`Daily spending · ${o.total.display}, about ${o.averagePerDay.display} a day`}
      range={o.range}
      footer={o.peakDay ? `Biggest day: ${o.peakDay.date}, ${o.peakDay.amount.display}` : undefined}
    >
      <SpendingOverTime data={o.days.map((d) => ({ date: d.date, net: dollars(d.amount) }))} />
    </Frame>
  );
}

function Transactions({ o }: { o: Ok<Outputs["searchTransactions"]> }) {
  return (
    <Frame
      title={`${o.totalMatches} matching transactions`}
      range={o.range}
      footer={o.truncated ? `Newest ${o.count} shown.` : undefined}
    >
      <table className="w-full text-xs">
        <tbody>
          {o.transactions.map((t, i) => (
            <tr key={i} className="border-t first:border-t-0">
              <td className="py-1 pr-2 text-muted-foreground">{t.date}</td>
              <td className="py-1 pr-2">
                {t.label}
                {t.pending && <span className="ml-1 text-muted-foreground">(pending)</span>}
              </td>
              <td className="py-1 pr-2 text-muted-foreground">{t.category}</td>
              <td className="py-1 text-right tabular-nums">
                {t.direction === "in" ? "+" : ""}
                {t.amount.display}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

function Budgets({ o }: { o: Ok<Outputs["getBudgetStatus"]> }) {
  if (o.budgets.length === 0) return <Frame title="Budgets"><p className="text-muted-foreground">No budgets yet.</p></Frame>;
  return (
    <Frame title="Budgets">
      <ul className="flex flex-col gap-2">
        {o.budgets.map((b, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span>
                {b.category} <span className="text-muted-foreground">· {b.period}</span>
              </span>
              <span className="tabular-nums">
                {b.spent.display} of {b.budgeted.display}
              </span>
            </div>
            <Progress value={Math.min(100, b.used?.value ?? 0)} />
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function Recurring({ o }: { o: Ok<Outputs["getRecurring"]> }) {
  return (
    <Frame
      title={`${o.direction === "outflow" ? "Recurring bills" : "Recurring income"} · ${o.monthlyTotal.display} a month`}
      footer={o.truncated ? `First ${o.count} shown.` : undefined}
    >
      <table className="w-full text-xs">
        <tbody>
          {o.items.map((s, i) => (
            <tr key={i} className="border-t first:border-t-0">
              <td className="py-1 pr-2">{s.label}</td>
              <td className="py-1 pr-2 text-muted-foreground">{s.frequency}</td>
              <td className="py-1 pr-2 text-muted-foreground">{s.nextDate ?? ""}</td>
              <td className="py-1 text-right tabular-nums">{s.typicalAmount.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

function Accounts({ o }: { o: Ok<Outputs["getAccounts"]> }) {
  return (
    <Frame title={`Accounts · net worth ${o.netWorth.display}`}>
      <table className="w-full text-xs">
        <tbody>
          {o.accounts.map((a) => (
            <tr key={a.id} className="border-t first:border-t-0">
              <td className="py-1 pr-2">
                {a.name} {a.mask && <span className="text-muted-foreground">{a.mask}</span>}
              </td>
              <td className="py-1 pr-2 text-muted-foreground">{a.kind}</td>
              <td className="py-1 text-right tabular-nums">{a.balance?.display ?? "unavailable"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

const RENDERERS: { [K in keyof Outputs]: (props: { o: Ok<Outputs[K]> }) => React.ReactNode } = {
  getSpendingSummary: SpendingSummary,
  compareSpending: CompareSpending,
  getCashflow: Cashflow,
  getDailySpending: Daily,
  searchTransactions: Transactions,
  getBudgetStatus: Budgets,
  getRecurring: Recurring,
  getAccounts: Accounts,
};

const PENDING_LABEL: Record<keyof Outputs, string> = {
  getSpendingSummary: "Adding up your spending…",
  compareSpending: "Comparing periods…",
  getCashflow: "Checking your cash flow…",
  getDailySpending: "Looking at daily spending…",
  searchTransactions: "Searching transactions…",
  getBudgetStatus: "Checking your budgets…",
  getRecurring: "Looking at recurring bills…",
  getAccounts: "Reading your accounts…",
};

/** Render one tool part: a pending line while it runs, then the chart from its output. */
export function ToolResult({ toolName, result }: { toolName: string; result?: unknown }) {
  if (!(toolName in RENDERERS)) return null;
  const name = toolName as keyof Outputs;
  if (result === undefined) {
    return <p className="my-1 text-xs text-muted-foreground">{PENDING_LABEL[name]}</p>;
  }
  if (result && typeof result === "object" && "error" in result) return null;
  const Renderer = RENDERERS[name] as (props: { o: unknown }) => React.ReactNode;
  return <Renderer o={result} />;
}
