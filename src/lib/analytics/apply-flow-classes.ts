/**
 * Applies flow classification to stored transactions.
 *
 * The rules are pure (`flow-classify.ts`, `transfers.ts` planner); this
 * module loads one user's snapshot, plans pairs and classes in memory, and
 * writes only what changed with set-based statements (UPDATE … FROM VALUES).
 *
 * Every pass recomputes the user's whole history:
 * - it is idempotent (a second run writes nothing),
 * - it self-heals rows left unclassified (flow_class IS NULL) by a failed or
 *   interrupted run,
 * - it picks up context changes (an account linked or unlinked, a card's
 *   history reaching further back) without a separate trigger,
 * - and both legs of every created or cleared pair are reclassified.
 * Rows the user classified by hand (flow_class_source = 'manual') keep their
 * class; only their derived legacy flags and counterparty key are refreshed.
 *
 * Writers must hold the per-user advisory lock (`lockUserFlows`) inside a
 * transaction, so two passes for the same user never interleave.
 */

import { sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { FLOW_CLASS_GROUP, isFlowClass, legacyFlagsFor, type FlowClass } from "./flow";
import {
  classifyFlow,
  type ClassifyContext,
  type FlowAccount,
} from "./flow-classify";
import { counterpartyKey } from "./counterparty";
import {
  applyPairPlan,
  applyPairPlanToRows,
  execRows,
  planTransferPairs,
  type PairPlan,
} from "@/lib/plaid/transfers";

export interface FlowRow {
  id: string;
  accountId: string;
  amount: string;
  date: Date;
  name: string;
  merchantName: string | null;
  category: string | null;
  categoryId: string | null;
  customCategory: string | null;
  customName: string | null;
  pending: boolean | null;
  transferPairId: string | null;
  flowClass: string | null;
  flowClassSource: string | null;
  counterpartyKey: string | null;
  isTransfer: boolean;
  isRefund: boolean;
  refundSource: string | null;
}

export interface FlowSnapshot {
  userName: string | null;
  accounts: FlowAccount[];
  rows: FlowRow[];
}

export interface RowUpdate {
  id: string;
  flowClass: FlowClass;
  flowClassSource: "auto" | "manual";
  counterpartyKey: string | null;
  isTransfer: boolean;
  isRefund: boolean;
  refundSource: "auto" | "manual" | null;
}

export interface ClassSummary {
  count: number;
  /** Sum of amounts in cents (Plaid sign: positive = money out). */
  cents: number;
}

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

/** Fills each account's history window from the user's posted rows. */
export function withHistoryWindows(accounts: FlowAccount[], rows: FlowRow[]): FlowAccount[] {
  const win = new Map<string, { start: Date; end: Date }>();
  for (const r of rows) {
    if (r.pending) continue;
    const w = win.get(r.accountId);
    if (!w) win.set(r.accountId, { start: r.date, end: r.date });
    else {
      if (r.date < w.start) w.start = r.date;
      if (r.date > w.end) w.end = r.date;
    }
  }
  return accounts.map((a) => ({
    ...a,
    historyStart: a.historyStart ?? win.get(a.id)?.start ?? null,
    historyEnd: a.historyEnd ?? win.get(a.id)?.end ?? null,
  }));
}

export function buildContext(snapshot: FlowSnapshot): ClassifyContext {
  return {
    accounts: withHistoryWindows(snapshot.accounts, snapshot.rows),
    userName: snapshot.userName,
  };
}

/**
 * A manual refund decision made before flow classes existed
 * (refund_source = 'manual') becomes a manual flow class, so it keeps
 * meaning something: "refund" → refund, "not a refund" → income.
 */
function legacyManualClass(row: FlowRow): FlowClass | null {
  if (row.flowClassSource === "manual") return null;
  if (row.refundSource !== "manual") return null;
  if (parseFloat(row.amount) >= 0) return null;
  return row.isRefund ? "refund" : "income";
}

function refundSourceFor(flowClass: FlowClass, manual: boolean): "auto" | "manual" | null {
  if (manual) return "manual";
  return FLOW_CLASS_GROUP[flowClass] === "offset" ? "auto" : null;
}

/**
 * Pairs that involve a pending leg are never written (a pending row may
 * vanish or be re-keyed when it posts), but they are still the best evidence
 * for classifying both legs while the money is in flight — e.g. a card
 * payment whose bank debit is still pending. Returns row id → partner row id.
 */
export function provisionalPartners(rows: FlowRow[], ctx: ClassifyContext): Map<string, string> {
  const unpaired = rows.filter((r) => !r.transferPairId);
  const plan = planTransferPairs(unpaired, ctx.accounts, ctx, () => "provisional", {
    allowPending: true,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const c of plan.create) {
    const a = byId.get(c.outId);
    const b = byId.get(c.inId);
    if (!a || !b || (!a.pending && !b.pending)) continue;
    out.set(a.id, b.id);
    out.set(b.id, a.id);
  }
  return out;
}

/** Classifies every row given the (already paired) rows; returns the desired state. */
export function planFlowClasses(rows: FlowRow[], ctx: ClassifyContext): RowUpdate[] {
  const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const provisional = provisionalPartners(rows, ctx);
  const byPair = new Map<string, FlowRow[]>();
  for (const r of rows) {
    if (!r.transferPairId) continue;
    const g = byPair.get(r.transferPairId) ?? [];
    g.push(r);
    byPair.set(r.transferPairId, g);
  }

  const out: RowUpdate[] = [];
  for (const row of rows) {
    const account = accountById.get(row.accountId);
    if (!account) continue;
    const legacy = legacyManualClass(row);
    const manual =
      legacy !== null || (row.flowClassSource === "manual" && isFlowClass(row.flowClass));

    let other: FlowRow | undefined;
    if (row.transferPairId) {
      const g = byPair.get(row.transferPairId) ?? [];
      if (g.length === 2) other = g[0].id === row.id ? g[1] : g[0];
    } else {
      const id = provisional.get(row.id);
      if (id) other = rowById.get(id);
    }
    const otherAccount = other ? accountById.get(other.accountId) : undefined;
    const partner =
      other && otherAccount
        ? { accountId: other.accountId, amount: other.amount, accountType: otherAccount.type }
        : null;

    const flowClass: FlowClass =
      legacy ??
      classifyFlow(
        {
          amount: row.amount,
          date: row.date,
          name: row.name,
          merchantName: row.merchantName,
          category: row.category,
          categoryId: row.categoryId,
          customCategory: row.customCategory,
          flowClass: row.flowClass,
          flowClassSource: row.flowClassSource,
          accountId: row.accountId,
          pairPartner: partner,
        },
        account,
        ctx,
      );
    const flags = legacyFlagsFor(flowClass);
    out.push({
      id: row.id,
      flowClass,
      flowClassSource: manual ? "manual" : "auto",
      counterpartyKey: counterpartyKey(row),
      isTransfer: flags.isTransfer,
      isRefund: flags.isRefund,
      refundSource: refundSourceFor(flowClass, manual),
    });
  }
  return out;
}

export function isChanged(row: FlowRow, u: RowUpdate): boolean {
  return (
    row.flowClass !== u.flowClass ||
    row.flowClassSource !== u.flowClassSource ||
    row.counterpartyKey !== u.counterpartyKey ||
    row.isTransfer !== u.isTransfer ||
    row.isRefund !== u.isRefund ||
    (row.refundSource ?? null) !== u.refundSource
  );
}

export interface FlowPlan {
  pairPlan: PairPlan;
  rows: FlowRow[];
  classes: RowUpdate[];
  updates: RowUpdate[];
}

/** Pairs, then classes, entirely in memory. Used by dry runs and the accuracy gate. */
export function planUserFlows(snapshot: FlowSnapshot, newPairId?: () => string): FlowPlan {
  const ctx = buildContext(snapshot);
  const pairPlan = planTransferPairs(snapshot.rows, ctx.accounts, ctx, newPairId);
  const rows = applyPairPlanToRows(snapshot.rows, pairPlan);
  const classes = planFlowClasses(rows, ctx);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const updates = classes.filter((u) => isChanged(byId.get(u.id)!, u));
  return { pairPlan, rows, classes, updates };
}

export function summarizeByClass(
  rows: Array<{ amount: string; flowClass: string | null }>,
): Record<string, ClassSummary> {
  const out: Record<string, ClassSummary> = {};
  for (const r of rows) {
    const key = r.flowClass ?? "(null)";
    const s = (out[key] ??= { count: 0, cents: 0 });
    s.count += 1;
    s.cents += Math.round(parseFloat(r.amount) * 100);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Per-user advisory lock for flow writes. Call inside a transaction. */
export async function lockUserFlows(executor: DbExecutor, userId: string): Promise<void> {
  await execRows(
    executor,
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`flow-classify:${userId}`}, 0)) AS locked`,
  );
}

export async function loadFlowSnapshot(executor: DbExecutor, userId: string): Promise<FlowSnapshot> {
  const [userRows, accountRows, txnRows] = await Promise.all([
    execRows(executor, sql`SELECT name FROM "user" WHERE id = ${userId}`),
    execRows(
      executor,
      sql`SELECT fa.id, fa.type, fa.subtype, fa.name, fa.official_name, pi.institution_name
          FROM financial_accounts fa
          JOIN plaid_items pi ON pi.id = fa.plaid_item_id
          WHERE fa.user_id = ${userId}`,
    ),
    execRows(
      executor,
      sql`SELECT id, account_id, amount::text AS amount, date, name, merchant_name, category,
                 category_id, custom_category, custom_name, pending, transfer_pair_id,
                 flow_class, flow_class_source, counterparty_key, is_transfer, is_refund,
                 refund_source
          FROM transactions
          WHERE user_id = ${userId}`,
    ),
  ]);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    userName: str(userRows[0]?.name),
    accounts: accountRows.map((a) => ({
      id: String(a.id),
      type: String(a.type),
      subtype: str(a.subtype),
      name: str(a.name),
      officialName: str(a.official_name),
      institutionName: str(a.institution_name),
    })),
    rows: txnRows.map((t) => ({
      id: String(t.id),
      accountId: String(t.account_id),
      amount: String(t.amount),
      date: t.date instanceof Date ? t.date : new Date(String(t.date)),
      name: String(t.name ?? ""),
      merchantName: str(t.merchant_name),
      category: str(t.category),
      categoryId: str(t.category_id),
      customCategory: str(t.custom_category),
      customName: str(t.custom_name),
      pending: t.pending === null || t.pending === undefined ? null : Boolean(t.pending),
      transferPairId: str(t.transfer_pair_id),
      flowClass: str(t.flow_class),
      flowClassSource: str(t.flow_class_source),
      counterpartyKey: str(t.counterparty_key),
      isTransfer: Boolean(t.is_transfer),
      isRefund: Boolean(t.is_refund),
      refundSource: str(t.refund_source),
    })),
  };
}

async function writeRowUpdates(
  executor: DbExecutor,
  userId: string,
  updates: RowUpdate[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    const values = sql.join(
      chunk.map(
        (u) =>
          sql`(${u.id}::text, ${u.flowClass}::text, ${u.flowClassSource}::text, ${u.counterpartyKey}::text, ${u.isTransfer}::boolean, ${u.isRefund}::boolean, ${u.refundSource}::text)`,
      ),
      sql`, `,
    );
    // Manual rows only receive their own (unchanged) class back; an auto row
    // that became manual concurrently is never overwritten.
    const rows = await execRows(
      executor,
      sql`UPDATE transactions AS t
          SET flow_class = v.flow_class,
              flow_class_source = v.flow_class_source,
              counterparty_key = v.counterparty_key,
              is_transfer = v.is_transfer,
              is_refund = v.is_refund,
              refund_source = v.refund_source
          FROM (VALUES ${values}) AS v(id, flow_class, flow_class_source, counterparty_key, is_transfer, is_refund, refund_source)
          WHERE t.id = v.id
            AND t.user_id = ${userId}
            AND (v.flow_class_source = 'manual' OR t.flow_class_source IS DISTINCT FROM 'manual')
          RETURNING t.id`,
    );
    written += rows.length;
  }
  return written;
}

export interface RecomputeResult {
  scanned: number;
  updated: number;
  pairsCreated: number;
  pairsCleared: number;
  pairsFailed: number;
  /** Rows whose flow class, flags or pair changed. */
  changedIds: string[];
  before: Record<string, ClassSummary>;
  after: Record<string, ClassSummary>;
}

/**
 * Recomputes pairs and flow classes for one user. Call inside a transaction
 * that holds `lockUserFlows(userId)`. With `dryRun`, nothing is written.
 */
export async function recomputeUserFlows(
  executor: DbExecutor,
  userId: string,
  options: { dryRun?: boolean } = {},
): Promise<RecomputeResult> {
  const snapshot = await loadFlowSnapshot(executor, userId);
  const before = summarizeByClass(snapshot.rows);
  const ctx = buildContext(snapshot);
  const pairPlan = planTransferPairs(snapshot.rows, ctx.accounts, ctx);

  let effectivePlan: Pick<PairPlan, "clear" | "create"> = pairPlan;
  let pairsFailed = 0;
  const changed = new Set<string>();
  if (!options.dryRun && (pairPlan.clear.length || pairPlan.create.length)) {
    const applied = await applyPairPlan(executor, userId, pairPlan);
    effectivePlan = { clear: applied.cleared, create: applied.created };
    pairsFailed = applied.failed.length;
    for (const id of applied.touchedRowIds) changed.add(id);
  }

  const rows = applyPairPlanToRows(snapshot.rows, effectivePlan);
  const classes = planFlowClasses(rows, ctx);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const updates = classes.filter((u) => isChanged(byId.get(u.id)!, u));
  for (const u of updates) changed.add(u.id);

  const updated = options.dryRun ? 0 : await writeRowUpdates(executor, userId, updates);
  const classById = new Map(classes.map((c) => [c.id, c.flowClass]));
  const after = summarizeByClass(
    rows.map((r) => ({ amount: r.amount, flowClass: classById.get(r.id) ?? r.flowClass })),
  );

  return {
    scanned: snapshot.rows.length,
    updated,
    pairsCreated: effectivePlan.create.length,
    pairsCleared: effectivePlan.clear.length,
    pairsFailed,
    changedIds: [...changed],
    before,
    after,
  };
}

/** Opens a transaction, takes the per-user lock and recomputes. */
export async function recomputeUserFlowsLocked(
  userId: string,
  options: { dryRun?: boolean } = {},
): Promise<RecomputeResult> {
  return db.transaction(async (tx) => {
    await lockUserFlows(tx, userId);
    return recomputeUserFlows(tx, userId, options);
  });
}
