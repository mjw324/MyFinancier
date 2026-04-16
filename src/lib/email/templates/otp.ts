import { emailLayout } from "./layout";
import type { OtpEmailParams } from "../types";

export function otpEmailTemplate({ name, otp }: OtpEmailParams): string {
  return emailLayout(`
    <h2 style="margin:0 0 16px;color:#0a0a0a;font-size:24px;font-weight:600;">Your verification code</h2>
    <p style="margin:0 0 24px;color:#3f3f46;font-size:16px;line-height:1.5;">
      Hi ${name}, use the following code to complete your sign-in:
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <div style="display:inline-block;padding:16px 48px;background-color:#f4f4f5;border-radius:8px;border:1px solid #e4e4e7;letter-spacing:8px;font-size:32px;font-weight:700;color:#0a0a0a;">
            ${otp}
          </div>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px;line-height:1.5;">
      This code expires in 5 minutes. If you didn&rsquo;t request this code, please secure your account immediately.
    </p>
  `);
}
