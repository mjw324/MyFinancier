import { type Metadata } from "next";
import { getServerSession } from "@/lib/auth/get-session";
import { getAccountsByUserId } from "@/lib/db/queries/accounts";
import { AccountCard } from "@/components/features/accounts/account-card";
import { PlaidLinkButton } from "@/components/features/accounts/plaid-link-button";
import { Landmark } from "lucide-react";

export const metadata: Metadata = {
  title: "MyFinancier — Accounts",
};

export default async function AccountsPage() {
  const session = await getServerSession();
  const accounts = await getAccountsByUserId(session!.user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Linked Accounts</h2>
          <p className="text-sm text-muted-foreground">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} connected
          </p>
        </div>
        <PlaidLinkButton />
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Landmark className="mb-4 size-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">No accounts linked</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Connect your bank account to start tracking your finances
          </p>
          <PlaidLinkButton>Link Your First Account</PlaidLinkButton>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
    </div>
  );
}
