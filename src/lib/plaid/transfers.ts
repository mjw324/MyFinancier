import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db";
import {
  PAIR_WINDOW_DAYS,
  hasTransferEvidence,
  isPairable,
  namesAccount,
  rowFacts,
  toDayNumber,
  type ClassifyContext,
  type FlowAccount,
  type FlowTxn,
} from "@/lib/analytics/flow-classify";

/**
 * Transfer pairing: finds the two legs of one movement between the user's
 * own linked accounts (a bank debit and the card credit it paid, a wallet
 * cash-out and the bank deposit it became) and links them with a shared
 * `transfer_pair_id`. A validated pair is the strongest evidence the
 * classifier has that both legs are internal.
 *
 * Rules (verify-calcs 3.4, verify-plaid N9, review S2/§4.1):
 * - Full history, legs on different accounts, opposite signs, equal size,
 *   dated within ±PAIR_WINDOW_DAYS. The closest date wins; ties break on
 *   description cross-references, then evidence, then ids (deterministic).
 * - At least one leg must carry transfer / loan-payment evidence, and rows
 *   that are never transfer legs (purchases, refunds, rewards, payments
 *   to/from other people, ATM cash, pending or user-classified rows) are not
 *   candidates — so a purchase can never pair with an unrelated receipt.
 * - Existing pairs are re-validated: a pair whose partner was deleted
 *   (orphan) or that no longer passes the rules is cleared.
 * - Writes are guarded (`transfer_pair_id IS NULL`) and row counts checked,
 *   so a concurrent writer can never leave a one-sided pair.
 */

export { PAIR_WINDOW_DAYS };

export interface PairRow extends FlowTxn {
  id: string;
  accountId: string;
  pending?: boolean | null;
  transferPairId?: string | null;
}

export interface PairCreate {
  pairId: string;
  outId: string;
  inId: string;
}

export interface PairPlan {
  /** Existing pair ids to clear (orphaned or invalid). */
  clear: string[];
  /** Row ids whose pair is being cleared. */
  clearedRowIds: string[];
  create: PairCreate[];
}

interface Prepared {
  row: PairRow;
  account: FlowAccount;
  cents: number;
  day: number | null;
  evidence: boolean;
  liability: boolean;
}

function prepareRow(row: PairRow, account: FlowAccount, ctx: ClassifyContext): Prepared {
  const f = rowFacts(row);
  return {
    row,
    account,
    cents: f.cents,
    day: toDayNumber(row.date ?? null),
    evidence: hasTransferEvidence(row, account, ctx),
    liability: account.type === "credit" || account.type === "loan",
  };
}

/** The pairing rules for one (outflow, inflow) candidate. */
function compatible(out: Prepared, inn: Prepared): boolean {
  if (out.row.accountId === inn.row.accountId) return false;
  if (out.cents <= 0 || inn.cents >= 0 || out.cents !== -inn.cents) return false;
  if (out.day === null || inn.day === null) return false;
  if (Math.abs(out.day - inn.day) > PAIR_WINDOW_DAYS) return false;
  if (!out.evidence && !inn.evidence) return false;
  // Money leaving a card is a purchase unless the row itself says transfer.
  if (out.liability && !out.evidence) return false;
  if (out.liability && inn.liability && !(out.evidence && inn.evidence)) return false;
  return true;
}

function pairableIgnoringManual(p: Prepared, ctx: ClassifyContext): boolean {
  return isPairable({ ...p.row, flowClassSource: null }, p.account, ctx);
}

/**
 * Pure planner: which existing pairs to clear and which new pairs to create.
 * `rows` must be all of one user's transactions (full history).
 */
export function planTransferPairs(
  rows: PairRow[],
  accounts: FlowAccount[],
  ctx: ClassifyContext,
  newPairId: () => string = () => crypto.randomUUID(),
  options: { allowPending?: boolean } = {},
): PairPlan {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const prepared: Prepared[] = [];
  for (const row of rows) {
    const account = accountById.get(row.accountId);
    if (!account) continue;
    prepared.push(prepareRow(row, account, ctx));
  }

  // 1. Re-validate existing pairs.
  const groups = new Map<string, Prepared[]>();
  for (const p of prepared) {
    const id = p.row.transferPairId;
    if (!id) continue;
    const g = groups.get(id) ?? [];
    g.push(p);
    groups.set(id, g);
  }
  // Pair ids whose rows are not among the user's rows at all are invisible
  // here; rows referencing them form 1-element groups and are cleared.
  const clear: string[] = [];
  const clearedRowIds: string[] = [];
  const kept = new Set<string>();
  for (const [pairId, g] of groups) {
    let valid = false;
    if (g.length === 2) {
      const [a, b] = g;
      const [out, inn] = a.cents > 0 ? [a, b] : [b, a];
      valid =
        compatible(out, inn) &&
        pairableIgnoringManual(out, ctx) &&
        pairableIgnoringManual(inn, ctx);
    }
    if (valid) {
      for (const p of g) kept.add(p.row.id);
    } else {
      clear.push(pairId);
      for (const p of g) clearedRowIds.push(p.row.id);
    }
  }

  // 2. Candidates for new pairs.
  const clearedSet = new Set(clearedRowIds);
  const candidates = prepared.filter(
    (p) =>
      !kept.has(p.row.id) &&
      (!p.row.transferPairId || clearedSet.has(p.row.id)) &&
      isPairable(p.row, p.account, ctx, { allowPending: options.allowPending }),
  );

  const byCents = new Map<number, { outs: Prepared[]; ins: Prepared[] }>();
  for (const p of candidates) {
    const key = Math.abs(p.cents);
    const b = byCents.get(key) ?? { outs: [], ins: [] };
    (p.cents > 0 ? b.outs : b.ins).push(p);
    byCents.set(key, b);
  }

  type Edge = { out: Prepared; inn: Prepared; dist: number; cross: number; ev: number };
  const edges: Edge[] = [];
  for (const { outs, ins } of byCents.values()) {
    if (!outs.length || !ins.length) continue;
    for (const out of outs) {
      for (const inn of ins) {
        if (!compatible(out, inn)) continue;
        const cross =
          (namesAccount(out.row, inn.account, ctx) ? 1 : 0) +
          (namesAccount(inn.row, out.account, ctx) ? 1 : 0);
        edges.push({
          out,
          inn,
          dist: Math.abs(out.day! - inn.day!),
          cross,
          ev: (out.evidence ? 1 : 0) + (inn.evidence ? 1 : 0),
        });
      }
    }
  }
  edges.sort(
    (a, b) =>
      a.dist - b.dist ||
      b.cross - a.cross ||
      b.ev - a.ev ||
      (a.out.row.id < b.out.row.id ? -1 : a.out.row.id > b.out.row.id ? 1 : 0) ||
      (a.inn.row.id < b.inn.row.id ? -1 : a.inn.row.id > b.inn.row.id ? 1 : 0),
  );

  const used = new Set<string>();
  const create: PairCreate[] = [];
  for (const e of edges) {
    if (used.has(e.out.row.id) || used.has(e.inn.row.id)) continue;
    used.add(e.out.row.id);
    used.add(e.inn.row.id);
    create.push({ pairId: newPairId(), outId: e.out.row.id, inId: e.inn.row.id });
  }

  return { clear, clearedRowIds, create };
}

/** Applies a plan to in-memory rows (for dry runs and the classifier). */
export function applyPairPlanToRows<T extends PairRow>(
  rows: T[],
  plan: Pick<PairPlan, "clear" | "create">,
): T[] {
  const clear = new Set(plan.clear);
  const assign = new Map<string, string>();
  for (const c of plan.create) {
    assign.set(c.outId, c.pairId);
    assign.set(c.inId, c.pairId);
  }
  return rows.map((r) => {
    let pairId = r.transferPairId ?? null;
    if (pairId && clear.has(pairId)) pairId = null;
    const a = assign.get(r.id);
    if (a) pairId = a;
    return pairId === (r.transferPairId ?? null) ? r : { ...r, transferPairId: pairId };
  });
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Normalises db.execute() results across postgres-js (array) and PGlite ({ rows }). */
export async function execRows(executor: DbExecutor, query: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await executor.execute(query)) as unknown;
  if (Array.isArray(res)) return res as Row[];
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

export interface AppliedPairs {
  created: PairCreate[];
  /** Planned pairs that could not be written (a leg changed concurrently). */
  failed: PairCreate[];
  cleared: string[];
  /** Every row whose pair id changed — both legs — so callers reclassify them. */
  touchedRowIds: string[];
}

/**
 * Writes a pair plan. Clears first, then creates each pair with a guarded
 * UPDATE; a pair where only one leg could be written is rolled back.
 * Must run inside the caller's transaction (and per-user lock).
 */
export async function applyPairPlan(
  executor: DbExecutor,
  userId: string,
  plan: PairPlan,
): Promise<AppliedPairs> {
  const touched = new Set<string>();
  const cleared: string[] = [];

  for (const chunk of chunks(plan.clear, 500)) {
    const ids = sql.join(chunk.map((id) => sql`${id}`), sql`, `);
    const rows = await execRows(
      executor,
      sql`UPDATE transactions SET transfer_pair_id = NULL
          WHERE user_id = ${userId} AND transfer_pair_id IN (${ids})
          RETURNING id`,
    );
    for (const r of rows) touched.add(String(r.id));
    cleared.push(...chunk);
  }

  const created: PairCreate[] = [];
  const failed: PairCreate[] = [];
  for (const chunk of chunks(plan.create, 250)) {
    const values = sql.join(
      chunk.flatMap((c) => [
        sql`(${c.outId}::text, ${c.pairId}::text)`,
        sql`(${c.inId}::text, ${c.pairId}::text)`,
      ]),
      sql`, `,
    );
    const rows = await execRows(
      executor,
      sql`UPDATE transactions AS t SET transfer_pair_id = v.pair_id
          FROM (VALUES ${values}) AS v(id, pair_id)
          WHERE t.id = v.id
            AND t.user_id = ${userId}
            AND t.transfer_pair_id IS NULL
            AND t.pending IS NOT TRUE
          RETURNING t.id, t.transfer_pair_id`,
    );
    const written = new Set(rows.map((r) => String(r.id)));
    const broken: string[] = [];
    for (const c of chunk) {
      if (written.has(c.outId) && written.has(c.inId)) {
        created.push(c);
        touched.add(c.outId);
        touched.add(c.inId);
      } else {
        failed.push(c);
        if (written.has(c.outId) || written.has(c.inId)) broken.push(c.pairId);
      }
    }
    if (broken.length) {
      const ids = sql.join(broken.map((id) => sql`${id}`), sql`, `);
      await execRows(
        executor,
        sql`UPDATE transactions SET transfer_pair_id = NULL
            WHERE user_id = ${userId} AND transfer_pair_id IN (${ids})
            RETURNING id`,
      );
    }
  }

  return { created, failed, cleared, touchedRowIds: [...touched] };
}

/**
 * Removes the pair a row belongs to (both legs). Returns the ids of the rows
 * that were unpaired (empty when the row had no pair).
 */
export async function unpairTransaction(
  executor: DbExecutor,
  userId: string,
  transactionId: string,
): Promise<string[]> {
  const rows = await execRows(
    executor,
    sql`UPDATE transactions SET transfer_pair_id = NULL
        WHERE user_id = ${userId}
          AND transfer_pair_id IS NOT NULL
          AND transfer_pair_id = (
            SELECT transfer_pair_id FROM transactions
            WHERE id = ${transactionId} AND user_id = ${userId}
          )
        RETURNING id`,
  );
  return rows.map((r) => String(r.id));
}

/**
 * @deprecated Legacy entry point kept for callers that predate
 * `postProcessTransactions`. Runs the full pairing + flow classification
 * pass for the user (under the per-user lock).
 */
export async function detectAndFlagTransfers(userId: string): Promise<{
  flaggedByCategory: number;
  pairedCount: number;
}> {
  const { recomputeUserFlowsLocked } = await import("@/lib/analytics/apply-flow-classes");
  const result = await recomputeUserFlowsLocked(userId);
  return { flaggedByCategory: 0, pairedCount: result.pairsCreated * 2 };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
