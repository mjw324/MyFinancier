import { db } from "@/lib/db";
import { betterAuth } from "better-auth";
import { username, twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { restrictedUsernames } from "./usernames";
import { sendEmail } from "@/lib/email/send";
import { verificationEmailTemplate } from "@/lib/email/templates/verification";
import { otpEmailTemplate } from "@/lib/email/templates/otp";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  plugins: [
    username({
      minUsernameLength: 4,
      maxUsernameLength: 10,
      usernameValidator: (value) => !restrictedUsernames.includes(value),
      usernameNormalization: (value) => value.toLowerCase(),
    }),
    twoFactor({
      otpOptions: {
        async sendOTP({ user, otp }) {
          await sendEmail({
            to: user.email,
            subject: "Your MyFinancier verification code",
            html: otpEmailTemplate({ name: user.name, otp }),
          });
        },
      },
    }),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        console.log("[EMAIL] Sending verification email to:", user.email);
        await sendEmail({
          to: user.email,
          subject: "Verify your MyFinancier email",
          html: verificationEmailTemplate({
            name: user.name,
            verificationUrl: url,
          }),
        });
        console.log("[EMAIL] Verification email sent successfully");
      } catch (error) {
        console.error("[EMAIL] Failed to send verification email:", error);
        throw error;
      }
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        required: false,
        input: false,
      },
      gender: {
        type: "boolean",
        required: true,
        input: true,
      },
    },
  },
});
