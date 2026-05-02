import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { spendingRules } from "@/lib/db/schema/spending-rules";
import {
  applySpendingClassifications,
  classifyTransaction,
  clearStreamClassification,
  clearTransactionClassification,
  deleteSpendingRule,
} from "@/lib/spending/classify";
import {
  makeAccount,
  makePlaidItem,
  makeTxn,
  makeUser,
} from "../setup/factories";

const USER = "u_classify";

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(user).values([makeUser({ id: USER, email: "c@test.local" })]);
  await db
    .insert(plaidItems)
    .values([makePlaidItem({ id: "pi_c", userId: USER, itemId: "item_c" })]);
  await db.insert(financialAccounts).values([
    makeAccount({
      id: "acct_c",
      userId: USER,
      plaidItemId: "pi_c",
      plaidAccountId: "pa_c",
    }),
  ]);
});

async function getTxn(id: string) {
  const db = getTestDb();
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  return row;
}

describe("classifyTransaction — scope: 'transaction'", () => {
  it("sets manual classification when no stream/rule existed", async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      makeTxn({
        id: "t1",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "starbucks",
        nameSignature: "starbucks",
      }),
    ]);
    await classifyTransaction(USER, "t1", "discretionary", "transaction");
    const row = await getTxn("t1");
    expect(row.spendingType).toBe("discretionary");
    expect(row.spendingTypeSource).toBe("manual");
  });

  it("rejects classifying an income transaction", async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      makeTxn({
        id: "t_income",
        userId: USER,
        accountId: "acct_c",
        amount: "-1000.00",
      }),
    ]);
    await expect(
      classifyTransaction(USER, "t_income", "necessary", "transaction"),
    ).rejects.toThrow(/Income transactions cannot/);
  });
});

describe("classifyTransaction — scope: 'merchant'", () => {
  it("creates a rule and classifies all matching transactions", async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      makeTxn({
        id: "tA",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "wholefds",
        nameSignature: "wholefds",
      }),
      makeTxn({
        id: "tB",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "wholefds",
        nameSignature: "wholefds",
      }),
      makeTxn({
        id: "tC",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "other",
        nameSignature: "other",
      }),
    ]);
    await classifyTransaction(USER, "tA", "necessary", "merchant");
    expect((await getTxn("tA")).spendingType).toBe("necessary");
    expect((await getTxn("tA")).spendingTypeSource).toBe("rule");
    expect((await getTxn("tB")).spendingType).toBe("necessary");
    expect((await getTxn("tB")).spendingTypeSource).toBe("rule");
    expect((await getTxn("tC")).spendingType).toBeNull();

    const [rule] = await db
      .select()
      .from(spendingRules)
      .where(eq(spendingRules.userId, USER));
    expect(rule.matchType).toBe("merchant");
    expect(rule.matchValue).toBe("wholefds");
    expect(rule.spendingType).toBe("necessary");
  });
});

describe("classifyTransaction — scope: 'stream'", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(recurringStreams).values({
      streamId: "s1",
      userId: USER,
      plaidItemId: "pi_c",
      accountId: "acct_c",
      flowType: "outflow",
      description: "Comcast",
      frequency: "MONTHLY",
      status: "MATURE",
      isActive: true,
      averageAmount: "100",
      lastAmount: "100",
    });
    await db.insert(transactions).values([
      makeTxn({
        id: "tS1",
        userId: USER,
        accountId: "acct_c",
        recurringStreamId: "s1",
      }),
      makeTxn({
        id: "tS2",
        userId: USER,
        accountId: "acct_c",
        recurringStreamId: "s1",
      }),
    ]);
  });

  it("sets stream + cascades to all stream transactions", async () => {
    await classifyTransaction(USER, "tS1", "necessary", "stream");
    const db = getTestDb();
    const [stream] = await db
      .select()
      .from(recurringStreams)
      .where(eq(recurringStreams.streamId, "s1"));
    expect(stream.spendingType).toBe("necessary");
    expect((await getTxn("tS1")).spendingType).toBe("necessary");
    expect((await getTxn("tS1")).spendingTypeSource).toBe("stream");
    expect((await getTxn("tS2")).spendingType).toBe("necessary");
    expect((await getTxn("tS2")).spendingTypeSource).toBe("stream");
  });

  it("an override on one stream transaction does not change the stream or other rows", async () => {
    await classifyTransaction(USER, "tS1", "necessary", "stream");
    await classifyTransaction(USER, "tS2", "discretionary", "transaction");
    const db = getTestDb();
    const [stream] = await db
      .select()
      .from(recurringStreams)
      .where(eq(recurringStreams.streamId, "s1"));
    expect(stream.spendingType).toBe("necessary");
    expect((await getTxn("tS1")).spendingType).toBe("necessary");
    expect((await getTxn("tS1")).spendingTypeSource).toBe("stream");
    expect((await getTxn("tS2")).spendingType).toBe("discretionary");
    expect((await getTxn("tS2")).spendingTypeSource).toBe("override");
  });

  it("clearing an override falls back to stream classification", async () => {
    await classifyTransaction(USER, "tS1", "necessary", "stream");
    await classifyTransaction(USER, "tS2", "discretionary", "transaction");
    await clearTransactionClassification(USER, "tS2");
    expect((await getTxn("tS2")).spendingType).toBe("necessary");
    expect((await getTxn("tS2")).spendingTypeSource).toBe("stream");
  });

  it("scope='stream' does not overwrite override rows in the same stream", async () => {
    await classifyTransaction(USER, "tS2", "discretionary", "stream");
    // Now turn it back into necessary at stream scope
    await classifyTransaction(USER, "tS1", "necessary", "stream");
    // tS2 should now be necessary (was source='stream', not override)
    expect((await getTxn("tS2")).spendingType).toBe("necessary");

    // Override tS2, then re-classify stream
    await classifyTransaction(USER, "tS2", "discretionary", "transaction");
    await classifyTransaction(USER, "tS1", "necessary", "stream");
    expect((await getTxn("tS2")).spendingType).toBe("discretionary");
    expect((await getTxn("tS2")).spendingTypeSource).toBe("override");
  });
});

describe("applySpendingClassifications", () => {
  it("never reclassifies override or manual rows", async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      makeTxn({
        id: "tM",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "wholefds",
      }),
    ]);
    await classifyTransaction(USER, "tM", "discretionary", "transaction"); // manual
    await db.insert(spendingRules).values({
      userId: USER,
      matchType: "merchant",
      matchValue: "wholefds",
      spendingType: "necessary",
    });
    await applySpendingClassifications(USER);
    expect((await getTxn("tM")).spendingType).toBe("discretionary");
    expect((await getTxn("tM")).spendingTypeSource).toBe("manual");
  });

  it("applies stream first, then merchant rule, then signature rule", async () => {
    const db = getTestDb();
    await db.insert(recurringStreams).values({
      streamId: "s_cascade",
      userId: USER,
      plaidItemId: "pi_c",
      accountId: "acct_c",
      flowType: "outflow",
      description: "Comcast",
      frequency: "MONTHLY",
      status: "MATURE",
      isActive: true,
      averageAmount: "100",
      lastAmount: "100",
      spendingType: "necessary",
    });
    await db.insert(spendingRules).values([
      {
        userId: USER,
        matchType: "merchant",
        matchValue: "amzn",
        spendingType: "discretionary",
      },
      {
        userId: USER,
        matchType: "name_signature",
        matchValue: "amzn mktp us",
        spendingType: "discretionary",
      },
    ]);
    await db.insert(transactions).values([
      makeTxn({
        id: "tStream",
        userId: USER,
        accountId: "acct_c",
        recurringStreamId: "s_cascade",
        normalizedMerchant: "amzn",
      }),
      makeTxn({
        id: "tMerchant",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "amzn",
        nameSignature: "amzn mktp us",
      }),
      makeTxn({
        id: "tSig",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: null,
        nameSignature: "amzn mktp us",
      }),
      makeTxn({
        id: "tNone",
        userId: USER,
        accountId: "acct_c",
      }),
    ]);
    await applySpendingClassifications(USER);
    expect((await getTxn("tStream")).spendingType).toBe("necessary");
    expect((await getTxn("tStream")).spendingTypeSource).toBe("stream");
    expect((await getTxn("tMerchant")).spendingType).toBe("discretionary");
    expect((await getTxn("tMerchant")).spendingTypeSource).toBe("rule");
    expect((await getTxn("tSig")).spendingType).toBe("discretionary");
    expect((await getTxn("tSig")).spendingTypeSource).toBe("rule");
    expect((await getTxn("tNone")).spendingType).toBeNull();
  });
});

describe("deleteSpendingRule", () => {
  it("re-derives from stream when present, else nulls", async () => {
    const db = getTestDb();
    await db.insert(recurringStreams).values({
      streamId: "s2",
      userId: USER,
      plaidItemId: "pi_c",
      accountId: "acct_c",
      flowType: "outflow",
      description: "X",
      frequency: "MONTHLY",
      status: "MATURE",
      isActive: true,
      averageAmount: "10",
      lastAmount: "10",
      spendingType: "necessary",
    });
    await db.insert(transactions).values([
      makeTxn({
        id: "tRuleOnly",
        userId: USER,
        accountId: "acct_c",
        normalizedMerchant: "spotify",
      }),
      makeTxn({
        id: "tRuleAndStream",
        userId: USER,
        accountId: "acct_c",
        recurringStreamId: "s2",
        normalizedMerchant: "spotify",
        // Pretend a rule had set this row before the stream existed.
        spendingType: "discretionary",
        spendingTypeSource: "rule",
      }),
    ]);
    const [rule] = await db
      .insert(spendingRules)
      .values({
        userId: USER,
        matchType: "merchant",
        matchValue: "spotify",
        spendingType: "discretionary",
      })
      .returning();
    // Apply rule to tRuleOnly so it's source='rule'
    await applySpendingClassifications(USER, ["tRuleOnly"]);
    expect((await getTxn("tRuleOnly")).spendingTypeSource).toBe("rule");

    await deleteSpendingRule(USER, rule.id);
    // tRuleOnly: no stream → null
    expect((await getTxn("tRuleOnly")).spendingType).toBeNull();
    expect((await getTxn("tRuleOnly")).spendingTypeSource).toBeNull();
    // tRuleAndStream: stream wins
    expect((await getTxn("tRuleAndStream")).spendingType).toBe("necessary");
    expect((await getTxn("tRuleAndStream")).spendingTypeSource).toBe("stream");
  });
});

describe("clearStreamClassification", () => {
  it("clears stream-source rows but leaves overrides intact", async () => {
    const db = getTestDb();
    await db.insert(recurringStreams).values({
      streamId: "s3",
      userId: USER,
      plaidItemId: "pi_c",
      accountId: "acct_c",
      flowType: "outflow",
      description: "Y",
      frequency: "MONTHLY",
      status: "MATURE",
      isActive: true,
      averageAmount: "10",
      lastAmount: "10",
    });
    await db.insert(transactions).values([
      makeTxn({
        id: "tS_a",
        userId: USER,
        accountId: "acct_c",
        recurringStreamId: "s3",
      }),
      makeTxn({
        id: "tS_b",
        userId: USER,
        accountId: "acct_c",
        recurringStreamId: "s3",
      }),
    ]);
    await classifyTransaction(USER, "tS_a", "necessary", "stream");
    await classifyTransaction(USER, "tS_b", "discretionary", "transaction");
    await clearStreamClassification(USER, "s3");
    expect((await getTxn("tS_a")).spendingType).toBeNull();
    expect((await getTxn("tS_a")).spendingTypeSource).toBeNull();
    expect((await getTxn("tS_b")).spendingType).toBe("discretionary");
    expect((await getTxn("tS_b")).spendingTypeSource).toBe("override");
  });
});
