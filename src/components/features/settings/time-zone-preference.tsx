"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { updateTimeZoneAction } from "@/app/(routes)/(dashboard)/settings/time-zone-actions";

// Searchable label for the "follow the browser" option (cmdk filters on value).
const AUTOMATIC = "Automatic (browser time zone)";

interface TimeZonePreferenceProps {
  /** From the `tz` cookie (the browser's zone), if known. */
  detected: string | null;
  /** Saved override, or null to follow the browser. */
  saved: string | null;
}

function allTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

export function TimeZonePreference({ detected, saved }: TimeZonePreferenceProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(saved);
  const [pending, startTransition] = useTransition();
  const zones = useMemo(allTimeZones, []);

  const effective = value ?? detected ?? "UTC";

  function choose(next: string | null) {
    setOpen(false);
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await updateTimeZoneAction(next);
      if (!res.success) {
        setValue(previous);
        toast.error(res.error);
        return;
      }
      toast.success(next ? `Time zone set to ${next}` : "Following your browser's time zone");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="time-zone" className="text-sm font-medium">
          Time zone
        </Label>
        <p className="text-xs text-muted-foreground">
          Decides what &quot;today&quot;, this month and budget periods mean.
          Detected from this browser: {detected ?? "not detected yet"}.
        </p>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="time-zone"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={pending}
            className="w-full justify-between sm:w-80"
          >
            <span className="truncate">
              {value ? value : `Automatic (${detected ?? "UTC"})`}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 sm:w-80" align="start">
          <Command>
            <CommandInput placeholder="Search time zones…" />
            <CommandList>
              <CommandEmpty>No time zone found.</CommandEmpty>
              <CommandGroup>
                <CommandItem value={AUTOMATIC} onSelect={() => choose(null)}>
                  <Check className={cn(value === null ? "opacity-100" : "opacity-0")} />
                  Automatic ({detected ?? "browser"})
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="All time zones">
                {zones.map((tz) => (
                  <CommandItem key={tz} value={tz} onSelect={() => choose(tz)}>
                    <Check className={cn(value === tz ? "opacity-100" : "opacity-0")} />
                    {tz}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && detected && value !== detected && (
        <p className="text-xs text-muted-foreground">
          Using {effective} instead of this browser&apos;s {detected}.
        </p>
      )}
    </div>
  );
}
