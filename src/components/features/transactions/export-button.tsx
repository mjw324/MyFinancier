"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Mode = "standard" | "detailed";

interface ExportButtonProps {
  count: number;
}

const CONFIRM_THRESHOLD = 5000;

export function ExportButton({ count }: ExportButtonProps) {
  const searchParams = useSearchParams();
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);

  function startDownload(mode: Mode) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("mode", mode);
    const url = `/api/transactions/export?${params.toString()}`;
    toast.message("Preparing export…", {
      description: "Your spreadsheet will download shortly.",
      duration: 4000,
    });
    window.location.assign(url);
  }

  function handleSelect(mode: Mode) {
    if (count > CONFIRM_THRESHOLD) {
      setPendingMode(mode);
    } else {
      startDownload(mode);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={count === 0}>
            <Download className="size-4" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => handleSelect("standard")}>
            Standard
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleSelect("detailed")}>
            Detailed (debug)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMode(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Export {count.toLocaleString()} transactions?
            </DialogTitle>
            <DialogDescription>
              That&rsquo;s a lot of rows &mdash; generating the file may take a
              few seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMode(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const mode = pendingMode;
                setPendingMode(null);
                if (mode) startDownload(mode);
              }}
            >
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
