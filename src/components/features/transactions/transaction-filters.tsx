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
import { Search, X } from "lucide-react";
import { formatCategory } from "@/lib/utils/format";

interface TransactionFiltersProps {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}

export function TransactionFilters({
  accounts,
  categories,
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

  const hasFilters =
    searchParams.has("search") ||
    searchParams.has("account") ||
    searchParams.has("category") ||
    searchParams.has("from") ||
    searchParams.has("to") ||
    searchParams.has("recurring");

  return (
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
        type="date"
        className="w-[150px]"
        defaultValue={searchParams.get("from") ?? ""}
        onChange={(e) => updateParam("from", e.target.value || null)}
      />
      <Input
        type="date"
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

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
