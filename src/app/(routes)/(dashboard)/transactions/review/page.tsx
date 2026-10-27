import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";
import { isAiActiveForUser } from "@/lib/ai/consent";
import { listReviewQueue } from "@/lib/categorize/review";
import { displayName } from "@/lib/utils/format";
import { ReviewQueue, SuggestButton } from "./_components/review-queue";

export const metadata: Metadata = {
  title: "MyFinancier — Review categories",
};

export default async function ReviewCategoriesPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/signin");
  const userId = session.user.id;

  const [aiActive, queue] = await Promise.all([isAiActiveForUser(userId), listReviewQueue(userId)]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Review categories</h2>
          <p className="text-sm text-muted-foreground">
            AI suggestions for transactions your bank wasn&apos;t sure about. Nothing changes until you accept.
          </p>
        </div>
        {aiActive && <SuggestButton />}
      </div>

      {!aiActive && (
        <p className="text-sm text-muted-foreground">
          AI features are off. Turn them on in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to get category suggestions.
        </p>
      )}

      <ReviewQueue
        items={queue.map((q) => ({
          id: q.id,
          suggested: q.suggested,
          date: q.date.toISOString(),
          label: displayName({ merchantName: q.merchantName, fallback: q.name }),
          amount: q.amount,
          plaidCategory: q.plaidCategory,
        }))}
      />
    </div>
  );
}
