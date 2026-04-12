export interface LinkTokenResponse {
  linkToken: string;
  expiration: string;
}

export interface PlaidLinkMetadata {
  institution: {
    name: string;
    institutionId: string;
  };
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string | null;
  }>;
}

export interface ExchangeTokenResponse {
  itemId: string;
  accounts: number;
}

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
  DEFAULT:
    "An unexpected error occurred with your bank connection. Please try again.",
};
