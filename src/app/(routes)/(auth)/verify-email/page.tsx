import { type Metadata } from "next";
import { MailIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Verify Your Email",
};

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center p-10">
      <div className="flex w-full flex-col items-center rounded-2xl border border-foreground/10 px-8 py-10 md:w-96">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <MailIcon className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          We sent a verification link to your email address. Click the link to
          verify your account and get started.
        </p>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Didn&apos;t receive the email? Check your spam folder or try signing
          up again.
        </p>
      </div>
    </div>
  );
}
