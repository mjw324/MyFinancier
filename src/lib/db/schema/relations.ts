import { relations } from "drizzle-orm";
import { user, session, account, twoFactor } from "./auth";
import { plaidItems } from "./plaid";
import { financialAccounts } from "./accounts";
import { transactions } from "./transactions";
import { categories } from "./categories";
import { budgets } from "./budgets";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  plaidItems: many(plaidItems),
  financialAccounts: many(financialAccounts),
  transactions: many(transactions),
  categories: many(categories),
  budgets: many(budgets),
  twoFactors: many(twoFactor),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const plaidItemsRelations = relations(plaidItems, ({ one, many }) => ({
  user: one(user, {
    fields: [plaidItems.userId],
    references: [user.id],
  }),
  financialAccounts: many(financialAccounts),
}));

export const financialAccountsRelations = relations(
  financialAccounts,
  ({ one, many }) => ({
    user: one(user, {
      fields: [financialAccounts.userId],
      references: [user.id],
    }),
    plaidItem: one(plaidItems, {
      fields: [financialAccounts.plaidItemId],
      references: [plaidItems.id],
    }),
    transactions: many(transactions),
  }),
);

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(user, {
    fields: [transactions.userId],
    references: [user.id],
  }),
  financialAccount: one(financialAccounts, {
    fields: [transactions.accountId],
    references: [financialAccounts.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(user, {
    fields: [categories.userId],
    references: [user.id],
  }),
  budgets: many(budgets),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  user: one(user, {
    fields: [budgets.userId],
    references: [user.id],
  }),
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));
