"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE } from "@/lib/utils/time-zone";

/**
 * Keeps the `tz` cookie equal to the browser's time zone so server components
 * resolve "today" and calendar periods in the viewer's zone.
 */
export function TimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${TIME_ZONE_COOKIE}=([^;]*)`),
    );
    const current = match ? decodeURIComponent(match[1]) : null;
    if (current === tz) return;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
