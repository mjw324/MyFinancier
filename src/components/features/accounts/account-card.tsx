import { AlertTriangle } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  displayName,
  formatCurrency,
  formatDate,
  formatRelativeDate,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { AccountBalanceView } from "@/lib/utils/balances";
import { PlaidLinkButton } from "./plaid-link-button";
import type { PendingTxnPreview } from "@/lib/db/queries/accounts";

interface AccountCardProps {
  account: {
    id: string;
    name: string;
    officialName: string | null;
    type: string;
    subtype: string | null;
    mask?: string | null;
    balance: AccountBalanceView;
    pendingCount: number;
    pendingTransactions: PendingTxnPreview[];
    plaidItem: {
      id: string;
      institutionName: string | null;
      status: string;
    };
  };
}

const cents = (c: number | null) => (c ?? 0) / 100;

export function AccountCard({ account }: AccountCardProps) {
  const b = account.balance;
  const needsReconnect =
    b.state !== "closed" &&
    (account.plaidItem.status === "login_required" ||
      account.plaidItem.status === "pending_expiration");
  const isLiability = b.kind === "credit" || b.kind === "loan";
  const muted = b.state === "closed" || b.state === "unavailable";
  const showProjected =
    b.state !== "closed" &&
    account.pendingCount > 0 &&
    b.projectedCents !== null &&
    b.settledCents !== null &&
    b.projectedCents !== b.settledCents;

  return (
    <Card className={cn(b.state === "closed" && "opacity-70")}>
      <CardHeader>
        <CardDescription className="truncate text-xs">
          {account.plaidItem.institutionName ?? "Unknown institution"}
          {account.mask ? ` ·••• ${account.mask}` : ""}
        </CardDescription>
        <CardTitle className="text-base">{account.officialName || account.name}</CardTitle>
        <CardAction className="flex flex-col items-end gap-1">
          <Badge variant="secondary" className="capitalize">
            {account.subtype || account.type}
          </Badge>
          {b.state === "closed" && <Badge variant="outline">Closed</Badge>}
        </CardAction>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-2">
        {b.state === "unavailable" ? (
          <div>
            <p className="text-2xl font-semibold text-muted-foreground">Unavailable</p>
            <p className="text-xs text-muted-foreground">
              Your bank does not share a balance for this account, so it is
              left out of net worth.
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                muted
                  ? "text-muted-foreground"
                  : isLiability
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {isLiability && (b.settledCents ?? 0) > 0 ? "-" : ""}
              {formatCurrency(Math.abs(cents(b.settledCents)), b.currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {isLiability ? "Owed" : b.kind === "cash" ? "Current balance" : "Balance"}
              {b.kind === "cash" && b.availableCents !== null && b.availableCents !== b.settledCents &&
                ` · ${formatCurrency(cents(b.availableCents), b.currency)} available`}
            </p>
          </div>
        )}

        {b.kind === "credit" && b.state === "ok" && b.creditLimitCents !== null && b.utilization !== null && (
          <div className="flex flex-col gap-1">
            <Progress
              value={Math.min(100, b.utilization * 100)}
              className={cn("h-1.5", b.utilization > 0.9 && "[&>div]:bg-destructive")}
              aria-label="Credit used"
            />
            <p className="text-xs text-muted-foreground">
              {Math.round(b.utilization * 100)}% of{" "}
              {b.creditLimitEstimated ? "≈" : ""}
              {formatCurrency(cents(b.creditLimitCents), b.currency)} limit
            </p>
          </div>
        )}

        {showProjected && (
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums">
              {isLiability ? "-" : ""}
              {formatCurrency(Math.abs(cents(b.projectedCents)), b.currency)}
            </span>{" "}
            after{" "}
            <PendingPopover
              count={account.pendingCount}
              txns={account.pendingTransactions}
              currency={b.currency}
            />
          </p>
        )}

        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {b.state === "closed" && <p>Closed — not included in totals</p>}
          {b.state === "foreign_currency" && (
            <p>Not included in totals ({b.currency} is not converted)</p>
          )}
          {b.state !== "closed" && b.state !== "unavailable" && (
            <p className={cn("flex items-center gap-1", b.isStale && "text-foreground")}>
              {b.isStale && <AlertTriangle className="size-3.5 shrink-0" />}
              {b.balanceAsOf
                ? `${b.isStale ? "Balance last updated" : "Updated"} ${formatRelativeDate(b.balanceAsOf)}`
                : "Balance never updated"}
            </p>
          )}
        </div>

        {needsReconnect && (
          <div className="flex items-center justify-between gap-2">
            <Badge variant="destructive">
              {account.plaidItem.status === "login_required"
                ? "Login required"
                : "Expiring soon"}
            </Badge>
            <PlaidLinkButton plaidItemId={account.plaidItem.id} variant="outline" size="sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingPopover({
  count,
  txns,
  currency,
}: {
  count: number;
  txns: PendingTxnPreview[];
  currency: string;
}) {
  return (
    <Popover>
      <PopoverTrigger className="underline decoration-dotted underline-offset-2 hover:text-foreground">
        {count} pending
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="max-h-72 divide-y overflow-y-auto">
          {txns.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No pending transactions.
            </p>
          ) : (
            txns.map((t) => {
              const amt = parseFloat(t.amount);
              const isExpense = amt > 0;
              const label =
                displayName({
                  customName: t.customName,
                  merchantName: t.merchantName,
                }) || t.name;
              return (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(t.date)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-medium tabular-nums",
                      isExpense ? "text-foreground" : "text-green-600",
                    )}
                  >
                    {isExpense ? "-" : "+"}
                    {formatCurrency(Math.abs(amt), currency)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
