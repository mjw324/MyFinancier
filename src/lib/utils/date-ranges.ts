/**
 * Pure date-range helpers for dashboard filters.
 * Always pass `now` explicitly in tests so results are deterministic.
 */

export type DashboardRange = "week" | "month" | "year" | "ytd";

export interface DateRange {
  start: Date;
  end: Date;
}

/** Current period for the given range, ending at `now`. */
export function getDateRange(range: DashboardRange, now: Date = new Date()): DateRange {
  switch (range) {
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case "month": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case "year": {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end: now };
  }
}

/** Previous period of the same length, used for delta comparisons. */
export function getPreviousDateRange(
  range: DashboardRange,
  now: Date = new Date(),
): DateRange {
  switch (range) {
    case "week": {
      const end = new Date(now);
      end.setDate(end.getDate() - 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "month": {
      const end = new Date(now);
      end.setDate(end.getDate() - 30);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "year": {
      const end = new Date(now);
      end.setFullYear(end.getFullYear() - 1);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "ytd": {
      const prevYear = now.getFullYear() - 1;
      const start = new Date(prevYear, 0, 1);
      const end = new Date(prevYear, now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
  }
}
