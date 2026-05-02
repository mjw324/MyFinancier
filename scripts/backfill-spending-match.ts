// One-shot backfill: recompute normalizedMerchant and nameSignature for every
// existing transaction. Idempotent. Run once after deploying the spending
// classification migration:
//   pnpm tsx scripts/backfill-spending-match.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import {
  computeNameSignature,
  normalizeMerchant,
} from "@/lib/utils/spending-match";

async function main() {
  const BATCH = 1000;
  let offset = 0;
  let totalUpdated = 0;

  for (;;) {
    const rows = await db
      .select({
        id: transactions.id,
        name: transactions.name,
        merchantName: transactions.merchantName,
      })
      .from(transactions)
      .limit(BATCH)
      .offset(offset);

    if (rows.length === 0) break;

    for (const row of rows) {
      const source = row.merchantName ?? row.name ?? null;
      const normalizedMerchant = normalizeMerchant(source);
      const nameSignature = computeNameSignature(source);
      await db
        .update(transactions)
        .set({ normalizedMerchant, nameSignature })
        .where(eq(transactions.id, row.id));
      totalUpdated++;
    }

    offset += rows.length;
    console.log(`Processed ${totalUpdated} transactions...`);

    if (rows.length < BATCH) break;
  }

  console.log(`Done. Updated ${totalUpdated} transactions.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
