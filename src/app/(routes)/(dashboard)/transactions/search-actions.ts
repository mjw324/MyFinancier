"use server";

import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { getUserToday } from "@/lib/utils/user-time";
import { getDistinctCategories } from "@/lib/db/queries/transactions";
import { MAX_QUERY_CHARS, naturalLanguageSearch } from "@/lib/transactions/nl-search";
import { logError } from "@/lib/logging";

const SearchInput = z.object({ text: z.string().trim().min(1).max(MAX_QUERY_CHARS) });

/**
 * "Ask" search: text → validated filters → a /transactions URL. The page
 * then runs the ordinary filtered query for the session user.
 */
export async function naturalSearchAction(
  input: z.input<typeof SearchInput>,
): Promise<{ success: true; data: { href: string } } | { success: false; error: string }> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = SearchInput.safeParse(input);
  if (!parsed.success) return { success: false, error: `Searches can be up to ${MAX_QUERY_CHARS} characters.` };

  try {
    const [today, categories] = await Promise.all([getUserToday(), getDistinctCategories(userId)]);
    const res = await naturalLanguageSearch({ userId, text: parsed.data.text, today, categories });
    switch (res.status) {
      case "disabled":
        return { success: false, error: "Turn on AI features in Settings to search in plain language." };
      case "over_budget":
        return { success: false, error: "You've reached this month's AI limit. Search resumes on the 1st." };
      case "rate_limited":
        return { success: false, error: "That's a lot of searches. Please try again in a little while." };
      case "empty":
        return { success: false, error: "Couldn't turn that into filters. Try naming a merchant, amount or date." };
      default:
        return { success: true, data: { href: res.href } };
    }
  } catch (error) {
    logError("transactions.nl_search_failed", error, { userId });
    return { success: false, error: "Search failed. Please try again." };
  }
}
