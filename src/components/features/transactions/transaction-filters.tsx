"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";
import { formatCategory } from "@/lib/utils/format";
import { FLOW_GROUP_LABELS } from "@/lib/analytics/labels";

/** Query keys set by dashboard drill-downs, shown as removable chips. */
export interface FilterChip {
  param: string;
  label: string;
}

interface TransactionFiltersProps {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  chips?: FilterChip[];
}

const FILTER_KEYS = [
  "search",
  "account",
  "category",
  "from",
  "to",
  "recurring",
  "spendingType",
  "flowGroup",
  "flowClass",
  "bucket",
  "counterparty",
  "cost",
];

export function TransactionFilters({
  accounts,
  categories,
  chips = [],
}: TransactionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      startTransition(() => {
        router.push(`/transactions?${params.toString()}`);
      });
    },
    [router, searchParams],
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push("/transactions");
    });
  };

  const hasFilters = FILTER_KEYS.some((k) => searchParams.has(k));

  return (
    <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search transactions..."
          className="pl-9"
          defaultValue={searchParams.get("search") ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            if (value.length === 0 || value.length >= 2) {
              updateParam("search", value || null);
            }
          }}
        />
      </div>

      <Select
        value={searchParams.get("account") ?? "all"}
        onValueChange={(value) =>
          updateParam("account", value === "all" ? null : value)
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("category") ?? "all"}
        onValueChange={(value) =>
          updateParam("category", value === "all" ? null : value)
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.name}>
              {formatCategory(cat.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        key={`from-${searchParams.get("from") ?? ""}`}
        type="date"
        aria-label="From date"
        className="w-[150px]"
        defaultValue={searchParams.get("from") ?? ""}
        onChange={(e) => updateParam("from", e.target.value || null)}
      />
      <Input
        key={`to-${searchParams.get("to") ?? ""}`}
        type="date"
        aria-label="To date"
        className="w-[150px]"
        defaultValue={searchParams.get("to") ?? ""}
        onChange={(e) => updateParam("to", e.target.value || null)}
      />

      <Select
        value={searchParams.get("recurring") ?? "all"}
        onValueChange={(value) =>
          updateParam("recurring", value === "all" ? null : value)
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All transactions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All transactions</SelectItem>
          <SelectItem value="recurring">Recurring only</SelectItem>
          <SelectItem value="onetime">One-time only</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("flowGroup") ?? "all"}
        onValueChange={(value) =>
          updateParam("flowGroup", value === "all" ? null : value)
        }
      >
        <SelectTrigger className="w-[200px]" aria-label="Money flow">
          <SelectValue placeholder="All money flows" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All money flows</SelectItem>
          {Object.entries(FLOW_GROUP_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("spendingType") ?? "all"}
        onValueChange={(value) =>
          updateParam("spendingType", value === "all" ? null : value)
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All spending types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All spending types</SelectItem>
          <SelectItem value="necessary">Necessary</SelectItem>
          <SelectItem value="discretionary">Discretionary</SelectItem>
          <SelectItem value="unclassified">Unclassified</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
    {chips.length > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <Badge key={chip.param} variant="secondary" className="gap-1 pr-1">
            {chip.label}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-background/60"
              aria-label={`Remove filter: ${chip.label}`}
              onClick={() => updateParam(chip.param, null)}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
    )}
    </div>
  );
}
