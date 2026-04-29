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
import { RotateCcw } from "lucide-react";
import { resetTransactionCustomizationsAction } from "@/app/(routes)/(dashboard)/settings/actions";

export function ResetCustomizationsDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleReset() {
    startTransition(async () => {
      const result = await resetTransactionCustomizationsAction();
      if (result.success) {
        toast.success("All customizations reset");
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
          <RotateCcw className="size-3.5" />
          Reset all
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset transaction customizations?</DialogTitle>
          <DialogDescription>
            This clears every nickname and category override across all of your
            transactions and recurring streams, restoring the original values
            from Plaid. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReset}
            disabled={isPending}
          >
            {isPending ? "Resetting..." : "Reset all"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
