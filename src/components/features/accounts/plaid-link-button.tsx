"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, RefreshCw } from "lucide-react";

interface PlaidLinkButtonProps {
  plaidItemId?: string;
  children?: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

function PlaidLinkLauncher({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string, metadata: any) => void;
  onExit: (error: any) => void;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}

export function PlaidLinkButton({
  plaidItemId,
  children,
  variant = "default",
  size = "default",
}: PlaidLinkButtonProps) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
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
          router.refresh();
        } else {
          toast.error(data.error || "Failed to link account");
        }
      } catch {
        toast.error("Failed to link account. Please try again.");
      } finally {
        setLinkToken(null);
      }
    },
    [router],
  );

  const onExit = useCallback((error: any) => {
    setLinkToken(null);
    if (error) {
      toast.error("Connection was interrupted. Please try again.");
    }
  }, []);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plaidItemId ? { plaidItemId } : {}),
      });
      const data = await res.json();
      if (data.success) {
        setLinkToken(data.data.linkToken);
      } else {
        toast.error(data.error || "Failed to initialize connection");
      }
    } catch {
      toast.error("Failed to connect. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
        ) : plaidItemId ? (
          <RefreshCw className="size-4" />
        ) : (
          <Plus className="size-4" />
        )}
        {children ?? (plaidItemId ? "Reconnect" : "Link Account")}
      </Button>
      {linkToken && (
        <PlaidLinkLauncher
          token={linkToken}
          onSuccess={onSuccess}
          onExit={onExit}
        />
      )}
    </>
  );
}
