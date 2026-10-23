import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./client";
import type { EmailOptions } from "./types";

const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@myfinancier.com";
const FROM_NAME = process.env.SES_FROM_NAME ?? "MyFinancier";

/**
 * Local development: EMAIL_TRANSPORT=console prints the email (with its links
 * and codes) to the server log instead of sending it through SES. Ignored in
 * production builds, so a deployed server always sends real email.
 */
function useConsoleTransport(): boolean {
  return (
    process.env.EMAIL_TRANSPORT === "console" &&
    process.env.NODE_ENV !== "production"
  );
}

function logEmail({ to, subject, html }: EmailOptions): void {
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  console.info(
    [
      "[email:console] ----------------------------------------",
      `To: ${to}`,
      `Subject: ${subject}`,
      text,
      ...links.map((l) => `Link: ${l.replace(/&amp;/g, "&")}`),
      "--------------------------------------------------------",
    ].join("\n"),
  );
}

export async function sendEmail({ to, subject, html }: EmailOptions): Promise<void> {
  if (useConsoleTransport()) {
    logEmail({ to, subject, html });
    return;
  }

  const command = new SendEmailCommand({
    Source: `${FROM_NAME} <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: html, Charset: "UTF-8" } },
    },
  });

  await sesClient.send(command);
}
