/**
 * Tiny seed-row builders. No randomness, no Faker — predictable defaults that
 * tests can override per-case. Keys match the Drizzle schema column names.
 */

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${++counter}`;

export function makeUser(over: Partial<UserRow> = {}): UserRow {
  const id = over.id ?? nextId("u");
  return {
    id,
    name: "Test User",
    username: null,
    displayUsername: null,
    email: `${id}@test.local`,
    emailVerified: true,
    image: null,
    role: "member",
    gender: false,
    twoFactorEnabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

export function makePlaidItem(over: Partial<PlaidItemRow> = {}): PlaidItemRow {
  const id = over.id ?? nextId("pi");
  return {
    id,
    userId: over.userId ?? "u_1",
    itemId: `item_${id}`,
    accessToken: "encrypted_token",
    institutionId: "ins_1",
    institutionName: "Test Bank",
    cursor: null,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

export function makeAccount(over: Partial<AccountRow> = {}): AccountRow {
  const id = over.id ?? nextId("a");
  return {
    id,
    userId: over.userId ?? "u_1",
    plaidItemId: over.plaidItemId ?? "pi_1",
    plaidAccountId: `pa_${id}`,
    name: "Test Account",
    officialName: null,
    type: "depository",
    subtype: "checking",
    currentBalance: "100.00",
    availableBalance: "100.00",
    isoCurrencyCode: "USD",
    lastSyncedAt: new Date("2026-04-01T00:00:00Z"),
    ...over,
  };
}

export function makeTxn(over: Partial<TxnRow> = {}): TxnRow {
  const id = over.id ?? nextId("t");
  return {
    id,
    userId: over.userId ?? "u_1",
    accountId: over.accountId ?? "a_1",
    plaidTransactionId: `pt_${id}`,
    amount: "10.00",
    date: new Date("2026-04-15T00:00:00Z"),
    name: "Test Txn",
    merchantName: null,
    category: null,
    categoryId: null,
    pending: false,
    createdAt: new Date("2026-04-15T00:00:00Z"),
    ...over,
  };
}

// Row shapes (intentionally narrow — only fields used by tests).
type UserRow = {
  id: string;
  name: string;
  username: string | null;
  displayUsername: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  gender: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PlaidItemRow = {
  id: string;
  userId: string;
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  cursor: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type AccountRow = {
  id: string;
  userId: string;
  plaidItemId: string;
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  currentBalance: string | null;
  availableBalance: string | null;
  isoCurrencyCode: string | null;
  lastSyncedAt: Date | null;
};

type TxnRow = {
  id: string;
  userId: string;
  accountId: string;
  plaidTransactionId: string | null;
  amount: string;
  date: Date;
  name: string;
  merchantName: string | null;
  category: string | null;
  categoryId: string | null;
  pending: boolean;
  createdAt: Date;
};
