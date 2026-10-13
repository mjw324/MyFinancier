"use client";

import { useCallback, useEffect, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  clearLinkSession,
  completeLinkSession,
  loadLinkSession,
  startLinkSession,
  successMessage,
  type LinkSession,
} from "@/components/features/accounts/plaid-link-flow";

type LaunchState = {
  session: LinkSession;
  /** Set when resuming the session Plaid redirected back from. */
  receivedRedirectUri?: string;
};

function safeReturnTo(path: string | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/accounts";
}

export default function PlaidOAuthReturnPage() {
  const router = useRouter();
  const [launch, setLaunch] = useState<LaunchState | null>(null);

  useEffect(() => {
    const session = loadLinkSession();
    if (!session) {
      toast.error("Your bank connection session expired. Please start again.");
      router.replace("/accounts");
      return;
    }
    setLaunch({ session, receivedRedirectUri: window.location.href });
  }, [router]);

  const done = useCallback(
    (session: LinkSession) => {
      clearLinkSession();
      router.replace(safeReturnTo(session.returnTo));
    },
    [router],
  );

  const onSuccess = useCallback(
    async (
      session: LinkSession,
      publicToken: string | null,
      metadata: PlaidLinkOnSuccessMetadata,
    ) => {
      const outcome = await completeLinkSession(session, publicToken, metadata);

      if (outcome.kind === "duplicate") {
        // Already connected: open update mode (with account selection) on the
        // existing connection. This is a fresh Link session, so it starts
        // without receivedRedirectUri; if the bank uses OAuth again, Plaid
        // redirects back here and the stored session resumes it.
        toast.info(outcome.message);
        const next = await startLinkSession({
          plaidItemId: outcome.existingPlaidItemId,
          accountSelection: true,
          returnTo: session.returnTo,
        });
        if (next.ok) {
          setLaunch({ session: next.session });
          return;
        }
        toast.error(next.message);
        done(session);
        return;
      }

      if (outcome.kind === "error") toast.error(outcome.message);
      else toast.success(successMessage(outcome));
      done(session);
    },
    [done],
  );

  const onExit = useCallback(
    (session: LinkSession, error: PlaidLinkError | null) => {
      if (error) {
        toast.error("The bank connection was interrupted. Please try again.");
      }
      done(session);
    },
    [done],
  );

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p>Completing bank connection…</p>
      </div>
      {launch && (
        <PlaidOAuthLauncher
          key={launch.session.token + (launch.receivedRedirectUri ? ":oauth" : "")}
          launch={launch}
          onSuccess={onSuccess}
          onExit={onExit}
        />
      )}
    </div>
  );
}

function PlaidOAuthLauncher({
  launch,
  onSuccess,
  onExit,
}: {
  launch: LaunchState;
  onSuccess: (
    session: LinkSession,
    publicToken: string | null,
    metadata: PlaidLinkOnSuccessMetadata,
  ) => void;
  onExit: (session: LinkSession, error: PlaidLinkError | null) => void;
}) {
  const { session, receivedRedirectUri } = launch;
  const { open, ready } = usePlaidLink({
    token: session.token,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: (publicToken, metadata) => onSuccess(session, publicToken, metadata),
    onExit: (error) => onExit(session, error),
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}
