"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { deleteSpendingRuleAction } from "@/app/(routes)/(dashboard)/transactions/actions";
import type { SpendingRuleWithCount } from "@/lib/db/queries/spending-rules";

interface SpendingRulesSectionProps {
  rules: SpendingRuleWithCount[];
}

export function SpendingRulesSection({ rules }: SpendingRulesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete(ruleId: string, matchValue: string) {
    if (!confirm(`Delete the rule for "${matchValue}"?`)) return;
    startTransition(async () => {
      const result = await deleteSpendingRuleAction({ ruleId });
      if (result.success) {
        toast.success("Rule deleted");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No spending rules yet. Classify a transaction with the &quot;Apply to
        all from {"{merchant}"}&quot; option to create one.
      </p>
    );
  }

  return (
    <div className="divide-y">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{rule.matchValue}</span>
              <Badge
                className="text-xs border-0"
                style={
                  rule.spendingType === "necessary"
                    ? { backgroundColor: "oklch(0.92 0.06 145)", color: "oklch(0.3 0.1 145)" }
                    : { backgroundColor: "oklch(0.92 0.06 75)", color: "oklch(0.3 0.1 75)" }
                }
              >
                {rule.spendingType}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.matchType === "merchant" ? "Merchant match" : "Name pattern"}
              {" · "}
              {rule.affectedCount} transaction
              {rule.affectedCount !== 1 ? "s" : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => handleDelete(rule.id, rule.matchValue)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
