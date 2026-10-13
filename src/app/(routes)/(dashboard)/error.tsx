"use client"; // Error boundaries must be Client Components

import { RouteError } from "@/components/features/overview/route-error";

/**
 * Error boundary for every authenticated page. The dashboard layout (sidebar,
 * header) stays rendered around it, so one failing page never blanks the app.
 */
export default function DashboardGroupError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError title="This page couldn't load" error={error} retry={retry} />;
}
