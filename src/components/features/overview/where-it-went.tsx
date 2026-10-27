import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardAction,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils/format";
import { bucketLabel, formatRatio } from "@/lib/analytics/labels";
import type {
  BucketTotal,
  CounterpartyTotal,
  SpendingByBucket,
} from "@/lib/analytics/metrics";
import { transactionsHref } from "@/lib/utils/date-ranges";

interface WhereItWentProps {
  buckets: SpendingByBucket;
  merchants: CounterpartyTotal[];
  range: { from: string; to: string };
  title: string;
  /** Optional "Explain" control (AI), shown in the header. */
  explain?: React.ReactNode;
}

const VISIBLE = 8;

/**
 * Net spending by bucket, as bars (magnitude, one hue). Every row links to
 * exactly the transactions it sums. Buckets that net negative (money back
 * from people, rewards) are listed separately and never drawn: a bar cannot
 * honestly show a negative share of spending.
 */
export function WhereItWent({ buckets, merchants, range, title, explain }: WhereItWentProps) {
  const empty = buckets.buckets.length === 0 && buckets.negative.length === 0;
  const top = buckets.buckets.slice(0, VISIBLE);
  const rest = buckets.buckets.slice(VISIBLE);
  const max = buckets.buckets[0]?.net ?? 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Where it went</CardTitle>
        <CardDescription>
          {title} · {formatCurrency(buckets.netSpending)} net spending
        </CardDescription>
        {explain && <CardAction>{explain}</CardAction>}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-muted-foreground">No spending in this period.</p>
        ) : (
          <Tabs defaultValue="categories" className="gap-4">
            <TabsList>
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="merchants">Merchants</TabsTrigger>
            </TabsList>
            <TabsContent value="categories" className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2.5">
                {top.map((b) => (
                  <BucketRow key={b.bucket} bucket={b} max={max} range={range} />
                ))}
              </ul>
              {rest.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {rest.length} more
                  </summary>
                  <ul className="mt-2.5 flex flex-col gap-2.5">
                    {rest.map((b) => (
                      <BucketRow key={b.bucket} bucket={b} max={max} range={range} />
                    ))}
                  </ul>
                </details>
              )}
              {buckets.negative.length > 0 && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    Money back that isn&rsquo;t tied to a category (already netted above)
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {buckets.negative.map((b) => (
                      <li key={b.bucket} className="flex items-baseline justify-between gap-3 text-sm">
                        <Link
                          href={transactionsHref({ ...range, bucket: b.bucket })}
                          className="truncate hover:underline"
                        >
                          {bucketLabel(b.bucket)}
                        </Link>
                        <span className="shrink-0 tabular-nums">
                          −{formatCurrency(Math.abs(b.net))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
            <TabsContent value="merchants">
              {merchants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No merchant spending in this period.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {merchants.map((m) => (
                    <li key={m.key} className="flex items-baseline justify-between gap-3 text-sm">
                      <Link
                        href={transactionsHref({ ...range, counterparty: m.key })}
                        className="min-w-0 truncate hover:underline"
                      >
                        {m.label}
                        <span className="ml-1.5 text-xs text-muted-foreground">×{m.count}</span>
                      </Link>
                      <span className="shrink-0 tabular-nums">{formatCurrency(m.total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function BucketRow({
  bucket,
  max,
  range,
}: {
  bucket: BucketTotal;
  max: number;
  range: { from: string; to: string };
}) {
  const width = max > 0 ? Math.max(2, (bucket.net / max) * 100) : 0;
  return (
    <li>
      <Link
        href={transactionsHref({ ...range, bucket: bucket.bucket })}
        className="group flex flex-col gap-1 rounded-md outline-offset-2"
      >
        <span className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate group-hover:underline">{bucketLabel(bucket.bucket)}</span>
          <span className="shrink-0 tabular-nums">
            {formatCurrency(bucket.net)}
            <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
              {formatRatio(bucket.share)}
            </span>
          </span>
        </span>
        <span className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
          <span
            className="block h-full rounded-full bg-chart-1"
            style={{ width: `${width}%` }}
          />
        </span>
      </Link>
    </li>
  );
}
