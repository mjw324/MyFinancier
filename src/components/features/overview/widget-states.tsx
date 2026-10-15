import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Shown in place of one widget whose data failed; the rest of the page renders. */
export function WidgetError({ title, className }: { title: string; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <AlertCircle className="size-4 shrink-0" />
          This couldn&rsquo;t be loaded right now. Refresh to try again.
        </p>
      </CardContent>
    </Card>
  );
}

export function WidgetSkeleton({
  title,
  className,
  height = "h-40",
}: {
  title: string;
  className?: string;
  height?: string;
}) {
  return (
    <Card className={className} aria-busy="true">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className={cn("w-full", height)} />
      </CardContent>
    </Card>
  );
}
