import { type Metadata } from "next";
import TwoFactorForm from "./form";

export const metadata: Metadata = {
  title: "Two-Factor Authentication",
};

export default function TwoFactorPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center">
      <div className="flex w-full flex-col rounded-2xl border border-foreground/10 px-8 py-5 md:w-96">
        <h1>Verification Required</h1>
        <p>A verification code has been sent to your email</p>
        <TwoFactorForm />
      </div>
    </div>
  );
}
