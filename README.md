# MyFinancier

A personal finance and budgeting web application. MyFinancier securely links to
users' bank accounts through [Plaid](https://plaid.com), automatically syncs
transactions, and turns raw bank data into budgets, spending insights, recurring
bill tracking, and a forward-looking "safe to spend" projection.

## Features

- **Bank linking via Plaid** — Connect institutions through Plaid Link, with
  OAuth redirect support. Access tokens are encrypted at rest.
- **Automatic transaction sync** — Cursor-based [Transactions Sync](https://plaid.com/docs/api/products/transactions/#transactionssync)
  keeps accounts and transactions current. Sync is driven by Plaid webhooks and
  can also be triggered manually.
- **Accounts & balances** — Live current/available balances across all linked
  accounts, with settled vs. projected net worth.
- **Transactions** — Search, filter (by account, category, date range, recurring
  status, spending type), paginate, rename, recategorize, and export to Excel.
- **Budgets** — Create per-category budgets across multiple periods and track
  progress against actual spending.
- **Recurring streams** — Plaid-detected recurring inflows/outflows, surfaced as
  a bill calendar with predicted next dates, price-change detection, and
  frequency-aware projection (weekly, biweekly, semi-monthly, monthly, annual).
- **Safe to Spend** — Projects balances forward to the next paycheck (or a chosen
  horizon) by netting predicted inflows against upcoming bills.
- **Spending classification** — Tags expenses as *necessary* vs. *discretionary*
  using a precedence cascade (stream → merchant rule → name-signature rule), with
  per-transaction manual overrides. Powers a necessary-vs-discretionary breakdown.
- **Transfer & refund detection** — Automatically flags internal transfers and
  refunds so they don't distort spending totals.
- **Authentication** — Email/password with required email verification, usernames,
  and optional two-factor auth (TOTP authenticator apps + email OTP, with backup
  codes), all via Better Auth.
- **Transactional email** — Verification and OTP emails sent through Amazon SES.

## Tech Stack

| Area | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router) + React 19, TypeScript |
| Auth | [Better Auth](https://www.better-auth.com) (username + two-factor plugins) |
| Database | Supabase PostgreSQL via [Drizzle ORM](https://orm.drizzle.team) |
| UI | Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) (Radix primitives) |
| Charts | [Recharts](https://recharts.org) |
| Bank integration | [Plaid](https://plaid.com) (`plaid` + `react-plaid-link`) |
| Email | Amazon SES (`@aws-sdk/client-ses`) |
| Exports | [ExcelJS](https://github.com/exceljs/exceljs) |
| Validation | [Zod](https://zod.dev) |
| Testing | [Vitest](https://vitest.dev) + Testing Library + PGlite |
| Package manager | [pnpm](https://pnpm.io) |
| Hosting | Railway (standalone Docker image) |

## Architecture

All application code lives under `src/`.

```
src/
├── app/
│   ├── (routes)/
│   │   ├── (auth)/          # signin, signup, 2fa, verify-email
│   │   ├── (dashboard)/     # overview, accounts, transactions, budgets, settings
│   │   └── (marketing)/     # public landing page
│   ├── api/
│   │   ├── auth/            # Better Auth handler
│   │   ├── plaid/           # create-link-token, exchange-token, webhook
│   │   ├── recurring-streams/
│   │   ├── safe-to-spend/
│   │   ├── bill-calendar/
│   │   └── transactions/export/
│   └── plaid/oauth/         # Plaid OAuth redirect landing
├── components/
│   ├── ui/                  # shadcn/ui primitives
│   ├── layout/             # dashboard shell, sidebar, header
│   ├── charts/             # Recharts wrappers
│   └── features/           # domain components (accounts, transactions, budgets, recurring, ...)
├── lib/
│   ├── db/
│   │   ├── schema/         # Drizzle schema, one file per domain
│   │   ├── queries/        # reusable, domain-scoped query functions
│   │   ├── migrations/     # drizzle-kit migrations
│   │   └── index.ts        # lazy Drizzle client (proxied, test-swappable)
│   ├── plaid/             # client, sync, link, recurring, projection, transfers, refunds
│   ├── spending/          # necessary/discretionary classification engine
│   ├── auth/              # Better Auth server/client config
│   ├── email/             # SES client + templates
│   ├── transactions/      # Excel export builder
│   └── utils/            # encryption, formatting, dates, aggregations, balances
├── hooks/
├── proxy.ts               # auth middleware (Next.js 16 `proxy`)
└── routes.ts              # route classification (public / auth / api)
```

### Conventions

- **Server Components by default**; `"use client"` only where interactivity is
  needed.
- **Server Actions** handle dashboard mutations. **API routes** are reserved for
  Plaid webhooks, Plaid token exchange, exports, and other endpoints called by
  external clients.
- **No raw Plaid types reach the frontend** — `lib/plaid/` transforms Plaid SDK
  responses into app-level types first.
- All API routes and server actions validate input with **Zod** and return a
  consistent shape: `{ success: true, data } | { success: false, error }`.

### Data model

Better Auth owns `user`, `session`, `account`, and `verification`. Every
financial table references `user.id` and has **Row-Level Security enabled**:

- `plaid_items` — one row per linked institution; stores the **encrypted** Plaid
  access token plus the sync cursor and item status.
- `financial_accounts` — bank accounts within an item, with cached balances.
- `transactions` — synced transactions, deduplicated by Plaid `transaction_id`;
  carries spending-type, transfer, and refund flags plus normalized merchant /
  name signatures for rule matching.
- `recurring_streams` — Plaid-detected recurring inflows/outflows with frequency
  and next-date predictions.
- `budgets`, `categories` — per-category budgeting.
- `spending_rules` — merchant / name-signature rules driving auto-classification.
- `user_preferences` — per-user display settings.

### Security notes

- **Access tokens are encrypted with AES-256-GCM** (`lib/utils/encryption.ts`)
  using the `ENCRYPTION_KEY` env var. Plaintext tokens are never stored or logged.
- The **Plaid webhook is cryptographically verified** — the `Plaid-Verification`
  JWT is checked (ES256, key fetched from Plaid, `iat` freshness window) and the
  request body hash is compared with a constant-time comparison before any work
  is done.
- All financial tables call `.enableRLS()`.
- `proxy.ts` gates routes: unauthenticated users are redirected to `/signin`;
  authenticated users are redirected away from auth pages; the Plaid webhook and
  Better Auth endpoints are exempt.

### Plaid flow

1. Server creates a Link token → client opens Plaid Link.
2. Client returns a `public_token` → server exchanges it for an `access_token`.
3. Server stores the encrypted token in `plaid_items` and triggers an initial sync.
4. Plaid webhooks (`SYNC_UPDATES_AVAILABLE`, `RECURRING_TRANSACTIONS_UPDATE`,
   item errors, pending expiration) drive incremental background syncs and
   recurring-stream backfills.

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 11+ (`corepack enable`)
- A Supabase (or other PostgreSQL) database
- A [Plaid dashboard](https://dashboard.plaid.com) account (sandbox is fine for dev)
- An Amazon SES setup for transactional email (optional for local dev)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy the example file and fill in your values:

```bash
cp env.example .env
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled Supabase connection (runtime) |
| `DIRECT_URL` | Direct connection (used by drizzle-kit for migrations) |
| `BETTER_AUTH_SECRET` | Auth secret — `openssl rand -hex 32` |
| `BETTER_AUTH_URL` / `NEXT_PUBLIC_BASE_URL` | App URL |
| `PLAID_CLIENT_ID` | Plaid client ID |
| `PLAID_SANDBOX_SECRET` / `PLAID_PRODUCTION_SECRET` | Plaid secrets |
| `PLAID_ENV` | `sandbox` or `production` |
| `PLAID_WEBHOOK_URL` | Public webhook URL (use ngrok locally) |
| `PLAID_REDIRECT_URI` | OAuth redirect URI registered in Plaid |
| `ENCRYPTION_KEY` | 32-byte hex key for token encryption — `openssl rand -hex 32` |
| `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | SES credentials |
| `SES_FROM_EMAIL`, `SES_FROM_NAME` | Sender identity |

### 3. Set up the database

```bash
pnpm db:generate   # generate migrations from schema
pnpm db:migrate    # apply schema to the database (drizzle-kit push)
```

### 4. Run the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> For Plaid webhooks during local development, expose your server with a tunnel
> (e.g. ngrok) and point `PLAID_WEBHOOK_URL` at the public `/api/plaid/webhook`.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start the dev server (Turbopack) |
| `pnpm build` | Production build (Turbopack, standalone output) |
| `pnpm start` | Start the production server |
| `pnpm lint` | Run ESLint |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Push schema to the database |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm test` | Run the Vitest watcher |
| `pnpm test:run` | Run all tests once |
| `pnpm test:coverage` | Run tests with coverage |

## Testing

Tests are split into two Vitest projects:

- **Unit** (`tests/unit/`) — pure logic: encryption, formatting, date ranges,
  aggregations, balances, budget periods, projection, spending matching.
- **Integration** (`tests/integration/`) — query and engine behavior against an
  in-memory PostgreSQL ([PGlite](https://github.com/electric-sql/pglite)) seeded
  via test factories, covering budget progress, overview, spending
  classification, and transaction search.

```bash
pnpm test:run
```

## Deployment

The app is built for Railway using a multi-stage `Dockerfile` and Next.js
`output: "standalone"`:

1. Set every environment variable above in the Railway dashboard.
2. Railway builds the Docker image and runs `node server.js`.
3. Register the Railway domain's `/api/plaid/webhook` as the Plaid webhook URL.

```bash
docker build -t myfinancier .
docker run -p 3000:3000 --env-file .env myfinancier
```
