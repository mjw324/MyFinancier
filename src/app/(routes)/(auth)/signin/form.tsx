"use client";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { SignInSchema, SignInValues } from "./validate";
import InputStartIcon from "../components/input-start-icon";
import InputPasswordContainer from "../components/input-password";
import { cn } from "@/lib/utils";
import { AtSign, Lock } from "lucide-react";

const fieldClass =
  "h-11 rounded-[10px] border-[#e4e4e7] bg-white text-sm text-[#0a0a0c] placeholder:text-[#9494a0] shadow-none";

export default function SignInForm() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm<SignInValues>({
    resolver: zodResolver(SignInSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  function onSubmit(data: SignInValues) {
    startTransition(async () => {
      const response = await signIn.username(data);

      if (response.error) {
        console.log("SIGN_IN:", response.error.message);
        toast.error(response.error.message);
      } else if (response.data && "twoFactorRedirect" in response.data) {
        // 2FA redirect handled by twoFactorClient's onTwoFactorRedirect
      } else {
        router.push("/dashboard");
      }
    });
  }

  const getInputClassName = (fieldName: keyof SignInValues) =>
    cn(
      fieldClass,
      form.formState.errors[fieldName] &&
        "border-destructive/80 text-destructive focus-visible:border-destructive/80 focus-visible:ring-destructive/20",
    );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="z-50 mt-8 flex w-full flex-col gap-3.5"
      >
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <InputStartIcon icon={AtSign}>
                  <Input
                    placeholder="Username"
                    className={cn("peer ps-9", getInputClassName("username"))}
                    disabled={isPending}
                    {...field}
                  />
                </InputStartIcon>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <InputPasswordContainer startIcon={Lock}>
                  <Input
                    id="input-23"
                    className={cn(
                      "peer ps-9 pe-9",
                      getInputClassName("password"),
                    )}
                    placeholder="Password"
                    disabled={isPending}
                    {...field}
                  />
                </InputPasswordContainer>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="mt-1 flex items-center justify-between text-[13px]">
          <label className="flex cursor-pointer items-center gap-2 text-[#3a3a40]">
            <input
              type="checkbox"
              style={{ accentColor: "#0a0a0c" }}
              className="size-3.5"
            />
            Remember me
          </label>
          <Link
            href="/forgot-password"
            className="font-medium text-[#0a0a0c] no-underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={isPending}
          className="mt-4 h-11 w-full rounded-[10px] bg-[#0a0a0c] text-sm font-medium text-white shadow-[0_8px_20px_-10px_rgba(10,10,12,0.45)] hover:bg-[#0a0a0c]/90"
        >
          Sign in
        </Button>

        <div className="mt-5 flex items-center gap-3 text-xs text-[#9494a0]">
          <div className="h-px flex-1 bg-[#e4e4e7]" />
          <span>Protected by 2FA when enabled</span>
          <div className="h-px flex-1 bg-[#e4e4e7]" />
        </div>
      </form>
    </Form>
  );
}
