"use client"; // Error boundaries must be Client Components

import { RouteError } from "@/components/features/overview/route-error";

export default function TransactionsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError title="Transactions couldn't load" error={error} retry={retry} />;
}
