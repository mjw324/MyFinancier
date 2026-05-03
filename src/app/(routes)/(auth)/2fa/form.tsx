"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  OtpSchema,
  BackupCodeSchema,
  type OtpValues,
  type BackupCodeValues,
} from "./validate";

export default function TwoFactorForm() {
  const [mode, setMode] = useState<"otp" | "backup">("otp");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (mode === "backup") {
    return (
      <BackupCodeForm
        isPending={isPending}
        startTransition={startTransition}
        router={router}
        onSwitchToOtp={() => setMode("otp")}
      />
    );
  }

  return (
    <OtpForm
      isPending={isPending}
      startTransition={startTransition}
      router={router}
      onSwitchToBackup={() => setMode("backup")}
    />
  );
}

function OtpForm({
  isPending,
  startTransition,
  router,
  onSwitchToBackup,
}: {
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
  router: ReturnType<typeof useRouter>;
  onSwitchToBackup: () => void;
}) {
  const form = useForm<OtpValues>({
    resolver: zodResolver(OtpSchema),
    defaultValues: { code: "" },
  });

  const initialSendRef = useRef(false);
  useEffect(() => {
    if (initialSendRef.current) return;
    initialSendRef.current = true;
    authClient.twoFactor.sendOtp().then(({ error }) => {
      if (error) {
        if (error.status === 401 || error.status === 403) {
          toast.error("Session expired. Please sign in again.");
          router.push("/signin");
          return;
        }
        toast.error(error.message ?? "Failed to send verification code");
      }
    });
  }, [router]);

  function onSubmit(data: OtpValues) {
    startTransition(async () => {
      const { error } = await authClient.twoFactor.verifyOtp({
        code: data.code,
      });

      if (error) {
        toast.error(error.message ?? "Invalid verification code");
      } else {
        router.push("/dashboard");
      }
    });
  }

  function handleResend() {
    startTransition(async () => {
      const { error } = await authClient.twoFactor.sendOtp();

      if (error) {
        if (error.status === 401 || error.status === 403) {
          toast.error("Session expired. Please sign in again.");
          router.push("/signin");
          return;
        }
        toast.error(error.message ?? "Failed to resend code");
      } else {
        toast.success("A new code has been sent to your email");
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="z-50 my-8 flex w-full flex-col items-center gap-5"
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <InputOTP
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  disabled={isPending}
                  {...field}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending} className="w-full">
          Verify
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={handleResend}
        >
          Resend Code
        </Button>

        <button
          type="button"
          className="text-sm text-muted-foreground hover:underline"
          onClick={onSwitchToBackup}
        >
          Use a backup code instead
        </button>
      </form>
    </Form>
  );
}

function BackupCodeForm({
  isPending,
  startTransition,
  router,
  onSwitchToOtp,
}: {
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
  router: ReturnType<typeof useRouter>;
  onSwitchToOtp: () => void;
}) {
  const form = useForm<BackupCodeValues>({
    resolver: zodResolver(BackupCodeSchema),
    defaultValues: { code: "" },
  });

  function onSubmit(data: BackupCodeValues) {
    startTransition(async () => {
      const { error } = await authClient.twoFactor.verifyBackupCode({
        code: data.code,
      });

      if (error) {
        toast.error(error.message ?? "Invalid backup code");
      } else {
        router.push("/dashboard");
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="z-50 my-8 flex w-full flex-col gap-5"
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  placeholder="Enter backup code"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending} className="w-full">
          Verify
        </Button>

        <button
          type="button"
          className="text-sm text-muted-foreground hover:underline"
          onClick={onSwitchToOtp}
        >
          Use email code instead
        </button>
      </form>
    </Form>
  );
}
