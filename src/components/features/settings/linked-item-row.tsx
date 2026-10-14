import { Badge } from "@/components/ui/badge";
import { PlaidLinkButton } from "@/components/features/accounts/plaid-link-button";
import { SyncAccountButton } from "@/components/features/settings/sync-account-button";
import { UnlinkAccountDialog } from "@/components/features/settings/unlink-account-dialog";
import {
  formatInstantDate,
  getItemHealth,
  type ItemHealthInput,
  type ItemIssue,
} from "@/lib/plaid/item-health";
import { formatRelativeDate } from "@/lib/utils/format";

export type LinkedItemRowProps = {
  item: ItemHealthInput & {
    id: string;
    institutionName: string | null;
    lastSuccessfulSyncAt: Date | null;
    openAccountCount: number;
    /** Masks of the open accounts, to tell two logins at one bank apart. */
    accountMasks?: string[];
  };
  /** Viewer's IANA time zone, for the consent-expiry date. */
  timeZone: string;
  now?: Date;
};

const BADGE_VARIANT: Record<ItemIssue["kind"], "destructive" | "outline" | "secondary"> = {
  reconnect: "destructive",
  revoked: "destructive",
  expiring: "outline",
  new_accounts: "secondary",
  sync_failed: "outline",
};

function issueDetail(issue: ItemIssue, timeZone: string): string | null {
  switch (issue.kind) {
    case "reconnect":
      return "Your bank needs you to sign in again before this connection can update.";
    case "revoked":
      return "Access to this connection was revoked. Reconnect to keep it updating.";
    case "expiring":
      return issue.expiresAt
        ? `Connection expiring on ${formatInstantDate(issue.expiresAt, timeZone)}. Renew it to keep it updating.`
        : "This connection expires soon. Renew it to keep it updating.";
    case "new_accounts":
      return "Your bank has accounts you haven't shared yet.";
    case "sync_failed":
      return null;
  }
}

/** One Plaid connection in Settings: health badges, last sync, and actions. */
export function LinkedItemRow({ item, timeZone, now = new Date() }: LinkedItemRowProps) {
  const health = getItemHealth(item, now);
  const name = item.institutionName ?? "Unknown Institution";
  const masks = item.accountMasks ?? [];
  const maskHint =
    masks.length === 0
      ? ""
      : ` (${masks.slice(0, 3).map((m) => `••${m}`).join(", ")}${masks.length > 3 ? ` +${masks.length - 3}` : ""})`;
  const details = health.issues
    .map((issue) => issueDetail(issue, timeZone))
    .filter((d): d is string => d !== null);

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{name}</p>
          {health.level === "ok" ? (
            <Badge variant="secondary" className="text-xs">
              Connected
            </Badge>
          ) : (
            health.issues.map((issue) => (
              <Badge
                key={issue.kind}
                variant={BADGE_VARIANT[issue.kind]}
                className="text-xs"
              >
                {issue.label}
              </Badge>
            ))
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {item.openAccountCount} account{item.openAccountCount !== 1 ? "s" : ""}
          {maskHint}
          {" · "}
          {item.lastSuccessfulSyncAt
            ? `Last synced ${formatRelativeDate(item.lastSuccessfulSyncAt)}`
            : "Not synced yet"}
        </p>
        {details.map((detail) => (
          <p key={detail} className="text-xs text-muted-foreground">
            {detail}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        {health.primaryAction && (
          <PlaidLinkButton
            plaidItemId={item.id}
            action={health.primaryAction}
            variant={health.level === "error" ? "default" : "outline"}
            size="sm"
          />
        )}
        {health.canSync && (
          <SyncAccountButton plaidItemId={item.id} institutionName={name} />
        )}
        {health.canSync && health.primaryAction !== "add_accounts" && (
          <PlaidLinkButton
            plaidItemId={item.id}
            action="add_accounts"
            variant="ghost"
            size="sm"
          />
        )}
        <UnlinkAccountDialog
          plaidItemId={item.id}
          institutionName={name}
          accountCount={item.openAccountCount}
        />
      </div>
    </div>
  );
}
