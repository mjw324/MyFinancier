import { CountryCode, Products } from "plaid";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { encrypt, decrypt } from "@/lib/utils/encryption";
import { plaidClient } from "./client";
import type {
  LinkTokenResponse,
  PlaidLinkMetadata,
  ExchangeTokenResponse,
} from "./types";

export async function createLinkToken(
  userId: string,
): Promise<LinkTokenResponse> {
  const response = await plaidClient.linkTokenCreate({
    client_name: "MyFinancier",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: userId },
    products: [Products.Transactions],
    transactions: { days_requested: 730 },
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
  });

  return {
    linkToken: response.data.link_token,
    expiration: response.data.expiration,
  };
}

export async function exchangePublicToken(
  publicToken: string,
  userId: string,
  metadata: PlaidLinkMetadata,
): Promise<ExchangeTokenResponse> {
  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId = exchangeResponse.data.item_id;

  const encryptedToken = encrypt(accessToken);

  const [plaidItem] = await db
    .insert(plaidItems)
    .values({
      userId,
      accessToken: encryptedToken,
      itemId,
      institutionId: metadata.institution.institutionId,
      institutionName: metadata.institution.name,
      status: "active",
    })
    .onConflictDoUpdate({
      target: plaidItems.itemId,
      set: {
        accessToken: encryptedToken,
        institutionId: metadata.institution.institutionId,
        institutionName: metadata.institution.name,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning();

  if (metadata.accounts.length > 0) {
    await db
      .insert(financialAccounts)
      .values(
        metadata.accounts.map((acct) => ({
          userId,
          plaidItemId: plaidItem.id,
          plaidAccountId: acct.id,
          name: acct.name,
          type: acct.type,
          subtype: acct.subtype,
        })),
      )
      .onConflictDoUpdate({
        target: financialAccounts.plaidAccountId,
        set: {
          name: sql`excluded.name`,
          type: sql`excluded.type`,
          subtype: sql`excluded.subtype`,
          plaidItemId: sql`excluded.plaid_item_id`,
          userId: sql`excluded.user_id`,
        },
      });
  }

  return {
    itemId,
    accounts: metadata.accounts.length,
  };
}

export async function createUpdateLinkToken(
  userId: string,
  plaidItemId: string,
): Promise<LinkTokenResponse> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, plaidItemId),
  });

  if (!item || item.userId !== userId) {
    throw new Error("Plaid item not found");
  }

  const decryptedToken = decrypt(item.accessToken);

  const response = await plaidClient.linkTokenCreate({
    client_name: "MyFinancier",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: userId },
    access_token: decryptedToken,
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
  });

  return {
    linkToken: response.data.link_token,
    expiration: response.data.expiration,
  };
}
