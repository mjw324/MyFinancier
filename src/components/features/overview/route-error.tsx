"use client";

import Link from "next/link";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared fallback for route-segment error boundaries (error.tsx). Server
 * errors arrive here as a generic message plus a digest that matches the
 * server log line, so nothing sensitive is shown.
 */
export function RouteError({
  title,
  error,
  retry,
}: {
  title: string;
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex justify-center py-10">
      <Card className="w-full max-w-md gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="size-5 text-destructive-foreground" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Something went wrong loading this page. Your data is safe; trying again
            usually fixes it.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => retry()} size="sm">
              <RotateCw className="size-4" />
              Try again
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
