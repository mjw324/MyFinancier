"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncPlaidItemAction } from "@/app/(routes)/(dashboard)/settings/actions";

interface SyncAccountButtonProps {
  plaidItemId: string;
  institutionName: string;
}

export function SyncAccountButton({
  plaidItemId,
  institutionName,
}: SyncAccountButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSync() {
    startTransition(async () => {
      const result = await syncPlaidItemAction(plaidItemId);
      if (result.success) {
        const { added, modified, removed } = result.data;
        const total = added + modified + removed;
        toast.success(
          total === 0
            ? `${institutionName} is up to date`
            : `Synced ${institutionName}: ${added} new, ${modified} updated${removed ? `, ${removed} removed` : ""}`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSync}
      disabled={isPending}
    >
      <RefreshCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} />
      {isPending ? "Syncing..." : "Sync"}
    </Button>
  );
}
