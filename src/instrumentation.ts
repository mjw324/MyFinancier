/**
 * Next.js instrumentation hook (runs once per server start).
 *
 * Starts the Plaid recovery sweep in the Node.js server runtime only: not
 * during `next build`, not in the Edge runtime, not under Vitest, and not when
 * PLAID_SYNC_SWEEP=off. The sweep drains items whose sync request was never
 * processed (e.g. the process was killed during a deploy before an `after()`
 * drain ran) or whose lease expired mid-run, and requests a sync for active
 * items with no successful sync in 24 hours. The timers are unref'd so they
 * never keep the process alive, and register() does not wait for them.
 */

const SWEEP_INITIAL_DELAY_MS = 60_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;

declare global {
  var __plaidSweepStarted: boolean | undefined;
}

export function shouldStartSweep(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NEXT_RUNTIME !== "nodejs") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (env.VITEST || env.NODE_ENV === "test") return false;
  if (env.PLAID_SYNC_SWEEP === "off") return false;
  return true;
}

export async function register(): Promise<void> {
  // The runtime check must wrap the import itself so the Edge build drops it
  // (Next.js docs: "Importing runtime-specific code").
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!shouldStartSweep()) return;
    if (globalThis.__plaidSweepStarted) return; // dev-server reloads
    globalThis.__plaidSweepStarted = true;

    const { sweepPlaidItems } = await import("./lib/plaid/jobs");
    const { logError } = await import("./lib/logging");

    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const { requested, drained } = await sweepPlaidItems();
        if (requested > 0 || drained > 0) {
          console.log(`[plaid-sweep] ${JSON.stringify({ requested, drained })}`);
        }
      } catch (error) {
        logError("plaid-sweep.failed", error);
      } finally {
        running = false;
      }
    };

    setTimeout(() => void tick(), SWEEP_INITIAL_DELAY_MS).unref();
    setInterval(() => void tick(), SWEEP_INTERVAL_MS).unref();
    console.log(
      `[plaid-sweep] scheduled: first run in ${SWEEP_INITIAL_DELAY_MS / 1000}s, then every ${SWEEP_INTERVAL_MS / 60_000} min`,
    );
  }
}
