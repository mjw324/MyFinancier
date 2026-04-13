import { type Metadata } from "next";
import { getServerSession } from "@/lib/auth/get-session";
import { getPlaidItemsByUserId } from "@/lib/db/queries/plaid-items";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlaidLinkButton } from "@/components/features/accounts/plaid-link-button";
import { UnlinkAccountDialog } from "@/components/features/settings/unlink-account-dialog";
import { formatRelativeDate } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "MyFinancier — Settings",
};

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  login_required: { label: "Login Required", variant: "destructive" },
  pending_expiration: { label: "Expiring Soon", variant: "outline" },
};

export default async function SettingsPage() {
  const session = await getServerSession();
  const user = session!.user;
  const plaidItems = await getPlaidItemsByUserId(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage your profile and linked accounts
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">Name</p>
            <p className="text-sm font-medium">{user.name}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{user.email}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Linked Accounts</CardTitle>
            <PlaidLinkButton />
          </div>
        </CardHeader>
        <CardContent>
          {plaidItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts linked yet. Click &quot;Link Account&quot; to get
              started.
            </p>
          ) : (
            <div className="divide-y">
              {plaidItems.map((item) => {
                const statusInfo = STATUS_LABELS[item.status] ?? {
                  label: item.status,
                  variant: "secondary" as const,
                };
                const needsReconnect =
                  item.status === "login_required" ||
                  item.status === "pending_expiration";

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {item.institutionName ?? "Unknown Institution"}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusInfo.variant} className="text-xs">
                          {statusInfo.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {item.financialAccounts.length} account
                          {item.financialAccounts.length !== 1 ? "s" : ""}
                        </span>
                        {item.updatedAt && (
                          <span className="text-xs text-muted-foreground">
                            · Updated {formatRelativeDate(item.updatedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {needsReconnect && (
                        <PlaidLinkButton
                          plaidItemId={item.id}
                          variant="outline"
                          size="sm"
                        />
                      )}
                      <UnlinkAccountDialog
                        plaidItemId={item.id}
                        institutionName={
                          item.institutionName ?? "Unknown Institution"
                        }
                        accountCount={item.financialAccounts.length}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
