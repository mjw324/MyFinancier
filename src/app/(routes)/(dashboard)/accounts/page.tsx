import { type Metadata } from "next";
import { Landmark } from "lucide-react";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getAccountsWithBalances,
  summarizeBalances,
  type AccountWithBalances,
} from "@/lib/db/queries/accounts";
import { AccountCard } from "@/components/features/accounts/account-card";
import { PlaidLinkButton } from "@/components/features/accounts/plaid-link-button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { AccountKind } from "@/lib/utils/balances";

export const metadata: Metadata = {
  title: "MyFinancier — Accounts",
};

const SECTIONS: Array<{ kind: AccountKind; title: string }> = [
  { kind: "cash", title: "Cash" },
  { kind: "credit", title: "Credit cards" },
  { kind: "loan", title: "Loans" },
  { kind: "investment", title: "Investments" },
  { kind: "other", title: "Other" },
];

export default async function AccountsPage() {
  const session = await getServerSession();
  const accounts = await getAccountsWithBalances(session!.user.id);
  const summary = summarizeBalances(accounts.map((a) => a.balance));
  const open = accounts.filter((a) => a.balance.state !== "closed");
  const closed = accounts.filter((a) => a.balance.state === "closed");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Linked accounts</h2>
          <p className="text-sm text-muted-foreground">
            {open.length} open account{open.length !== 1 ? "s" : ""}
            {closed.length > 0 && ` · ${closed.length} closed`}
          </p>
        </div>
        <PlaidLinkButton />
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-12 text-center">
          <Landmark className="size-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No accounts linked</h3>
          <p className="mb-2 text-sm text-muted-foreground">
            Connect your bank account to start tracking your finances
          </p>
          <PlaidLinkButton>Link Your First Account</PlaidLinkButton>
        </div>
      ) : (
        <>
          <Card className="py-4">
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Stat label="Net worth" value={summary.netWorth} strong />
              <Stat label="Cash" value={summary.liquidCash} />
              <Stat label="Card debt" value={summary.creditDebt ? -summary.creditDebt : 0} />
              <Stat label="Loans" value={summary.loanDebt ? -summary.loanDebt : 0} />
              <Stat label="Investments" value={summary.investments} />
              {(summary.unavailableAccounts.length > 0 ||
                summary.foreignCurrencyAccounts.length > 0 ||
                summary.staleAccounts.length > 0) && (
                <p className="col-span-full text-xs text-muted-foreground">
                  {[
                    summary.unavailableAccounts.length > 0 &&
                      `${summary.unavailableAccounts.length} account${summary.unavailableAccounts.length === 1 ? "" : "s"} without a balance not included`,
                    summary.foreignCurrencyAccounts.length > 0 &&
                      `${summary.foreignCurrencyAccounts.length} non-USD account${summary.foreignCurrencyAccounts.length === 1 ? "" : "s"} not included`,
                    summary.staleAccounts.length > 0 &&
                      `${summary.staleAccounts.length} balance${summary.staleAccounts.length === 1 ? " is" : "s are"} more than 3 days old`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </CardContent>
          </Card>

          {SECTIONS.map(({ kind, title }) => (
            <Section
              key={kind}
              title={title}
              accounts={open.filter((a) => a.balance.kind === kind)}
            />
          ))}
          <Section title="Closed accounts" accounts={closed} />
        </>
      )}
    </div>
  );
}

function Section({ title, accounts }: { title: string; accounts: AccountWithBalances[] }) {
  if (accounts.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular-nums",
          strong ? "text-lg font-semibold" : "font-medium",
          value === null && "text-muted-foreground",
        )}
      >
        {value === null ? "Unavailable" : formatCurrency(value)}
      </p>
    </div>
  );
}
