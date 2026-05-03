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
import { signUp } from "@/lib/auth/client";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { SignUpSchema, SignUpValues } from "./validate";
import InputStartIcon from "../components/input-start-icon";
import InputPasswordContainer from "../components/input-password";
import { cn } from "@/lib/utils";
import { AtSign, Lock, MailIcon, UserIcon } from "lucide-react";

const fieldClass =
  "h-11 rounded-[10px] border-[#e4e4e7] bg-white text-sm text-[#0a0a0c] placeholder:text-[#9494a0] shadow-none";

export default function SignUpForm() {
  const [isPending, startTransition] = useTransition();
  const form = useForm<SignUpValues>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: {
      name: "",
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  function onSubmit(data: SignUpValues) {
    startTransition(async () => {
      const response = await signUp.email(data);

      if (response.error) {
        console.log("SIGN_UP:", response.error.status);
        toast.error(response.error.message);
      } else {
        redirect("/verify-email");
      }
    });
  }

  const getInputClassName = (fieldName: keyof SignUpValues) =>
    cn(
      fieldClass,
      form.formState.errors[fieldName] &&
        "border-destructive/80 text-destructive focus-visible:border-destructive/80 focus-visible:ring-destructive/20",
    );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="z-50 mt-6 flex w-full flex-col gap-3"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <InputStartIcon icon={UserIcon}>
                  <Input
                    placeholder="Name"
                    className={cn("peer ps-9", getInputClassName("name"))}
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <InputStartIcon icon={MailIcon}>
                  <Input
                    placeholder="Email"
                    className={cn("peer ps-9", getInputClassName("email"))}
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

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <InputPasswordContainer startIcon={Lock}>
                  <Input
                    className={cn(
                      "peer ps-9 pe-9",
                      getInputClassName("confirmPassword"),
                    )}
                    placeholder="Confirm password"
                    disabled={isPending}
                    {...field}
                  />
                </InputPasswordContainer>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <label className="mt-1.5 flex items-start gap-2.5 text-xs leading-relaxed text-[#3a3a40]">
          <input
            type="checkbox"
            defaultChecked
            style={{ accentColor: "#0a0a0c" }}
            className="mt-0.5 size-3.5"
          />
          <span>
            I agree to the{" "}
            <a className="font-medium text-[#0a0a0c] underline">Terms</a> and{" "}
            <a className="font-medium text-[#0a0a0c] underline">
              Privacy Policy
            </a>
            .
          </span>
        </label>

        <Button
          type="submit"
          disabled={isPending}
          className="mt-2 h-11 w-full rounded-[10px] bg-[#0a0a0c] text-sm font-medium text-white shadow-[0_8px_20px_-10px_rgba(10,10,12,0.45)] hover:bg-[#0a0a0c]/90"
        >
          Create account
        </Button>

        <div className="mt-2 text-center text-[11px] leading-relaxed text-[#9494a0]">
          We&apos;ll send you a verification email. Bank connections are secured
          by Plaid — we never see or store your credentials.
        </div>
      </form>
    </Form>
  );
}
