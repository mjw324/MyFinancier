import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

function getPlaidSecret(): string {
  const env = process.env.PLAID_ENV;
  if (env === "sandbox") {
    const secret = process.env.PLAID_SANDBOX_SECRET;
    if (!secret) throw new Error("PLAID_SANDBOX_SECRET is not set");
    return secret;
  }
  if (env === "production") {
    const secret = process.env.PLAID_PRODUCTION_SECRET;
    if (!secret) throw new Error("PLAID_PRODUCTION_SECRET is not set");
    return secret;
  }
  throw new Error(
    `Invalid PLAID_ENV: "${env}". Must be "sandbox" or "production".`,
  );
}

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": getPlaidSecret(),
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
