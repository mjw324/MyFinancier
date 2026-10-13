"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  type DashboardPeriodKey,
} from "@/lib/utils/date-ranges";

/**
 * The one filter above every period-scoped widget. The period lives in the
 * URL (?period=), so the whole dashboard re-renders on the server against the
 * same slice and a link or refresh keeps it.
 */
export function PeriodSelect({ value }: { value: DashboardPeriodKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "month") params.delete("period");
    else params.set("period", next);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger size="sm" aria-label="Period" className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {DASHBOARD_PERIODS.map((key) => (
          <SelectItem key={key} value={key}>
            {DASHBOARD_PERIOD_LABELS[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
