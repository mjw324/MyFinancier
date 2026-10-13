import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/get-session";
import { getUserToday } from "@/lib/utils/user-time";
import { loadForecastInput } from "@/lib/forecast/context";
import {
  computeSafeToSpend,
  type ForecastItem,
} from "@/lib/forecast/safe-to-spend";
import { logError } from "@/lib/logging";

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dollars = (cents: number) => cents / 100;

function item(e: ForecastItem) {
  return {
    stream_id: e.streamId,
    label: e.label,
    date: ymd(e.date),
    due_date: ymd(e.dueDate),
    amount: dollars(e.amountCents),
    kind: e.kind,
    frequency: e.frequency,
    late: e.late,
    tentative: e.tentative,
    has_price_change: e.hasPriceChange,
  };
}

/**
 * GET /api/safe-to-spend — "what you can spend before your next paycheck
 * lands". See src/lib/forecast/safe-to-spend.ts for the definition. Takes no
 * parameters; "today" is the viewer's calendar date.
 */
// The request carries no parameters; accepted only for the handler signature.
export async function GET(_request?: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  try {
    const today = await getUserToday();
    const input = await loadForecastInput(userId, today);
    const r = computeSafeToSpend(input);

    return NextResponse.json({
      success: true,
      data: {
        today: ymd(r.today),
        through: ymd(r.through),
        horizon_source: r.horizonSource,
        paycheck: r.paycheck ? item(r.paycheck) : null,
        cash: dollars(r.cashCents),
        cash_accounts: r.cashAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          balance: dollars(a.cents),
          is_stale: a.isStale,
          as_of: a.asOf?.toISOString() ?? null,
        })),
        card_mode: r.cardMode,
        card_obligations: dollars(r.cardObligationsCents),
        card_balances: dollars(r.cardBalancesCents),
        bills: dollars(r.billsCents),
        safe_to_spend: dollars(r.safeToSpendCents),
        upcoming: r.upcoming.map(item),
        tentative: r.tentative.map(item),
        possibly_ended: r.possiblyEnded.map((p) => ({
          stream_id: p.streamId,
          label: p.label,
          kind: p.kind,
          last_seen: ymd(p.lastSeen),
          expected: ymd(p.expected),
          amount: dollars(p.amountCents),
        })),
        excluded_accounts: r.excludedAccounts,
        stale_accounts: r.staleAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          as_of: a.asOf?.toISOString() ?? null,
        })),
      },
    });
  } catch (error) {
    logError("safe_to_spend.failed", error, { userId });
    return NextResponse.json(
      { success: false, error: "Could not calculate safe to spend right now." },
      { status: 500 },
    );
  }
}
