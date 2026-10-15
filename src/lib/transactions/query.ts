/**
 * Parses the /transactions query string (and the export route's, which must
 * select the same rows). Every value is validated with zod; an invalid value
 * is dropped and reported instead of reaching the database — `?from=garbage`
 * used to become `new Date("garbage")` and crash the page.
 */

import { z } from "zod";
import { FLOW_CLASSES } from "@/lib/analytics/flow";
import { parseDateParam } from "@/lib/utils/date-ranges";
import type { TransactionFilters } from "@/lib/db/queries/transactions";

const FLOW_GROUPS = ["income", "spending", "offset", "savings", "internal"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

const FIELDS = {
  search: text(200),
  account: text(100),
  category: text(100),
  bucket: text(100),
  flowClass: z.enum(FLOW_CLASSES),
  flowGroup: z.enum(FLOW_GROUPS),
  counterparty: text(200),
  cost: z.enum(["fixed", "variable"]),
  view: z.enum(["spending"]),
  recurring: z.enum(["recurring", "onetime"]),
  spendingType: z.enum(["necessary", "discretionary", "unclassified"]),
  from: z.string().transform((v, ctx) => {
    const d = parseDateParam(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Expected YYYY-MM-DD" });
      return z.NEVER;
    }
    return d;
  }),
  to: z.string().transform((v, ctx) => {
    const d = parseDateParam(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Expected YYYY-MM-DD" });
      return z.NEVER;
    }
    return d;
  }),
  page: z.coerce.number().int().min(1).max(100_000),
} as const;

type FieldName = keyof typeof FIELDS;
type Parsed = { [K in FieldName]?: z.output<(typeof FIELDS)[K]> };

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedTransactionQuery {
  /** Filters without the hide-transfers preference (the caller adds it). */
  filters: Omit<TransactionFilters, "includeTransfers">;
  page: number;
  /** Query keys whose values were rejected and ignored. */
  invalid: string[];
  /** The accepted values, as strings, for building links (pagination). */
  params: Record<string, string>;
}

export function parseTransactionQuery(raw: RawSearchParams): ParsedTransactionQuery {
  const parsed: Parsed = {};
  const invalid: string[] = [];
  const params: Record<string, string> = {};

  for (const key of Object.keys(FIELDS) as FieldName[]) {
    const value = raw[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined || first === "") continue;
    const result = FIELDS[key].safeParse(first);
    if (result.success) {
      (parsed as Record<string, unknown>)[key] = result.data;
      params[key] = first;
    } else {
      invalid.push(key);
    }
  }

  let startDate = parsed.from;
  let endDate = parsed.to;
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
    [params.from, params.to] = [params.to, params.from];
  }

  return {
    filters: {
      search: parsed.search,
      accountId: parsed.account,
      category: parsed.category,
      bucket: parsed.bucket,
      flowClass: parsed.flowClass,
      flowGroup: parsed.flowGroup,
      counterparty: parsed.counterparty,
      cost: parsed.cost,
      view: parsed.view,
      startDate,
      endDate,
      recurring: parsed.recurring,
      spendingType: parsed.spendingType,
    },
    page: parsed.page ?? 1,
    invalid,
    params,
  };
}
