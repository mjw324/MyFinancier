import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Insight } from "@/lib/analytics/insights";

const TONE_ICON = {
  positive: CheckCircle2,
  warning: AlertTriangle,
  neutral: Info,
} as const;

const TONE_LABEL = {
  positive: "Good news",
  warning: "Heads up",
  neutral: "Note",
} as const;

/**
 * Findings as sentences. Says so plainly when there is nothing notable rather
 * than padding the list.
 */
export function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">What changed</CardTitle>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing unusual yet. Findings appear here once there is enough history to compare.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {insights.map((insight) => {
              const Icon = TONE_ICON[insight.tone];
              const body = (
                <>
                  <Icon
                    className={
                      insight.tone === "warning"
                        ? "mt-0.5 size-4 shrink-0 text-destructive-foreground"
                        : "mt-0.5 size-4 shrink-0 text-muted-foreground"
                    }
                    aria-label={TONE_LABEL[insight.tone]}
                  />
                  <span className="min-w-0 flex-1">{insight.text}</span>
                  {insight.href && (
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                </>
              );
              return (
                <li key={insight.id}>
                  {insight.href ? (
                    <Link
                      href={insight.href}
                      className="flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
