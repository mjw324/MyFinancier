"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Repeat, Tag, User } from "lucide-react";

interface SpendingTypePillProps {
  spendingType: string | null;
  source: string | null;
  onClick?: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Set manually",
  override: "Manual override",
  stream: "From recurring stream",
  rule: "From rule",
};

export function SpendingTypePill({
  spendingType,
  source,
  onClick,
}: SpendingTypePillProps) {
  const className = cn(
    "text-xs cursor-pointer border-0 inline-flex items-center gap-1",
    spendingType === "necessary" && "bg-emerald-100 text-emerald-900",
    spendingType === "discretionary" && "bg-amber-100 text-amber-900",
    !spendingType && "bg-muted text-muted-foreground",
  );

  const label = spendingType
    ? spendingType[0].toUpperCase() + spendingType.slice(1)
    : "Unclassified";

  return (
    <Badge
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={source ? SOURCE_LABEL[source] ?? source : undefined}
    >
      {source === "stream" && <Repeat className="size-3" />}
      {source === "rule" && <Tag className="size-3" />}
      {(source === "manual" || source === "override") && (
        <User className="size-3" />
      )}
      {label}
    </Badge>
  );
}
