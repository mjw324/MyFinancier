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

let cachedClient: PlaidApi | undefined;

function getClient(): PlaidApi {
  if (cachedClient) return cachedClient;
  const configuration = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": getPlaidSecret(),
      },
    },
  });
  cachedClient = new PlaidApi(configuration);
  return cachedClient;
}

export const plaidClient = new Proxy({} as PlaidApi, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
