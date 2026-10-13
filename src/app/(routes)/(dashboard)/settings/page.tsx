import { type Metadata } from "next";
import { getServerSession } from "@/lib/auth/get-session";
import { getPlaidItemsByUserId } from "@/lib/db/queries/plaid-items";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaidLinkButton } from "@/components/features/accounts/plaid-link-button";
import { LinkedItemRow } from "@/components/features/settings/linked-item-row";
import { TwoFactorCard } from "@/components/features/settings/two-factor-card";
import { ResetCustomizationsDialog } from "@/components/features/settings/reset-customizations-dialog";
import { SpendingRulesSection } from "@/components/features/settings/spending-rules-section";
import { DisplayPreferencesCard } from "@/components/features/settings/display-preferences-card";
import { listSpendingRules } from "@/lib/db/queries/spending-rules";
import { getUserPreferences } from "@/lib/db/queries/user-preferences";
import { getUserTimeZone } from "@/lib/utils/user-time";

export const metadata: Metadata = {
  title: "MyFinancier — Settings",
};

export default async function SettingsPage() {
  const session = await getServerSession();
  const user = session!.user;
  const [plaidItems, spendingRules, prefs, timeZone] = await Promise.all([
    getPlaidItemsByUserId(user.id),
    listSpendingRules(user.id),
    getUserPreferences(user.id),
    getUserTimeZone(),
  ]);
  const now = new Date();

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

      <TwoFactorCard twoFactorEnabled={user.twoFactorEnabled ?? false} />

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
              {plaidItems.map((item) => (
                <LinkedItemRow
                  key={item.id}
                  now={now}
                  timeZone={timeZone}
                  item={{
                    id: item.id,
                    institutionName: item.institutionName,
                    status: item.status,
                    attention: item.attention,
                    consentExpiresAt: item.consentExpiresAt,
                    lastSyncErrorCode: item.lastSyncErrorCode,
                    lastSuccessfulSyncAt: item.lastSuccessfulSyncAt,
                    openAccountCount: item.financialAccounts.filter(
                      (a) => a.closedAt === null,
                    ).length,
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spending Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <SpendingRulesSection rules={spendingRules} />
        </CardContent>
      </Card>

      <DisplayPreferencesCard
        hideTransfersFromList={prefs.hideTransfersFromList}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Transaction Customizations</CardTitle>
            <ResetCustomizationsDialog />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Click any transaction to give it a nickname or change its category.
            For recurring transactions, edits apply to all past and future
            occurrences. Use &quot;Reset all&quot; to clear every override and
            restore the original values from Plaid.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
