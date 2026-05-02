import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { isLiabilityType } from "@/lib/utils/account-type";
import { cn } from "@/lib/utils";
import { PlaidLinkButton } from "./plaid-link-button";
import type { PendingTxnPreview } from "@/lib/db/queries/accounts";

interface AccountCardProps {
  account: {
    id: string;
    name: string;
    officialName: string | null;
    type: string;
    subtype: string | null;
    currentBalance: string | null;
    availableBalance: string | null;
    isoCurrencyCode: string | null;
    lastSyncedAt: Date | null;
    settledBalance: number;
    projectedBalance: number;
    pendingCount: number;
    pendingSum: number;
    pendingTransactions: PendingTxnPreview[];
    plaidItem: {
      id: string;
      institutionName: string | null;
      status: string;
    };
  };
}

export function AccountCard({ account }: AccountCardProps) {
  const needsReconnect =
    account.plaidItem.status === "login_required" ||
    account.plaidItem.status === "pending_expiration";
  const isLiability = isLiabilityType(account.type);
  const currency = account.isoCurrencyCode ?? "USD";

  const settled = account.settledBalance;
  const projected = account.projectedBalance;
  const showProjected =
    account.pendingCount > 0 && Math.abs(projected - settled) > 0.005;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">
              {account.plaidItem.institutionName ?? "Unknown Institution"}
            </p>
            <CardTitle className="text-base">
              {account.officialName || account.name}
            </CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs capitalize">
            {account.subtype || account.type}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="mt-auto">
        <div className="flex items-end justify-between">
          <div className="min-w-0">
            <p
              className={cn(
                "text-2xl font-bold",
                isLiability
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {isLiability ? "-" : ""}
              {formatCurrency(settled, currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {isLiability ? "Owed" : "Settled"}
              {account.lastSyncedAt &&
                ` · synced ${formatRelativeDate(account.lastSyncedAt)}`}
            </p>
            {showProjected && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {isLiability ? "-" : ""}
                  {formatCurrency(projected, currency)}
                </span>{" "}
                projected ·{" "}
                <PendingPopover
                  count={account.pendingCount}
                  txns={account.pendingTransactions}
                  currency={currency}
                />
              </p>
            )}
          </div>
          {needsReconnect && (
            <div className="flex flex-col items-end gap-1">
              <Badge variant="destructive" className="text-xs">
                {account.plaidItem.status === "login_required"
                  ? "Login Required"
                  : "Expiring Soon"}
              </Badge>
              <PlaidLinkButton
                plaidItemId={account.plaidItem.id}
                variant="outline"
                size="sm"
              />
            </div>
          )}
        </div>
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
        <div className="max-h-72 overflow-y-auto divide-y">
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
