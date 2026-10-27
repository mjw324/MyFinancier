"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteChatAction } from "../actions";

export function DeleteChatButton({ chatId }: { chatId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Delete chat"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await deleteChatAction({ chatId });
          if (!res.success) return void toast.error(res.error);
          router.push("/assistant");
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
