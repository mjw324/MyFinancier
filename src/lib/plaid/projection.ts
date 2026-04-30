export type Frequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type StreamStatus =
  | "MATURE"
  | "EARLY_DETECTION"
  | "TOMBSTONED"
  | "UNKNOWN";

export type FlowType = "inflow" | "outflow";

export interface ProjectionInputStream {
  streamId: string;
  flowType: FlowType;
  frequency: Frequency;
  status: StreamStatus;
  isActive: boolean;
  predictedNextDate: Date | null;
  lastDate: Date | null;
  averageAmount: number;
  lastAmount: number;
  merchantName: string | null;
  description: string;
  customName: string | null;
  /** Optional: posted dates of recent transactions, newest first.
   *  Used to derive the two days-of-month for SEMI_MONTHLY streams. */
  recentTransactionDates?: Date[];
}

export interface ProjectedEvent {
  streamId: string;
  date: Date;
  amount: number;
  flowType: FlowType;
  frequency: Frequency;
  status: StreamStatus;
  merchantName: string | null;
  description: string;
  customName: string | null;
  hasPriceChange: boolean;
  tentative: boolean;
}

const PRICE_CHANGE_THRESHOLD = 0.05;

export function projectStreamEvents(
  stream: ProjectionInputStream,
  windowStart: Date,
  windowEnd: Date,
): ProjectedEvent[] {
  if (!stream.isActive) return [];
  if (stream.status === "TOMBSTONED") return [];
  if (!stream.predictedNextDate) return [];

  const tentative = stream.status === "EARLY_DETECTION";
  const hasPriceChange =
    stream.averageAmount > 0 &&
    Math.abs(stream.lastAmount - stream.averageAmount) /
      stream.averageAmount >
      PRICE_CHANGE_THRESHOLD;

  const baseEvent = (date: Date): ProjectedEvent => ({
    streamId: stream.streamId,
    date,
    amount: stream.lastAmount,
    flowType: stream.flowType,
    frequency: stream.frequency,
    status: stream.status,
    merchantName: stream.merchantName,
    description: stream.description,
    customName: stream.customName,
    hasPriceChange,
    tentative,
  });

  const events: ProjectedEvent[] = [];
  const inWindow = (d: Date) => d >= windowStart && d <= windowEnd;

  if (stream.frequency === "UNKNOWN") {
    if (inWindow(stream.predictedNextDate)) {
      events.push(baseEvent(new Date(stream.predictedNextDate)));
    }
    return events;
  }

  if (stream.frequency === "SEMI_MONTHLY") {
    return projectSemiMonthly(stream, windowStart, windowEnd, baseEvent);
  }

  const anchor = stream.predictedNextDate;
  let cursor = new Date(anchor);
  // safety: cap iterations
  for (let i = 0; i < 400; i++) {
    if (cursor > windowEnd) break;
    if (cursor >= windowStart) events.push(baseEvent(new Date(cursor)));
    cursor = stepFromAnchor(anchor, i + 1, stream.frequency);
  }
  return events;
}

function stepFromAnchor(
  anchor: Date,
  steps: number,
  frequency: Frequency,
): Date {
  switch (frequency) {
    case "WEEKLY": {
      const d = new Date(anchor);
      d.setDate(d.getDate() + 7 * steps);
      return d;
    }
    case "BIWEEKLY": {
      const d = new Date(anchor);
      d.setDate(d.getDate() + 14 * steps);
      return d;
    }
    case "MONTHLY":
      return addMonthsClamped(anchor, steps);
    case "ANNUALLY":
      return addMonthsClamped(anchor, 12 * steps);
    default: {
      const d = new Date(anchor);
      d.setDate(d.getDate() + steps);
      return d;
    }
  }
}

function addMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const day = Math.min(date.getDate(), lastDay);
  return new Date(
    targetYear,
    normalizedMonth,
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

function projectSemiMonthly(
  stream: ProjectionInputStream,
  windowStart: Date,
  windowEnd: Date,
  baseEvent: (date: Date) => ProjectedEvent,
): ProjectedEvent[] {
  const days = deriveSemiMonthlyDays(stream);
  const events: ProjectedEvent[] = [];
  const startMonth = new Date(
    stream.predictedNextDate!.getFullYear(),
    stream.predictedNextDate!.getMonth(),
    1,
  );
  const endMonth = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);

  let monthCursor = startMonth;
  while (monthCursor <= endMonth) {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (const dom of days) {
      const day = dom === -1 ? lastDay : Math.min(dom, lastDay);
      const candidate = new Date(year, month, day);
      if (candidate < stream.predictedNextDate!) continue;
      if (candidate < windowStart) continue;
      if (candidate > windowEnd) continue;
      events.push(baseEvent(candidate));
    }
    monthCursor = new Date(year, month + 1, 1);
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

/** Returns up to two days-of-month (1-31, or -1 for last-day-of-month). */
function deriveSemiMonthlyDays(stream: ProjectionInputStream): number[] {
  const recent = stream.recentTransactionDates ?? [];
  const doms = new Set<number>();
  for (const d of recent.slice(0, 4)) {
    const day = d.getDate();
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    doms.add(day === lastDay ? -1 : day);
    if (doms.size === 2) break;
  }
  if (doms.size === 2) return [...doms].sort((a, b) => sortDom(a, b));
  if (doms.size === 1) {
    // Pair the known day with the most likely complement
    const only = [...doms][0];
    if (only === -1 || only > 20) return [15, -1];
    return [only, -1];
  }
  return [15, -1];
}

function sortDom(a: number, b: number): number {
  // Treat -1 (last-day) as the largest value
  const av = a === -1 ? 32 : a;
  const bv = b === -1 ? 32 : b;
  return av - bv;
}
