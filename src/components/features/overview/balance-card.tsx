import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatRelativeDate } from "@/lib/utils/format";
import type { BalanceSummary } from "@/lib/db/queries/accounts";

function updatedPhrase(d: Date): string {
  const rel = formatRelativeDate(d);
  return rel === "Yesterday" || rel === "Just now" ? rel.toLowerCase() : rel;
}

/**
 * Net worth and liquid cash from current balances (getBalanceSummary). Liquid
 * cash is depository only — what can actually be spent this week. Unknown
 * balances say "unavailable" instead of counting as $0.
 */
export function BalanceCard({ summary, accountCount }: { summary: BalanceSummary; accountCount: number }) {
  if (accountCount === 0) {
    return (
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base">Balances</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No accounts linked yet.{" "}
            <Link href="/accounts" className="text-foreground underline">
              Link an account
            </Link>{" "}
            to see your net worth.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows: Array<{ label: string; value: string; muted?: boolean }> = [
    { label: "Liquid cash", value: formatCurrency(summary.liquidCash) },
    {
      label: "Investments",
      value: summary.investments === null ? "Unavailable" : formatCurrency(summary.investments),
      muted: summary.investments === null,
    },
    { label: "Card balances", value: `−${formatCurrency(summary.creditDebt)}` },
    { label: "Loans", value: `−${formatCurrency(summary.loanDebt)}` },
  ];

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Net worth</CardTitle>
        <CardDescription>
          {summary.asOf ? `Updated ${updatedPhrase(summary.asOf)}` : "Current balances"}
        </CardDescription>
        <CardAction>
          <Link
            href="/accounts"
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            Accounts
            <ChevronRight className="size-4" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-3xl font-semibold">
          {summary.netWorth < 0 ? "−" : ""}
          {formatCurrency(Math.abs(summary.netWorth))}
        </p>
        <dl className="flex flex-col gap-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className={r.muted ? "text-muted-foreground" : "tabular-nums"}>{r.value}</dd>
            </div>
          ))}
        </dl>
        {summary.investments === null && (
          <p className="text-xs text-muted-foreground">
            Investment balances aren&rsquo;t available from your bank, so net worth leaves them out.
          </p>
        )}
        {summary.staleAccounts.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {summary.staleAccounts.length === 1
                ? `${summary.staleAccounts[0].name} hasn't updated in a few days`
                : `${summary.staleAccounts.length} accounts haven't updated in a few days`}
              , so these figures may be behind.{" "}
              <Link href="/settings" className="underline">
                Check connections
              </Link>
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
