# BudgetApp — Personal Finance Application

## Project Overview
A personal finance / budgeting web application that connects to users' bank accounts
via Plaid, syncs transactions, and provides budgeting tools and spending visualizations.

## Tech Stack
- **Framework**: Next.js 16 (App Router) with TypeScript
- **Auth**: Better Auth with Drizzle adapter (already configured from starter template)
- **Database**: Supabase PostgreSQL via Drizzle ORM
- **UI**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts
- **Bank Integration**: Plaid API (plaid-node SDK)
- **Hosting**: Railway

## Architecture Principles

### Folder Structure Convention
All application code lives under `src/`. Follow this layout:

```
src/
├── app/                    # Next.js App Router (pages + API routes)
│   ├── (auth)/             # Route group: login, register, forgot-password
│   ├── (dashboard)/        # Route group: authenticated app pages
│   │   ├── layout.tsx      # Dashboard shell (sidebar, nav)
│   │   ├── page.tsx        # Dashboard home / overview
│   │   ├── accounts/       # Bank accounts list + detail
│   │   ├── transactions/   # Transaction list, search, filter
│   │   ├── budgets/        # Budget creation and tracking
│   │   └── settings/       # User settings, linked accounts management
│   └── api/
│       ├── auth/           # Better Auth API route (already exists)
│       ├── plaid/          # Plaid Link token, exchange, webhooks
│       └── trpc/           # (optional) if using tRPC later
├── components/
│   ├── ui/                 # shadcn/ui components (already exists)
│   ├── layout/             # Shell, sidebar, nav, header
│   ├── charts/             # Recharts wrapper components
│   └── features/           # Domain-specific components
│       ├── accounts/
│       ├── transactions/
│       └── budgets/
├── lib/
│   ├── db/
│   │   ├── schema/         # Drizzle schema files, one per domain
│   │   │   ├── auth.ts     # Better Auth tables (already exists)
│   │   │   ├── plaid.ts    # plaid_items, plaid_accounts
│   │   │   ├── transactions.ts
│   │   │   ├── budgets.ts
│   │   │   └── index.ts    # Re-exports all schemas
│   │   ├── queries/        # Reusable query functions by domain
│   │   ├── migrations/     # Drizzle migration files
│   │   └── index.ts        # Drizzle client instance
│   ├── plaid/
│   │   ├── client.ts       # Plaid client initialization
│   │   ├── sync.ts         # Transaction sync logic (cursor-based)
│   │   ├── link.ts         # Link token creation helpers
│   │   └── types.ts        # App-level Plaid types (NOT raw Plaid SDK types)
│   ├── auth/               # Better Auth config (already exists, may need extending)
│   └── utils/              # Shared utilities (formatting, date helpers, encryption)
├── hooks/                  # React hooks (useAccounts, useBudget, etc.)
├── types/                  # Shared TypeScript types/interfaces
│   ├── api.ts              # API response shapes
│   ├── transactions.ts
│   └── budgets.ts
└── middleware.ts            # Auth middleware (already exists from template)
```

### Key Conventions

@AGENTS.md

- **Server Components by default.** Only add "use client" when interactivity is needed.
- **Server Actions for mutations** in dashboard pages. API routes only for:
  - Plaid webhooks (must be POST endpoints)
  - Plaid Link token exchange (client-side Plaid Link calls back to your server)
  - Any endpoint that external services call into
- **Colocation**: Keep page-specific components in `_components/` subdirectories within
  route folders when they're only used by that page.
- **No raw Plaid types in the frontend.** The `lib/plaid/` module transforms Plaid SDK
  responses into app-level types before they reach components.

### Database Schema Notes
- Better Auth tables (user, session, account, verification) are already defined.
  Do NOT modify these — extend with new tables that reference `user.id`.
- All financial tables use `userId` as a foreign key to Better Auth's `user` table.
- `plaid_items` stores access tokens — these MUST be encrypted at rest using
  AES-256-GCM via the ENCRYPTION_KEY env var. Never store plaintext access tokens.
- Transactions use Plaid's `transaction_id` as a unique constraint for deduplication
  during sync operations.
- Use Drizzle's `timestamp` with `{ mode: 'date' }` for all date columns.

### Plaid Integration Pattern
- Use Plaid's **Transaction Sync** (not legacy `/transactions/get`).
- Store the sync cursor per `plaid_item` so incremental syncs are efficient.
- Webhooks trigger background sync — the webhook endpoint validates the
  Plaid-Verification header, then calls the sync function.
- Link flow: server creates link token → client opens Plaid Link →
  client sends public_token to server → server exchanges for access_token →
  server stores encrypted access_token in plaid_items → server triggers
  initial sync.

### API Response Convention
All API routes return a consistent shape:
```typescript
type ApiResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string }
```
Use zod for input validation on every API route and server action.

### Error Handling
- Plaid errors must be caught and mapped to user-friendly messages.
  Never expose raw Plaid error objects to the client.
- Use a global error boundary at the dashboard layout level.
- Log Plaid errors with the item ID but NEVER log access tokens.

### Environment Variables
Required (add to `.env.local` and Railway):
- `DATABASE_URL` — Supabase PostgreSQL connection string
- `BETTER_AUTH_SECRET` — Auth secret (from template)
- `BETTER_AUTH_URL` — App URL (from template)
- `PLAID_CLIENT_ID` — From Plaid dashboard
- `PLAID_SECRET` — Plaid secret (sandbox vs production)
- `PLAID_ENV` — "sandbox" | "production"
- `PLAID_WEBHOOK_URL` — Public webhook URL (ngrok for local dev)
- `ENCRYPTION_KEY` — 32-byte hex string for AES-256-GCM encryption of access tokens

### Deployment (Railway)
- Use standalone Next.js output mode with a multi-stage Dockerfile.
- Set all env vars in Railway dashboard.
- Plaid webhook URL must point to the Railway domain.