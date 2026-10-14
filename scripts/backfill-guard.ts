/**
 * Target-database guard for maintenance scripts: a script may only write to
 * a local database unless the operator explicitly confirms the remote host.
 * Pure (the prompt is injected) so it can be unit-tested.
 */

export function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
}

export function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

export interface GuardOptions {
  confirmProduction: boolean;
  confirmHost: string | null;
  /** Asks the operator to type the host; null when no terminal is attached. */
  ask: ((question: string) => Promise<string>) | null;
  action: string;
}

/** Throws unless the target is local or the operator confirmed the exact host. */
export async function assertTargetAllowed(host: string, opts: GuardOptions): Promise<void> {
  if (isLocalHost(host)) return;
  if (!opts.confirmProduction) {
    throw new Error(
      `Refusing to run against non-local host ${host}. Re-run with --confirm-production if this is intended.`,
    );
  }
  let typed = opts.confirmHost;
  if (!typed) {
    if (!opts.ask) {
      throw new Error("Non-interactive run against a non-local host: pass --confirm-host <host>.");
    }
    typed = (await opts.ask(`Type the host name to ${opts.action} against it: `)).trim();
  }
  if (typed !== host) throw new Error("Host confirmation did not match; nothing was done.");
}
