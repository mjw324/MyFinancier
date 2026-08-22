"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function PlaidOAuthReturnPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const stored = sessionStorage.getItem("plaid_link_token");
    if (!stored) {
      toast.error("Link session expired. Please start over.");
      router.replace("/accounts");
      return;
    }
    setToken(stored);
    setReceivedRedirectUri(window.location.href);
  }, [router]);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: any) => {
      if (!publicToken) {
        toast.error("Failed to link account. Missing token.");
        sessionStorage.removeItem("plaid_link_token");
        router.replace("/accounts");
        return;
      }
      try {
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            metadata: {
              institution: {
                name: metadata.institution?.name ?? "",
                institutionId: metadata.institution?.institution_id ?? "",
              },
              accounts: (metadata.accounts ?? []).map((a: any) => ({
                id: a.id,
                name: a.name,
                mask: a.mask,
                type: a.type,
                subtype: a.subtype,
              })),
            },
          }),
        });
        const data = await response.json();
        if (data.success) {
          toast.success("Account linked successfully!");
        } else {
          toast.error(data.error || "Failed to link account");
        }
      } catch {
        toast.error("Failed to link account. Please try again.");
      } finally {
        sessionStorage.removeItem("plaid_link_token");
        router.replace("/accounts");
      }
    },
    [router],
  );

  const onExit = useCallback(
    (error: any) => {
      sessionStorage.removeItem("plaid_link_token");
      if (error) toast.error("Connection was interrupted. Please try again.");
      router.replace("/accounts");
    },
    [router],
  );

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p>Completing bank connection…</p>
      </div>
      {token && receivedRedirectUri && (
        <PlaidOAuthLauncher
          token={token}
          receivedRedirectUri={receivedRedirectUri}
          onSuccess={onSuccess}
          onExit={onExit}
        />
      )}
    </div>
  );
}

function PlaidOAuthLauncher({
  token,
  receivedRedirectUri,
  onSuccess,
  onExit,
}: {
  token: string;
  receivedRedirectUri: string;
  onSuccess: (publicToken: string | null, metadata: any) => void;
  onExit: (error: any) => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}
