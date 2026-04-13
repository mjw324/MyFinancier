"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Unlink } from "lucide-react";
import { unlinkPlaidItemAction } from "@/app/(routes)/(dashboard)/settings/actions";

interface UnlinkAccountDialogProps {
  plaidItemId: string;
  institutionName: string;
  accountCount: number;
}

export function UnlinkAccountDialog({
  plaidItemId,
  institutionName,
  accountCount,
}: UnlinkAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleUnlink() {
    startTransition(async () => {
      const result = await unlinkPlaidItemAction(plaidItemId);
      if (result.success) {
        toast.success(`Unlinked ${institutionName}`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Unlink className="size-3.5" />
          Unlink
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlink {institutionName}?</DialogTitle>
          <DialogDescription>
            This will permanently remove {accountCount} account
            {accountCount !== 1 ? "s" : ""} and all associated transactions from{" "}
            {institutionName}. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleUnlink}
            disabled={isPending}
          >
            {isPending ? "Unlinking..." : "Unlink"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
