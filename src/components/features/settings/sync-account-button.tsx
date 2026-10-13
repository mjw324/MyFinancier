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

/** Counts if the sync ran inline; a queued sync returns no counts. */
function syncCounts(
  data: unknown,
): { added: number; modified: number; removed: number } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return typeof d.added === "number" &&
    typeof d.modified === "number" &&
    typeof d.removed === "number"
    ? { added: d.added, modified: d.modified, removed: d.removed }
    : null;
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
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const counts = syncCounts("data" in result ? result.data : undefined);
      if (!counts) {
        toast.success(`Syncing ${institutionName}…`);
      } else {
        const total = counts.added + counts.modified + counts.removed;
        toast.success(
          total === 0
            ? `${institutionName} is up to date`
            : `Synced ${institutionName}: ${counts.added} new, ${counts.modified} updated${counts.removed ? `, ${counts.removed} removed` : ""}`,
        );
      }
      router.refresh();
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
