"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ranges = [
  { value: "week", label: "Past Week" },
  { value: "month", label: "Past Month" },
  { value: "year", label: "Past Year" },
  { value: "ytd", label: "Year to Date" },
] as const;

interface SpendingTimeRangeSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function SpendingTimeRangeSelect({
  value,
  onValueChange,
  disabled,
}: SpendingTimeRangeSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ranges.map((range) => (
          <SelectItem key={range.value} value={range.value}>
            {range.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
