/**
 * Client-side Plaid Link session flow shared by <PlaidLinkButton> and the
 * OAuth return page (/plaid/oauth):
 *
 *  - new link:    create-link-token → Link → exchange-token
 *                 (409 DUPLICATE_ITEM → relaunch Link in update mode with
 *                 account selection on the existing connection)
 *  - update mode: create-link-token {plaidItemId} → Link → update-complete
 *                 (no token exchange: the access token does not change)
 *
 * The session is kept in sessionStorage so an OAuth redirect can resume it.
 * Only server-mapped, user-friendly messages are shown; Plaid's raw errors
 * never reach the UI.
 */
import type { PlaidLinkOnSuccessMetadata } from "react-plaid-link";

export type LinkSession = {
  token: string;
  mode: "new" | "update";
  /** Update mode: the connection being updated. */
  plaidItemId?: string;
  /** Update mode with account selection ("Add accounts"). */
  accountSelection?: boolean;
  /** Where to go after an OAuth redirect completes. */
  returnTo?: string;
};

export type LinkOutcome =
  | { kind: "linked"; institutionName: string | null; accounts: number }
  | { kind: "updated"; accountsAdded: number; accountsClosed: number }
  | { kind: "duplicate"; existingPlaidItemId: string; message: string }
  | { kind: "error"; message: string };

const SESSION_KEY = "plaid_link_session";
// Written by older bundles; read as a new-link session.
const LEGACY_TOKEN_KEY = "plaid_link_token";

const GENERIC_ERROR = "Failed to connect your bank. Please try again.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveLinkSession(session: LinkSession): void {
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadLinkSession(): LinkSession | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(SESSION_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LinkSession;
      if (typeof parsed.token === "string" && parsed.token) return parsed;
    } catch {
      // fall through
    }
  }
  const legacy = store.getItem(LEGACY_TOKEN_KEY);
  return legacy ? { token: legacy, mode: "new" } : null;
}

export function clearLinkSession(): void {
  const store = storage();
  store?.removeItem(SESSION_KEY);
  store?.removeItem(LEGACY_TOKEN_KEY);
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

function errorText(json: Record<string, unknown> | null, fallback: string): string {
  return typeof json?.error === "string" && json.error ? json.error : fallback;
}

/** Create a Link token (new link, or update mode when `plaidItemId` is given) and persist the session. */
export async function startLinkSession(opts: {
  plaidItemId?: string;
  accountSelection?: boolean;
  returnTo?: string;
}): Promise<{ ok: true; session: LinkSession } | { ok: false; message: string }> {
  try {
    const { json } = await postJson(
      "/api/plaid/create-link-token",
      opts.plaidItemId
        ? {
            plaidItemId: opts.plaidItemId,
            ...(opts.accountSelection ? { accountSelection: true } : {}),
          }
        : {},
    );
    const data = json?.data as { linkToken?: unknown } | undefined;
    if (!json?.success || typeof data?.linkToken !== "string") {
      return { ok: false, message: errorText(json, "Failed to start the bank connection. Please try again.") };
    }
    const session: LinkSession = {
      token: data.linkToken,
      mode: opts.plaidItemId ? "update" : "new",
      plaidItemId: opts.plaidItemId,
      accountSelection: opts.accountSelection || undefined,
      returnTo: opts.returnTo,
    };
    saveLinkSession(session);
    return { ok: true, session };
  } catch {
    return { ok: false, message: "Failed to start the bank connection. Please try again." };
  }
}

/** Finish a Link session after Plaid Link's onSuccess. */
export async function completeLinkSession(
  session: LinkSession,
  publicToken: string | null,
  metadata: PlaidLinkOnSuccessMetadata | null,
): Promise<LinkOutcome> {
  try {
    if (session.mode === "update" && session.plaidItemId) {
      const { json } = await postJson("/api/plaid/update-complete", {
        plaidItemId: session.plaidItemId,
        ...(session.accountSelection ? { accountSelection: true } : {}),
      });
      if (!json?.success) {
        return { kind: "error", message: errorText(json, GENERIC_ERROR) };
      }
      const data = json.data as { accountsAdded?: number; accountsClosed?: number };
      return {
        kind: "updated",
        accountsAdded: data.accountsAdded ?? 0,
        accountsClosed: data.accountsClosed ?? 0,
      };
    }

    if (!publicToken) return { kind: "error", message: GENERIC_ERROR };

    const { status, json } = await postJson("/api/plaid/exchange-token", {
      publicToken,
      metadata: {
        institution: metadata?.institution
          ? {
              name: metadata.institution.name,
              institutionId: metadata.institution.institution_id,
            }
          : null,
        accounts: (metadata?.accounts ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          mask: a.mask ?? null,
          type: a.type,
          subtype: a.subtype ?? null,
        })),
      },
    });
    if (json?.success) {
      const data = json.data as { institutionName?: string | null; accounts?: number };
      return {
        kind: "linked",
        institutionName: data.institutionName ?? null,
        accounts: data.accounts ?? 0,
      };
    }
    if (
      status === 409 &&
      json?.code === "DUPLICATE_ITEM" &&
      typeof json.existingPlaidItemId === "string"
    ) {
      return {
        kind: "duplicate",
        existingPlaidItemId: json.existingPlaidItemId,
        message: errorText(json, "This bank is already connected."),
      };
    }
    return { kind: "error", message: errorText(json, GENERIC_ERROR) };
  } catch {
    return { kind: "error", message: GENERIC_ERROR };
  }
}

/** Toast text for a successful outcome. */
export function successMessage(
  outcome: Extract<LinkOutcome, { kind: "linked" | "updated" }>,
): string {
  if (outcome.kind === "linked") {
    const bank = outcome.institutionName ?? "Your bank";
    return `${bank} connected. Your transactions will appear shortly.`;
  }
  const parts: string[] = [];
  if (outcome.accountsAdded > 0) {
    parts.push(`${outcome.accountsAdded} account${outcome.accountsAdded === 1 ? "" : "s"} added`);
  }
  if (outcome.accountsClosed > 0) {
    parts.push(`${outcome.accountsClosed} account${outcome.accountsClosed === 1 ? "" : "s"} no longer shared`);
  }
  return parts.length > 0
    ? `Connection updated: ${parts.join(", ")}.`
    : "Connection updated.";
}
