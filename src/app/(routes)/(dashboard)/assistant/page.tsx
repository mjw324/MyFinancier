import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { generateId, validateUIMessages } from "ai";
import { getServerSession } from "@/lib/auth/get-session";
import { isAiActiveForUser } from "@/lib/ai/consent";
import { CHAT_ID_RE, listChats, loadChatMessages } from "@/lib/chat/store";
import { chatDataSchemas, type ChatUIMessage } from "@/lib/chat/types";
import { AssistantChat } from "@/components/features/assistant/assistant-chat";
import { Button } from "@/components/ui/button";
import { DeleteChatButton } from "./_components/delete-chat-button";

export const metadata: Metadata = {
  title: "MyFinancier — AI assistant",
};

/**
 * The AI assistant. `?chat=<id>` reopens a saved conversation; without it a
 * new chat id is minted (the chat row is created on the first message).
 */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ chat?: string }> }) {
  const session = await getServerSession();
  if (!session?.user) redirect("/signin");
  const userId = session.user.id;

  if (!(await isAiActiveForUser(userId))) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">AI assistant</h2>
        <p className="text-sm text-muted-foreground">
          AI features are off. Turn them on in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to ask questions about your money.
        </p>
      </div>
    );
  }

  const requested = (await searchParams).chat;
  const chatId = requested && CHAT_ID_RE.test(requested) ? requested : generateId();
  const [stored, chats] = await Promise.all([loadChatMessages(userId, chatId), listChats(userId, 10)]);
  let initialMessages: ChatUIMessage[] = [];
  if (stored.length > 0) {
    try {
      initialMessages = await validateUIMessages<ChatUIMessage>({ messages: stored, dataSchemas: chatDataSchemas });
    } catch {
      initialMessages = [];
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI assistant</h2>
          <p className="text-sm text-muted-foreground">
            Answers are AI-generated from your MyFinancier data and are educational only, not financial, investment,
            tax or legal advice. Figures come from your accounts; check anything important.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/assistant">New chat</Link>
        </Button>
      </div>

      <AssistantChat key={chatId} chatId={chatId} initialMessages={initialMessages} />

      {chats.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Recent chats</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {chats.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <Link href={`/assistant?chat=${c.id}`} className={c.id === chatId ? "font-medium" : "underline"}>
                  {c.updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </Link>
                <DeleteChatButton chatId={c.id} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Chats are deleted automatically after 90 days.</p>
        </section>
      )}
    </div>
  );
}
