/**
 * Synthetic Plaid API shapes for tests. Generic merchants and round amounts
 * only — never production data.
 */
import type { AccountBase, Transaction as PlaidTransaction } from "plaid";

export function plaidAccount(
  id: string,
  over: Partial<AccountBase> = {},
): AccountBase {
  return {
    account_id: id,
    name: `Account ${id}`,
    official_name: null,
    mask: "0000",
    type: "depository",
    subtype: "checking",
    balances: {
      current: 100,
      available: 100,
      limit: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
    ...over,
  } as AccountBase;
}

export function plaidTxn(
  id: string,
  accountId: string,
  over: Partial<PlaidTransaction> = {},
): PlaidTransaction {
  return {
    transaction_id: id,
    account_id: accountId,
    amount: 12.5,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    date: "2026-04-15",
    authorized_date: null,
    name: "Coffee Shop",
    merchant_name: "Coffee Shop",
    pending: false,
    pending_transaction_id: null,
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_COFFEE",
      confidence_level: "HIGH",
    },
    ...over,
  } as PlaidTransaction;
}

export type SyncPage = {
  added?: PlaidTransaction[];
  modified?: PlaidTransaction[];
  removed?: string[];
  accounts?: AccountBase[];
  next_cursor: string;
  has_more?: boolean;
  transactions_update_status?: string;
};

/** Build a `/transactions/sync` axios-style response for a page. */
export function syncResponse(page: SyncPage) {
  return {
    data: {
      added: page.added ?? [],
      modified: page.modified ?? [],
      removed: (page.removed ?? []).map((transaction_id) => ({
        transaction_id,
      })),
      accounts: page.accounts ?? [],
      next_cursor: page.next_cursor,
      has_more: page.has_more ?? false,
      transactions_update_status:
        page.transactions_update_status ?? "HISTORICAL_UPDATE_COMPLETE",
      request_id: "req_test",
    },
  };
}

/** An axios-like Plaid API error (no config/headers: tests never carry secrets). */
export function plaidApiError(
  errorCode: string,
  status = 400,
  errorType = "ITEM_ERROR",
) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    name: "AxiosError",
    response: {
      status,
      data: {
        error_type: errorType,
        error_code: errorCode,
        error_message: `synthetic ${errorCode}`,
        request_id: "req_test",
      },
    },
  });
}

/**
 * A `transactionsSync` mock that serves pages keyed by the request cursor
 * ("" / undefined = the first page).
 */
export function pagedSync(pages: Record<string, SyncPage>) {
  return async (req: { cursor?: string }) => {
    const page = pages[req.cursor ?? ""];
    if (!page) throw new Error(`no fixture page for cursor ${req.cursor}`);
    return syncResponse(page);
  };
}
