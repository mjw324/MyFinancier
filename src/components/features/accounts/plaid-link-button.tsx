"use client";

import { useState, useCallback, useEffect } from "react";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
  type PlaidLinkError,
} from "react-plaid-link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarClock, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  clearLinkSession,
  completeLinkSession,
  startLinkSession,
  successMessage,
  type LinkSession,
} from "./plaid-link-flow";

/** Which update-mode flow to open on an existing connection. */
export type PlaidLinkAction = "reconnect" | "renew" | "add_accounts";

interface PlaidLinkButtonProps {
  /** Existing connection: opens Link in update mode instead of a new link. */
  plaidItemId?: string;
  /** Update-mode flavour (default "reconnect"). "add_accounts" enables account selection. */
  action?: PlaidLinkAction;
  children?: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

const LABELS: Record<PlaidLinkAction, string> = {
  reconnect: "Reconnect",
  renew: "Renew",
  add_accounts: "Add accounts",
};

function PlaidLinkLauncher({
  session,
  onSuccess,
  onExit,
}: {
  session: LinkSession;
  onSuccess: (
    session: LinkSession,
    publicToken: string | null,
    metadata: PlaidLinkOnSuccessMetadata,
  ) => void;
  onExit: (session: LinkSession, error: PlaidLinkError | null) => void;
}) {
  const { open, ready } = usePlaidLink({
    token: session.token,
    onSuccess: (publicToken, metadata) => onSuccess(session, publicToken, metadata),
    onExit: (error) => onExit(session, error),
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}

export function PlaidLinkButton({
  plaidItemId,
  action = "reconnect",
  children,
  variant = "default",
  size = "default",
}: PlaidLinkButtonProps) {
  const router = useRouter();
  const [session, setSession] = useState<LinkSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const finish = useCallback(() => {
    clearLinkSession();
    setSession(null);
  }, []);

  const onSuccess = useCallback(
    async (
      current: LinkSession,
      publicToken: string | null,
      metadata: PlaidLinkOnSuccessMetadata,
    ) => {
      setIsLoading(true);
      try {
        const outcome = await completeLinkSession(current, publicToken, metadata);

        if (outcome.kind === "duplicate") {
          // Already connected: reopen Link in update mode on that connection
          // (with account selection) instead of creating a duplicate Item.
          toast.info(outcome.message);
          const next = await startLinkSession({
            plaidItemId: outcome.existingPlaidItemId,
            accountSelection: true,
            returnTo: current.returnTo,
          });
          if (next.ok) {
            setSession(next.session);
          } else {
            toast.error(next.message);
            finish();
          }
          return;
        }

        finish();
        if (outcome.kind === "error") {
          toast.error(outcome.message);
          return;
        }
        toast.success(successMessage(outcome));
        router.refresh();
      } finally {
        setIsLoading(false);
      }
    },
    [router, finish],
  );

  const onExit = useCallback(
    (_current: LinkSession, error: PlaidLinkError | null) => {
      finish();
      if (error) {
        toast.error("The bank connection was interrupted. Please try again.");
      }
    },
    [finish],
  );

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const result = await startLinkSession({
        plaidItemId,
        accountSelection: plaidItemId ? action === "add_accounts" : undefined,
        returnTo: window.location.pathname,
      });
      if (result.ok) setSession(result.session);
      else toast.error(result.message);
    } finally {
      setIsLoading(false);
    }
  };

  const Icon = !plaidItemId || action === "add_accounts"
    ? Plus
    : action === "renew"
      ? CalendarClock
      : RefreshCw;

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={isLoading}
        variant={variant}
        size={size}
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Icon className="size-4" />
        )}
        {children ?? (plaidItemId ? LABELS[action] : "Link Account")}
      </Button>
      {session && (
        <PlaidLinkLauncher
          key={session.token}
          session={session}
          onSuccess={onSuccess}
          onExit={onExit}
        />
      )}
    </>
  );
}
