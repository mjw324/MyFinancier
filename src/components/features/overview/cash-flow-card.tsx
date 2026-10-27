import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/format";
import {
  FLOW_CLASSES,
  FLOW_CLASS_GROUP,
  FLOW_CLASS_LABEL,
  type FlowGroup,
} from "@/lib/analytics/flow";
import { savingsRate, type CashFlow } from "@/lib/analytics/metrics";
import { computeDelta } from "@/lib/analytics/trends";
import {
  FLOW_GROUP_LABELS,
  formatMoneyShort,
  formatPointsDelta,
  formatRatio,
  formatSignedRatio,
} from "@/lib/analytics/labels";
import { transactionsHref } from "@/lib/utils/date-ranges";

interface CashFlowCardProps {
  flow: CashFlow;
  title: string;
  range: { from: string; to: string };
  /** Complete periods only; null hides the comparison. */
  previous: { label: string; flow: CashFlow } | null;
  /** Optional "Explain" control (AI), shown in the header. */
  explain?: React.ReactNode;
}

function signed(n: number): string {
  if (n === 0) return formatCurrency(0);
  return `${n > 0 ? "+" : "−"}${formatCurrency(Math.abs(n))}`;
}

function deltaText(current: number, previous: number): string {
  const d = computeDelta(current, previous);
  if (d.direction === "flat") return "no change";
  if (d.ratio !== null) return formatSignedRatio(d.ratio);
  return `${d.absolute > 0 ? "+" : "−"}${formatMoneyShort(d.absolute)}`;
}

/**
 * The headline: money in, spending, saved/moved, and the net change — with the
 * identity written out so the four numbers can be checked against each other.
 */
export function CashFlowCard({ flow, title, range, previous, explain }: CashFlowCardProps) {
  const rate = savingsRate(flow);
  const prevRate = previous ? savingsRate(previous.flow) : null;
  const vs = previous ? `vs ${previous.label}` : null;
  const uncounted = flow.unclassifiedCount + flow.stalePendingCount;

  const tiles = [
    {
      label: "Money in",
      value: formatCurrency(flow.moneyIn),
      note:
        flow.otherIncome > 0
          ? `${formatMoneyShort(flow.income)} income · ${formatMoneyShort(flow.otherIncome)} other`
          : "Income",
      delta: previous ? deltaText(flow.moneyIn, previous.flow.moneyIn) : null,
      href: transactionsHref({ ...range, flowGroup: "income" }),
    },
    {
      label: "Spending",
      value: formatCurrency(flow.netSpending),
      note:
        flow.offsets > 0
          ? `${formatMoneyShort(flow.grossSpending)} spent · ${formatMoneyShort(flow.offsets)} back`
          : "Net of refunds",
      delta: previous ? deltaText(flow.netSpending, previous.flow.netSpending) : null,
      href: transactionsHref({ ...range, view: "spending" }),
    },
    {
      label: "Saved / moved",
      value: formatCurrency(flow.savedNet),
      note:
        rate !== null && flow.savedNet > 0
          ? `${formatRatio(rate)} of money in`
          : flow.savedIn > 0
            ? `${formatMoneyShort(flow.savedIn)} came back`
            : "To savings & investments",
      delta:
        previous && rate !== null && prevRate !== null
          ? formatPointsDelta(prevRate, rate)
          : previous
            ? deltaText(flow.savedNet, previous.flow.savedNet)
            : null,
      href: transactionsHref({ ...range, flowGroup: "savings" }),
    },
    {
      label: "Net change",
      value: signed(flow.netChange),
      note: flow.netChange < 0 ? "More went out than came in" : "In − spending − saved",
      delta: previous ? deltaText(flow.netChange, previous.flow.netChange) : null,
      href: transactionsHref(range),
      negative: flow.netChange < 0,
    },
  ];

  const groups: FlowGroup[] = ["income", "spending", "offset", "savings", "internal"];

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Cash flow</CardTitle>
        <CardDescription>{title}</CardDescription>
        <CardAction className="flex items-center gap-1">
          {explain}
          <Link
            href={transactionsHref(range)}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            Transactions
            <ChevronRight className="size-4" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="@container flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="min-w-0 rounded-lg border p-3">
              <dt>
                <Link href={t.href} className="text-xs text-muted-foreground hover:underline">
                  {t.label}
                </Link>
              </dt>
              <dd
                className={cn(
                  "mt-1 text-xl font-semibold [overflow-wrap:anywhere] @4xl:text-2xl",
                  t.negative && "text-destructive-foreground",
                )}
              >
                {t.value}
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">{t.note}</dd>
              {t.delta && vs && (
                <dd className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t.delta}</span> {vs}
                </dd>
              )}
            </div>
          ))}
        </dl>

        {/* The identity, stated rather than implied. */}
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatCurrency(flow.moneyIn)} in − {formatCurrency(flow.netSpending)} spending −{" "}
          {formatCurrency(flow.savedNet)} saved/moved ={" "}
          <span className={cn("font-medium text-foreground", flow.netChange < 0 && "text-destructive-foreground")}>
            {signed(flow.netChange)}
          </span>
          {!previous && " · comparisons appear once a period is complete"}
        </p>

        {uncounted > 0 && (
          <p className="text-xs text-muted-foreground" role="status">
            {flow.unclassifiedCount > 0 &&
              `${flow.unclassifiedCount} transaction${flow.unclassifiedCount === 1 ? " isn't" : "s aren't"} classified yet and ${flow.unclassifiedCount === 1 ? "isn't" : "aren't"} counted. `}
            {flow.stalePendingCount > 0 &&
              `${flow.stalePendingCount} pending transaction${flow.stalePendingCount === 1 ? " is" : "s are"} too old to trust and left out.`}
          </p>
        )}

        {Object.keys(flow.byClass).length > 0 && (
        <details className="group rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Breakdown by type</summary>
          <div className="mt-2 flex flex-col gap-3 pb-1">
            {groups.map((group) => {
              const rows = FLOW_CLASSES.filter(
                (c) => FLOW_CLASS_GROUP[c] === group && flow.byClass[c],
              );
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <p className="text-xs font-medium text-muted-foreground">
                    {FLOW_GROUP_LABELS[group]}
                    {group === "internal" && " (not counted)"}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {rows.map((c) => (
                      <li key={c} className="flex items-baseline justify-between gap-3 text-sm">
                        <Link
                          href={transactionsHref({ ...range, flowClass: c })}
                          className="truncate hover:underline"
                        >
                          {FLOW_CLASS_LABEL[c]}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ×{flow.byClass[c]!.count}
                          </span>
                        </Link>
                        <span className="shrink-0 tabular-nums">
                          {formatCurrency(flow.byClass[c]!.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
        )}
      </CardContent>
    </Card>
  );
}
