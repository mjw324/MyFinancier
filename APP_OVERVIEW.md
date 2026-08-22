# MyFinancier — Application Overview

> Generated 2026-04-29. Use this doc to assess where new features slot in.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth | Better Auth (email/password + 2FA) |
| Database | Supabase PostgreSQL via Drizzle ORM |
| UI | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Bank Data | Plaid API (transaction sync, recurring detection) |
| Email | Custom transactional email templates |
| Hosting | Railway |

---

## Pages & Routes

### Authentication (`/auth/*`)

| Route | Purpose |
|---|---|
| `/signin` | Email/password login |
| `/signup` | New account registration (email verification required) |
| `/2fa` | OTP entry for two-factor authentication |
| `/verify-email` | Email verification status |

### Dashboard (`/`)

The main overview page. Components assembled by `DashboardContent`.

**Data shown:**
- Net worth (sum of account balances, liabilities subtracted)
- Income, Expenses, Savings Rate for a selected time range
- Trends vs the previous equivalent period
- Spending over time (daily line chart)
- Spending by category (pie/bar chart)
- Budget progress summary
- Recent transactions preview
- Safe to Spend widget
- Bill Calendar

**Time range selector:** Week / Month / Year / YTD

### Transactions (`/transactions`)

Full transaction list with search and filters.

- 25 per page, cursor-style pagination
- Columns: Date, Description, Category, Account, Amount
- Click row → edit nickname or category override
- Recurring badge on recurring transactions (clickable → stream detail sheet)
- Totals bar: count, total income, total expenses, net

**Filters:** free-text search, account, category, date range, recurring-only toggle

### Budgets (`/budgets`)

Budget management.

- Create budgets tied to a Plaid category
- Periods: Weekly / Monthly / Yearly
- Progress bars (spent vs budgeted), color changes when over budget
- Edit amount/dates or delete

### Accounts (`/accounts`)

Connected bank and credit accounts.

- Shows institution name, account type, subtype, current balance
- Reconnect button for expired Plaid connections
- Link new account via Plaid Link button

### Settings (`/settings`)

- Profile info (name, email)
- Two-factor authentication (enable/disable TOTP, regenerate backup codes)
- Plaid connections: sync, reconnect, unlink
- Reset all transaction customizations (restore Plaid-supplied names/categories)

### Plaid OAuth Callback (`/plaid/oauth`)

Handles Plaid Link redirect, exchanges public token, triggers initial sync.

---

## Feature Components

### Overview / Dashboard

| Component | What it renders |
|---|---|
| `StatCards` | Four cards: Net Worth, Income, Expenses, Savings Rate — each with delta vs prior period |
| `BudgetOverview` | Progress bars for all active budgets |
| `RecentTransactions` | Short list of latest transactions |
| `SpendingOverTime` | Daily spending line chart |
| `SpendingByCategory` | Category breakdown pie/bar chart |
| `SafeToSpend` | Current balance minus upcoming bills through a horizon date |
| `BillCalendar` | Month calendar of posted + projected recurring transactions |

### Accounts

| Component | What it renders |
|---|---|
| `AccountCard` | Balance, institution, type, sync status, reconnect alert |
| `PlaidLinkButton` | Opens Plaid Link; handles both new and reconnect flows |

### Budgets

| Component | What it renders |
|---|---|
| `BudgetCard` | Progress bar, spent/budgeted/remaining, period badge |
| `CreateBudgetDialog` | Form: category, amount, period, start date |
| `EditBudgetDialog` | Same fields, plus delete |

### Transactions

| Component | What it renders |
|---|---|
| `TransactionsTable` | Full sortable table with pagination |
| `TransactionFilters` | Search + account/category/date/recurring filters |
| `TransactionTotals` | Count, income, expenses, net for current filter set |
| `TransactionLabel` | Smart name display: customName › merchantName › raw name |
| `EditTransactionDialog` | Nickname and category override (applies to all in stream) |
| `Pagination` | Page controls, preserves filter params in URL |

### Recurring Streams

| Component | What it renders |
|---|---|
| `SafeToSpend` | Balance + predicted flows + safe amount; horizon: next paycheck / 30 days / end of month |
| `BillCalendar` | Month grid; posted (filled) vs projected (outlined); color-coded inflow/outflow; price-change badge |
| `RecurringBadge` | Inline badge on transaction rows, clickable |
| `StreamDetailSheet` | Side sheet: stream metadata, transaction history, frequency, avg vs last amount |

### Settings

| Component | What it renders |
|---|---|
| `TwoFactorCard` | Enable/disable TOTP, show backup codes, regenerate codes |
| `BackupCodesDisplay` | 10 backup codes with copy-all |
| `SyncAccountButton` | Trigger manual Plaid sync with loading/toast feedback |
| `UnlinkAccountDialog` | Confirm unlink with institution name and account count |
| `ResetCustomizationsDialog` | Confirm reset of all custom names and categories |

---

## API Routes

### Auth
- `POST/GET /api/auth/[...all]` — Better Auth handler (sign in/up/out, 2FA, email verification, password reset)

### Plaid
- `POST /api/plaid/create-link-token` — Create or update Plaid Link token
- `POST /api/plaid/exchange-token` — Exchange public token, store encrypted access token, trigger initial sync
- `POST /api/plaid/webhook` — Receive Plaid events (transaction updates, item errors, recurring stream updates)

### Recurring / Safe to Spend
- `GET /api/recurring-streams` — List streams (filter: flow_type, active_only, include_tombstoned)
- `GET /api/recurring-streams/[streamId]` — Single stream + transaction history
- `GET /api/safe-to-spend?through=YYYY-MM-DD` — Balance, projected flows, safe amount, upcoming bills
- `GET /api/bill-calendar?from=…&to=…` — Calendar events (posted + projected, max 90-day window)

---

## Database Schema

### Core Auth Tables (managed by Better Auth — do not modify)

| Table | Key Columns |
|---|---|
| `user` | id, name, email, emailVerified, twoFactorEnabled |
| `session` | id, userId, expiresAt, ipAddress, userAgent |
| `account` | id, userId, providerId, password |
| `verification` | id, identifier, value, expiresAt |
| `twoFactor` | id, userId, secret, backupCodes |

### Financial Tables

| Table | Key Columns | Notes |
|---|---|---|
| `plaidItems` | id, userId, accessToken (encrypted), itemId, cursor, institutionName, status | status: active / login_required / pending_expiration |
| `financialAccounts` | id, userId, plaidItemId, plaidAccountId, name, type, subtype, currentBalance, availableBalance | |
| `transactions` | id, userId, accountId, plaidTransactionId, amount, date, name, merchantName, category, customName, customCategory, pending, recurringStreamId | Positive = expense, negative = income (Plaid convention) |
| `recurringStreams` | streamId (Plaid's), userId, plaidItemId, accountId, flowType, description, frequency, status, isActive, averageAmount, lastAmount, predictedNextDate, customName, customCategory | frequency: WEEKLY / BIWEEKLY / MONTHLY / QUARTERLY / YEARLY |
| `budgets` | id, userId, categoryId, amount, period, startDate, endDate | period: weekly / monthly / yearly |
| `categories` | id, userId, name, icon, color, isDefault | |

---

## Data Flow Summary

```
User links account
  → Plaid Link (client) → /api/plaid/exchange-token (server)
    → Store plaidItems row (encrypted access token)
    → syncTransactions() → store financialAccounts + transactions
    → fetchRecurringStreams() → store recurringStreams

Ongoing sync
  → Plaid webhook → /api/plaid/webhook
    → SYNC_UPDATES_AVAILABLE → syncTransactions() + backfill recurring stream refs
    → RECURRING_TRANSACTIONS_UPDATE → fetchRecurringStreams()
    → ITEM/ERROR → mark plaidItem status = login_required

Safe to Spend / Bill Calendar
  → Read recurringStreams → projection.ts algorithm
    → Walks each stream forward using frequency + lastDate
    → Returns predicted occurrences in requested window
    → Overlays against posted transactions in same window
```

---

## Key Utilities

| File | Exports |
|---|---|
| `lib/utils/format.ts` | `formatCurrency`, `formatCompactCurrency`, `displayName`, `formatDate`, `formatRelativeDate`, `formatCategory`, `getCategoryColor` |
| `lib/utils/date-ranges.ts` | `getDateRange(range, now)`, `getPreviousDateRange(range, now)` — range: `"week" \| "month" \| "year" \| "ytd"` |
| `lib/utils/calculations.ts` | `calculateNetWorth`, `calculateBudgetPercentage` |
| `lib/utils/aggregations.ts` | `aggregateIncomeAndExpenses`, `calculateSavingsRate` |
| `lib/utils/budget-periods.ts` | `getPeriodStart`, `getPeriodEnd` |
| `lib/utils/account-type.ts` | `isLiabilityType`, `signedBalance`, `LIABILITY_TYPES` |
| `lib/plaid/projection.ts` | Predicts future recurring stream occurrences from frequency + recent dates |
| `hooks/use-mobile.ts` | `useIsMobile()` — breakpoint at 768px |

---

## Plaid Data Conventions

- **Transaction amounts:** positive = expense, negative = income (Plaid convention). All display logic inverts signs accordingly.
- **Recurring stream `flowType`:** `"inflow"` (income/deposits) or `"outflow"` (bills/subscriptions).
- **Access tokens** are encrypted at rest using AES-256-GCM before storing in `plaidItems.accessToken`.
- **Sync strategy:** cursor-based incremental sync. Cursor stored per `plaidItem`, updated after each sync batch.
- **Deduplication:** `plaidTransactionId` has a unique constraint; upserts are safe.

---

## Patterns & Conventions

- **Server Components by default.** `"use client"` only for interactive pieces.
- **Server Actions** for all mutations on dashboard pages. API routes only for external-facing endpoints (Plaid webhooks, Plaid Link exchange).
- **API response shape:** `{ success: true; data: T }` or `{ success: false; error: string }`.
- **No raw Plaid types in frontend.** `lib/plaid/` transforms all Plaid SDK responses before they reach components.
- **Error handling:** Plaid errors are mapped to user-friendly messages; raw error objects and access tokens are never logged or exposed to the client.
- Zod validates all API route inputs.

---

## Feature Gap / New Feature Assessment Guide

When evaluating a new feature, ask:

1. **Does it need new Plaid data?** → Add to `lib/plaid/sync.ts` or a new Plaid endpoint call; store in an existing or new schema table.
2. **Does it need a new data model?** → Add a file under `lib/db/schema/`, add queries to `lib/db/queries/`, wire into `schema/index.ts`.
3. **Is it a new dashboard widget?** → Add to `components/features/overview/`, compose into `dashboard-content.tsx`.
4. **Is it a new full page?** → Add route under `app/(routes)/(dashboard)/`, add nav item to `dashboard-sidebar.tsx`.
5. **Is it mutation-only?** → Use a Server Action; no new API route needed.
6. **Does an external service need to call it?** → Add an API route under `app/api/`.
7. **Does it involve recurring/prediction logic?** → Extend `lib/plaid/projection.ts` or the `recurringStreams` schema.
8. **Does it involve budgets?** → Extend `lib/db/queries/budgets.ts` and `budgets` schema table.
