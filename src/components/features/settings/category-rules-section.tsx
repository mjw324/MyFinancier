"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCategory } from "@/lib/utils/format";
import { deleteCategoryRuleAction } from "@/app/(routes)/(dashboard)/transactions/review/actions";

export interface CategoryRuleItem {
  id: string;
  matchType: string;
  matchValue: string;
  category: string;
}

export function CategoryRulesSection({ rules }: { rules: CategoryRuleItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete(ruleId: string, matchValue: string) {
    if (!confirm(`Delete the category rule for "${matchValue}"?`)) return;
    startTransition(async () => {
      const result = await deleteCategoryRuleAction({ ruleId });
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
        No category rules yet. Accept a category suggestion with &quot;Always for this merchant&quot; to create one.
      </p>
    );
  }

  return (
    <div className="divide-y">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{rule.matchValue}</span>
              <Badge variant="secondary" className="text-xs">
                {formatCategory(rule.category)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.matchType === "merchant" ? "Merchant match" : "Name pattern"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete rule for ${rule.matchValue}`}
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
