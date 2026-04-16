import { emailLayout } from "./layout";
import type { VerificationEmailParams } from "../types";

export function verificationEmailTemplate({
  name,
  verificationUrl,
}: VerificationEmailParams): string {
  return emailLayout(`
    <h2 style="margin:0 0 16px;color:#0a0a0a;font-size:24px;font-weight:600;">Verify your email</h2>
    <p style="margin:0 0 24px;color:#3f3f46;font-size:16px;line-height:1.5;">
      Hi ${name}, thanks for signing up for MyFinancier. Please verify your email address by clicking the button below.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <a href="${verificationUrl}" style="display:inline-block;padding:12px 32px;background-color:#0a0a0a;color:#fafafa;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Verify Email Address
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px;line-height:1.5;">
      If you didn&rsquo;t create an account, you can safely ignore this email.
    </p>
  `);
}
