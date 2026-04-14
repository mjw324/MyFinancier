"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function BackupCodesDisplay({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    toast.success("Backup codes copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-destructive font-medium">
        Store these codes somewhere safe. Each code can only be used once.
      </p>
      <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/50 p-4">
        {codes.map((code, i) => (
          <code key={i} className="text-sm font-mono">
            {code}
          </code>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={handleCopy}>
        {copied ? "Copied" : "Copy All"}
      </Button>
    </div>
  );
}
