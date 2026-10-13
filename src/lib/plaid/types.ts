export interface LinkTokenResponse {
  linkToken: string;
  expiration: string;
}

/**
 * The subset of Plaid Link's `onSuccess` metadata the client forwards to
 * /api/plaid/exchange-token. It is UNTRUSTED: the server only uses it to look
 * for a duplicate Item before exchanging (Plaid's recommended check:
 * institution_id + account name + mask). The stored institution and accounts
 * always come from /item/get and /accounts/get.
 */
export interface PlaidLinkMetadata {
  institution: {
    name: string;
    institutionId: string;
  } | null;
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    type?: string;
    subtype?: string | null;
  }>;
}

export interface ExchangeTokenResponse {
  /** Our plaid_items row id. */
  plaidItemId: string;
  /** Plaid's item_id (kept for the harness / support tooling). */
  itemId: string;
  institutionName: string | null;
  /** Open accounts stored for the new Item. */
  accounts: number;
}

export interface UpdateCompleteResponse {
  plaidItemId: string;
  status: "active";
  /** Accounts that are newly shared (or re-shared) after update mode. */
  accountsAdded: number;
  /** Accounts Plaid no longer returns (de-selected or closed). */
  accountsClosed: number;
  /** Open accounts on the Item after the update. */
  accounts: number;
}

/** Error code returned with HTTP 409 when the user re-links a connection they already have. */
export const DUPLICATE_ITEM_CODE = "DUPLICATE_ITEM";
/** Error code returned with HTTP 409 when Plaid still reports an error after update mode. */
export const ITEM_NOT_HEALTHY_CODE = "ITEM_NOT_HEALTHY";

export type DuplicateItemErrorBody = {
  success: false;
  error: string;
  code: typeof DUPLICATE_ITEM_CODE;
  existingPlaidItemId: string;
};

/**
 * plaid_items.status values after which an Item is dead for good (never
 * synced, never offered update mode, and never treated as a duplicate of a new
 * link). Everything else (active, login_required, pending_*) is "live".
 */
export const TERMINAL_ITEM_STATUSES = ["revoked", "removed"] as const;

export interface AppTransaction {
  plaidTransactionId: string;
  accountId: string;
  amount: number;
  date: Date;
  name: string;
  merchantName: string | null;
  category: string | null;
  categoryId: string | null;
  pending: boolean;
}

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  cursor: string;
  accountsUpdated: number;
}

export const PLAID_ERROR_MESSAGES: Record<string, string> = {
  ITEM_LOGIN_REQUIRED:
    "Your bank connection needs to be re-authenticated. Please reconnect your account.",
  INVALID_CREDENTIALS: "The bank credentials provided are incorrect.",
  INSUFFICIENT_CREDENTIALS:
    "Additional information is needed to connect to your bank.",
  ITEM_LOCKED:
    "Your bank account is locked. Please contact your bank.",
  INSTITUTION_DOWN:
    "Your bank is currently experiencing issues. Please try again later.",
  INSTITUTION_NOT_RESPONDING:
    "Your bank is not responding. Please try again later.",
  PRODUCTS_NOT_SUPPORTED:
    "This bank does not support the requested features.",
  INVALID_PUBLIC_TOKEN:
    "That bank connection session expired. Please start the connection again.",
  ACCESS_NOT_GRANTED:
    "Access to your accounts wasn't granted. Please connect again and allow access.",
  NO_ACCOUNTS:
    "No eligible accounts were found at this bank. Please connect again and select an account.",
  ITEM_NOT_SUPPORTED:
    "This bank connection isn't supported. Please try a different account.",
  DEFAULT:
    "An unexpected error occurred with your bank connection. Please try again.",
};

/** User-facing message for a Plaid error code (never the raw Plaid message). */
export function plaidErrorMessage(code: string | null | undefined): string {
  return (code && PLAID_ERROR_MESSAGES[code]) || PLAID_ERROR_MESSAGES.DEFAULT;
}
