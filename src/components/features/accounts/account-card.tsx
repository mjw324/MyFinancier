import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatRelativeDate } from "@/lib/utils/format";
import { PlaidLinkButton } from "./plaid-link-button";

interface AccountCardProps {
  account: {
    id: string;
    name: string;
    officialName: string | null;
    type: string;
    subtype: string | null;
    currentBalance: string | null;
    isoCurrencyCode: string | null;
    lastSyncedAt: Date | null;
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
          <div>
            <p className="text-2xl font-bold">
              {formatCurrency(
                account.currentBalance,
                account.isoCurrencyCode ?? "USD",
              )}
            </p>
            {account.lastSyncedAt && (
              <p className="text-xs text-muted-foreground">
                Synced {formatRelativeDate(account.lastSyncedAt)}
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
