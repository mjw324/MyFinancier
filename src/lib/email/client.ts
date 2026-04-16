import { SESClient } from "@aws-sdk/client-ses";

function getConfig() {
  const region = process.env.AWS_SES_REGION;
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY;

  if (!region) throw new Error("AWS_SES_REGION is not set");
  if (!accessKeyId) throw new Error("AWS_SES_ACCESS_KEY_ID is not set");
  if (!secretAccessKey) throw new Error("AWS_SES_SECRET_ACCESS_KEY is not set");

  return { region, credentials: { accessKeyId, secretAccessKey } };
}

export const sesClient = new SESClient(getConfig());
