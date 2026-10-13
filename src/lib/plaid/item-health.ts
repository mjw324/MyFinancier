/**
 * What the Settings page shows about one Plaid connection, derived from the
 * plaid_items lifecycle columns. Pure, so it is unit-tested directly.
 *
 * `status` gates syncing (written by the sync pipeline / webhooks);
 * `attention` holds non-blocking prompts ('login_required',
 * 'pending_disconnect', 'pending_expiration', 'new_accounts_available',
 * 'revoked'); `consentExpiresAt` comes from /item/get.
 */

export type ItemHealthInput = {
  status: string;
  attention: string | null;
  consentExpiresAt: Date | null;
  lastSyncErrorCode: string | null;
};

/** The Plaid Link update-mode flow a button should launch. */
export type ItemAction = "reconnect" | "renew" | "add_accounts";

export type ItemIssue =
  | { kind: "reconnect"; label: "Reconnect needed" }
  | { kind: "revoked"; label: "Access revoked" }
  | { kind: "expiring"; label: string; expiresAt: Date | null }
  | { kind: "new_accounts"; label: "New accounts available" }
  | { kind: "sync_failed"; label: "Last sync failed" };

export type ItemHealth = {
  /** "ok" = nothing to do; "warning" = works but wants the user; "error" = not updating. */
  level: "ok" | "warning" | "error";
  issues: ItemIssue[];
  /** The most important fix, if any (drives the primary button). */
  primaryAction: ItemAction | null;
  /** Whether the Sync button makes sense (the connection is not broken). */
  canSync: boolean;
};

/** Consent expiring within this window is surfaced even without a webhook. */
export const CONSENT_WARNING_DAYS = 14;

const LOGIN_STATUSES = new Set(["login_required", "error"]);
const KNOWN_STATUSES = new Set([
  "active",
  "login_required",
  "error",
  "pending_expiration",
  "pending_disconnect",
  "revoked",
]);

export function getItemHealth(
  item: ItemHealthInput,
  now: Date = new Date(),
): ItemHealth {
  const issues: ItemIssue[] = [];
  const attention = item.attention;

  const revoked = item.status === "revoked" || attention === "revoked";
  const needsLogin =
    !revoked &&
    (LOGIN_STATUSES.has(item.status) ||
      attention === "login_required" ||
      !KNOWN_STATUSES.has(item.status));

  if (revoked) issues.push({ kind: "revoked", label: "Access revoked" });
  if (needsLogin) issues.push({ kind: "reconnect", label: "Reconnect needed" });

  const consentSoon =
    item.consentExpiresAt != null &&
    item.consentExpiresAt.getTime() - now.getTime() <=
      CONSENT_WARNING_DAYS * 86_400_000;
  const expiring =
    !revoked &&
    !needsLogin &&
    (attention === "pending_disconnect" ||
      attention === "pending_expiration" ||
      item.status === "pending_expiration" ||
      item.status === "pending_disconnect" ||
      consentSoon);
  if (expiring) {
    issues.push({
      kind: "expiring",
      label: item.consentExpiresAt ? "Connection expiring" : "Connection expiring soon",
      expiresAt: item.consentExpiresAt,
    });
  }

  if (attention === "new_accounts_available" && !revoked && !needsLogin) {
    issues.push({ kind: "new_accounts", label: "New accounts available" });
  }

  if (item.lastSyncErrorCode && !revoked && !needsLogin) {
    issues.push({ kind: "sync_failed", label: "Last sync failed" });
  }

  const broken = revoked || needsLogin;
  const primaryAction: ItemAction | null = broken
    ? "reconnect"
    : expiring
      ? "renew"
      : attention === "new_accounts_available"
        ? "add_accounts"
        : null;

  return {
    level: broken ? "error" : issues.length > 0 ? "warning" : "ok",
    issues,
    primaryAction,
    canSync: !broken,
  };
}

/** An instant (not a calendar date) as e.g. "Apr 20, 2027" in the viewer's time zone. */
export function formatInstantDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
