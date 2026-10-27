/**
 * Per-category scoring for category suggestions against labeled rows. Used by
 * the accuracy suite (tests/integration/category-accuracy.test.ts) with the
 * mock model, and usable unchanged for a live eval run.
 *
 * "uncertain" (predicted null) is not counted as wrong: it lowers coverage
 * and recall, never precision, because it routes to the user instead of
 * guessing.
 */

export interface LabeledPrediction {
  label: string;
  /** null = the model said uncertain. */
  predicted: string | null;
}

export interface CategoryScore {
  /** Rows labeled with this category. */
  support: number;
  /** Of those, rows the model answered (not uncertain). */
  answered: number;
  /** Of those, rows answered correctly. */
  correct: number;
  /** Rows the model assigned this category to (right or wrong). */
  predicted: number;
  /** correct / answered (accuracy when it commits), null when nothing answered. */
  accuracy: number | null;
  /** correct / support. */
  recall: number | null;
  /** correct / predicted. */
  precision: number | null;
}

export interface CategorizationScore {
  overall: { n: number; answered: number; correct: number; coverage: number; accuracy: number | null };
  byCategory: Record<string, CategoryScore>;
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function scoreSuggestions(rows: LabeledPrediction[]): CategorizationScore {
  const byCategory: Record<string, CategoryScore> = {};
  const entry = (c: string) =>
    (byCategory[c] ??= { support: 0, answered: 0, correct: 0, predicted: 0, accuracy: null, recall: null, precision: null });

  for (const { label, predicted } of rows) {
    const e = entry(label);
    e.support++;
    if (predicted === null) continue;
    e.answered++;
    entry(predicted).predicted++;
    if (predicted === label) e.correct++;
  }
  for (const e of Object.values(byCategory)) {
    e.accuracy = ratio(e.correct, e.answered);
    e.recall = ratio(e.correct, e.support);
    e.precision = ratio(e.correct, e.predicted);
  }

  const answered = rows.filter((r) => r.predicted !== null).length;
  const correct = rows.filter((r) => r.predicted === r.label).length;
  return {
    overall: { n: rows.length, answered, correct, coverage: ratio(answered, rows.length) ?? 0, accuracy: ratio(correct, answered) },
    byCategory,
  };
}

/** A plain-text table, one line per category, for test and eval output. */
export function formatScore(score: CategorizationScore): string {
  const pct = (v: number | null) => (v === null ? "   –" : `${Math.round(v * 100)}%`.padStart(4));
  const lines = Object.entries(score.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, e]) => `${c.padEnd(26)} n=${String(e.support).padStart(4)}  acc ${pct(e.accuracy)}  recall ${pct(e.recall)}  precision ${pct(e.precision)}`);
  const o = score.overall;
  lines.push(`${"OVERALL".padEnd(26)} n=${String(o.n).padStart(4)}  acc ${pct(o.accuracy)}  coverage ${pct(o.coverage)}`);
  return lines.join("\n");
}
