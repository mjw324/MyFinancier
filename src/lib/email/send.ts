import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./client";
import type { EmailOptions } from "./types";

const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@myfinancier.com";
const FROM_NAME = process.env.SES_FROM_NAME ?? "MyFinancier";

export async function sendEmail({ to, subject, html }: EmailOptions): Promise<void> {
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
