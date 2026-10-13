/**
 * Safe error logging.
 *
 * Never pass a raw error object to console.*: a Plaid SDK error is an
 * AxiosError whose `config` carries the PLAID-CLIENT-ID / PLAID-SECRET headers
 * and the request body (access_token, public_token), and a DrizzleQueryError's
 * message carries the query parameters (encrypted tokens, balances).
 *
 * describeError() keeps an allow-list of fields that are useful for debugging
 * and safe to ship to log storage; logError() is the only sanctioned way to log
 * a caught error.
 */

export type SafeErrorInfo = {
  name: string;
  message: string;
  /** HTTP status of a failed outbound request (Plaid). */
  status?: number;
  plaidErrorType?: string;
  plaidErrorCode?: string;
  plaidRequestId?: string;
  /** SQLSTATE of a Postgres error (e.g. 57014 statement timeout). */
  pgCode?: string;
  pgTable?: string;
  pgConstraint?: string;
};

type LogContext = Record<string, string | number | boolean | null | undefined>;

// Plaid tokens look like access-production-<uuid>, public-sandbox-<uuid>,
// link-development-<uuid>. Redact defensively wherever free text is logged.
const PLAID_TOKEN_RE =
  /\b(access|public|link|processor)-(sandbox|development|production)-[A-Za-z0-9-]+/g;

export function redactSecrets(text: string): string {
  return text.replace(PLAID_TOKEN_RE, "$1-$2-<redacted>");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Plaid API error body (`error.response.data`), if this is a Plaid error. */
export function plaidErrorBody(error: unknown): {
  error_type?: string;
  error_code?: string;
  error_message?: string;
  request_id?: string;
} | null {
  const response = asRecord(asRecord(error)?.response);
  const data = asRecord(response?.data);
  if (!data || !str(data.error_code)) return null;
  return {
    error_type: str(data.error_type),
    error_code: str(data.error_code),
    error_message: str(data.error_message),
    request_id: str(data.request_id),
  };
}

/** Plaid `error_code` (e.g. ITEM_LOGIN_REQUIRED) or undefined. */
export function plaidErrorCode(error: unknown): string | undefined {
  return plaidErrorBody(error)?.error_code;
}

export function describeError(error: unknown): SafeErrorInfo {
  const record = asRecord(error);
  if (!record) {
    return { name: "NonError", message: redactSecrets(String(error)) };
  }

  const name = str(record.name) ?? "Error";
  let message = str(record.message) ?? "";

  // DrizzleQueryError: "Failed query: <sql>\nparams: <values>" — drop params.
  const paramsAt = message.indexOf("\nparams:");
  if (paramsAt !== -1) message = message.slice(0, paramsAt);

  const info: SafeErrorInfo = { name, message: redactSecrets(message) };

  // Axios / Plaid SDK: keep the status and Plaid's error envelope only.
  const response = asRecord(record.response);
  if (response && typeof response.status === "number") {
    info.status = response.status;
  }
  const plaid = plaidErrorBody(error);
  if (plaid) {
    info.plaidErrorType = plaid.error_type;
    info.plaidErrorCode = plaid.error_code;
    info.plaidRequestId = plaid.request_id;
    if (plaid.error_message) {
      info.message = `${info.message} — ${redactSecrets(plaid.error_message)}`;
    }
  }

  // Postgres (postgres-js) errors, either directly or as a Drizzle `cause`.
  const pg = str(record.code) && str(record.severity) ? record : asRecord(record.cause);
  if (pg && str(pg.code)) {
    info.pgCode = str(pg.code);
    info.pgTable = str(pg.table_name);
    info.pgConstraint = str(pg.constraint_name);
    const pgMessage = str(pg.message);
    if (pgMessage && pg !== record) {
      info.message = `${info.message} — ${redactSecrets(pgMessage)}`;
    }
  }

  return info;
}

/**
 * Log a caught error with structured, allow-listed fields. `context` must not
 * contain secrets (item row ids and Plaid item_ids are fine).
 */
export function logError(
  event: string,
  error: unknown,
  context: LogContext = {},
): void {
  console.error(
    `[error] ${event} ${JSON.stringify({ ...context, error: describeError(error) })}`,
  );
}
