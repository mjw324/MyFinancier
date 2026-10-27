import { after } from "next/server";
import { getServerSession } from "@/lib/auth/get-session";
import { runChatTurn } from "@/lib/chat/turn";
import { getUserTimeZone, getUserToday } from "@/lib/utils/user-time";

// Long enough for a few tool round-trips; the turn's own timeout is shorter.
export const maxDuration = 120;

/**
 * POST /api/chat — the AI assistant (useChat transport). Body:
 * `{ id: chatId, message: UIMessage }` (the client sends only its new message;
 * history is loaded server-side). Responds with a UI message stream, or the
 * usual `{ success: false, error }` JSON with a 4xx/5xx status. A documented
 * exception to the Server-Actions-for-mutations rule: useChat needs an HTTP
 * streaming endpoint. See src/lib/chat/turn.ts.
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const [today, timeZone] = await Promise.all([getUserToday(), getUserTimeZone()]);
  return runChatTurn({
    userId: session.user.id,
    body,
    today,
    timeZone,
    // Finish saving the transcript after the response stream closes.
    waitUntil: (work) => after(() => work),
  });
}
